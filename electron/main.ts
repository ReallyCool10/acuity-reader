import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  protocol,
  Tray,
  Menu,
  nativeImage,
  shell,
  nativeTheme,
  systemPreferences,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as mm from 'music-metadata';
import JSZip from 'jszip';
import { registerAllowedRoot, isAllowedPath } from './paths';
import { computeStableId, migrateLibraryState } from './id';
import { pairCompanions } from './pairing';
import { parseAudioChapters, extractChplFromFile } from './audio';
import { getEdgeVoices, synthesizeEdgeSpeech } from './edgeTts';
import { getMcpClients, installMcpClient, uninstallMcpClient, getMcpSnippet } from './mcpSetup';
import type { AudioChapter, SynthesisOptions } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.name = 'Acuity Reader';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isPinned = false;

/* ------------------------------------------------------------------ logging */

function logError(scope: string, err: unknown) {
  const detail = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`[${scope}] ${detail}`);
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'acuity-main.log'),
      `[${new Date().toISOString()}] ${scope}: ${detail}\n`
    );
  } catch {
    // Logging must never take the app down.
  }
}

function logInfo(scope: string, message: string) {
  console.log(`[${scope}] ${message}`);
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'acuity-main.log'),
      `[${new Date().toISOString()}] INFO [${scope}]: ${message}\n`
    );
  } catch {
    // Logging must never take the app down.
  }
}

process.on('uncaughtException', (err) => logError('uncaughtException', err));
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

/* -------------------------------------------------- acuity:// media protocol */

/**
 * The renderer never touches `file://`. It requests `acuity://media/<encoded path>`
 * and this process decides whether to serve it.
 *
 * That inversion is what lets `webSecurity` stay enabled. The previous build
 * disabled it so the renderer could load local audio and covers directly, which
 * also switched off the same-origin policy for every other resource the app loads.
 */
protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
    scheme: 'acuity',
  },
]);


const CONTENT_TYPES: Record<string, string> = {
  '.aac': 'audio/aac',
  '.epub': 'application/epub+zip',
  '.flac': 'audio/flac',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Serve a local file, honouring HTTP range requests.
 *
 * Ranges are not optional here: an .m4b audiobook is routinely hundreds of
 * megabytes, and without 206 support the <audio> element cannot seek — it can
 * only stream from zero.
 */
async function serveFile(request: Request): Promise<Response> {
  let filePath: string;
  try {
    const url = new URL(request.url);
    filePath = path.normalize(decodeURIComponent(url.pathname.replace(/^\//, '')));
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (!filePath || !isAllowedPath(filePath)) {
    return new Response('Forbidden', { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const rangeHeader = request.headers.get('Range');
  const rangeMatch = rangeHeader?.match(/bytes=(\d*)-(\d*)/);

  if (rangeMatch) {
    const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    const end = rangeMatch[2] ? Number(rangeMatch[2]) : stat.size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}` },
      });
    }

    const clampedEnd = Math.min(end, stat.size - 1);
    const stream = fs.createReadStream(filePath, { start, end: clampedEnd });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(clampedEnd - start + 1),
        'Content-Range': `bytes ${start}-${clampedEnd}/${stat.size}`,
        'Content-Type': contentType,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(stat.size),
      'Content-Type': contentType,
    },
  });
}

/* -------------------------------------------------------------- tray icons */

/** Small procedurally drawn RGBA glyphs for the taskbar thumbnail and tray. */
function createIcon(type: 'play' | 'pause' | 'skip-back' | 'skip-forward' | 'tray'): Electron.NativeImage {
  const size = 24;
  const buffer = Buffer.alloc(size * size * 4);

  const setPixel = (x: number, y: number, r = 240, g = 240, b = 240, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const offset = (y * size + x) * 4;
    buffer[offset] = r;
    buffer[offset + 1] = g;
    buffer[offset + 2] = b;
    buffer[offset + 3] = a;
  };

  if (type === 'play') {
    for (let x = 6; x <= 18; x++) {
      const halfHeight = Math.floor((x - 6) * 0.65);
      for (let y = 12 - halfHeight; y <= 12 + halfHeight; y++) setPixel(x, y);
    }
  } else if (type === 'pause') {
    for (let y = 6; y <= 18; y++) {
      for (let x = 7; x <= 10; x++) setPixel(x, y);
      for (let x = 14; x <= 17; x++) setPixel(x, y);
    }
  } else if (type === 'skip-back') {
    for (let y = 6; y <= 18; y++) setPixel(6, y);
    for (let x = 8; x <= 18; x++) {
      const h = Math.floor((18 - x) * 0.65);
      for (let y = 12 - h; y <= 12 + h; y++) setPixel(x, y);
    }
  } else if (type === 'skip-forward') {
    for (let y = 6; y <= 18; y++) setPixel(18, y);
    for (let x = 6; x <= 16; x++) {
      const h = Math.floor((x - 6) * 0.65);
      for (let y = 12 - h; y <= 12 + h; y++) setPixel(x, y);
    }
  } else {
    for (let y = 5; y <= 19; y++) {
      const w = Math.floor((y - 5) * 0.55);
      setPixel(12 - w, y, 255, 255, 255);
      setPixel(12 + w, y, 255, 255, 255);
    }
    for (let x = 9; x <= 15; x++) setPixel(x, 14, 255, 255, 255);
  }

  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

function updateThumbarButtons(isPlaying: boolean) {
  if (process.platform !== 'win32' || !mainWindow) return;

  try {
    mainWindow.setThumbarButtons([
      {
        click: () => mainWindow?.webContents.send('player:command', 'skip-back'),
        icon: createIcon('skip-back'),
        tooltip: 'Back 15 seconds',
      },
      {
        click: () => mainWindow?.webContents.send('player:command', 'toggle-play'),
        icon: createIcon(isPlaying ? 'pause' : 'play'),
        tooltip: isPlaying ? 'Pause' : 'Play',
      },
      {
        click: () => mainWindow?.webContents.send('player:command', 'skip-forward'),
        icon: createIcon('skip-forward'),
        tooltip: 'Forward 15 seconds',
      },
    ]);
  } catch (err) {
    logError('thumbar', err);
  }
}

/* ------------------------------------------------------------------ window */

function getTitleBarOverlay(isDark: boolean) {
  return {
    color: '#00000000',
    symbolColor: isDark ? '#e2e8f0' : '#1e293b',
    height: 40,
  };
}

function getSystemAccentColor(): string | null {
  try {
    if (process.platform === 'win32' && systemPreferences?.getAccentColor) {
      const color = systemPreferences.getAccentColor();
      return color ? `#${color.slice(0, 6)}` : null;
    }
  } catch {
    // Best-effort
  }
  return null;
}

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: workX, y: workY } = primaryDisplay.workArea;

  const winWidth = Math.max(420, Math.round(screenWidth / 3));
  const isDark = nativeTheme.shouldUseDarkColors;

  mainWindow = new BrowserWindow({
    x: workX + screenWidth - winWidth,
    y: workY,
    width: winWidth,
    height: screenHeight,
    minWidth: 380,
    minHeight: 520,
    titleBarStyle: 'hidden',
    titleBarOverlay: getTitleBarOverlay(isDark),
    icon: path.join(__dirname, '../resources/icon.ico'),
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Local media is served through the acuity:// handler above, so the
      // same-origin policy can stay switched on.
      webSecurity: true,
    },
  });

  // Painting before first frame causes a white flash against the Mica backdrop.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    updateThumbarButtons(false);
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
    logError('did-fail-load', `${code} ${desc}`);
  });

  // Keep navigation inside the app; open real links in the user's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) {
    createMainWindow();
  } else if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '../resources/icon.ico');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : createIcon('tray');
    tray = new Tray(icon);
    tray.setToolTip('Acuity Reader');

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Acuity Reader', enabled: false },
        { type: 'separator' },
        { label: 'Show / Hide', click: toggleWindow },
        {
          label: 'Play / Pause',
          click: () => mainWindow?.webContents.send('player:command', 'toggle-play'),
        },
        {
          label: 'Back 15 seconds',
          click: () => mainWindow?.webContents.send('player:command', 'skip-back'),
        },
        {
          label: 'Forward 15 seconds',
          click: () => mainWindow?.webContents.send('player:command', 'skip-forward'),
        },
        { type: 'separator' },
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: isPinned,
          click: (menuItem) => {
            isPinned = menuItem.checked;
            mainWindow?.setAlwaysOnTop(isPinned);
            mainWindow?.webContents.send('window:pinned-changed', isPinned);
          },
        },
        { type: 'separator' },
        { label: 'Quit Acuity', click: () => app.quit() },
      ])
    );

    tray.on('click', toggleWindow);
  } catch (err) {
    logError('tray', err);
  }
}

/* ------------------------------------------------------------ window IPC */

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:togglePin', () => {
  if (!mainWindow) return false;
  isPinned = !isPinned;
  mainWindow.setAlwaysOnTop(isPinned);
  return isPinned;
});
ipcMain.handle('window:isPinned', () => isPinned);

ipcMain.on('thumbar:update', (_event, { isPlaying }: { isPlaying: boolean }) => {
  updateThumbarButtons(isPlaying);
});

ipcMain.handle('dialog:pickFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your books and audiobooks folder',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:revealInFolder', (_event, filePath: string) => {
  if (isAllowedPath(filePath)) shell.showItemInFolder(path.resolve(filePath));
});

/* ---------------------------------------------------------------- scanning */

const AUDIO_EXTS = new Set(['.m4b', '.mp3', '.m4a', '.aac', '.flac', '.opus', '.ogg']);
const BOOK_EXTS = new Set(['.epub', '.pdf']);
const SKIP_DIRS = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

function getCoversDir(): string {
  const dir = path.join(app.getPath('userData'), 'covers');
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      logError('covers-dir', err);
    }
  }
  return dir;
}

function cacheKeyFor(filePath: string): string {
  return crypto.createHash('md5').update(filePath).digest('hex');
}

async function findOrExtractCover(
  filePath: string,
  mediaType: 'audio' | 'book',
  dirPath: string,
  fileName: string
): Promise<string | undefined> {
  try {
    const baseName = path.parse(fileName).name;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

    for (const imgExt of imageExtensions) {
      const candidate = path.join(dirPath, baseName + imgExt);
      if (fs.existsSync(candidate)) return candidate;
    }

    for (const name of ['cover', 'folder', 'front', 'albumart']) {
      for (const imgExt of imageExtensions) {
        const candidate = path.join(dirPath, name + imgExt);
        if (fs.existsSync(candidate)) return candidate;
      }
    }

    const cachedCoverPath = path.join(getCoversDir(), `${cacheKeyFor(filePath)}.jpg`);
    if (fs.existsSync(cachedCoverPath)) return cachedCoverPath;

    if (mediaType === 'audio') {
      try {
        const metadata = await mm.parseFile(filePath, { skipPostHeaders: true });
        const picture = metadata.common?.picture?.[0];
        if (picture?.data?.length) {
          await fs.promises.writeFile(cachedCoverPath, picture.data);
          return cachedCoverPath;
        }
      } catch {
        // Unreadable tags are common; fall through to the procedural jacket.
      }
    }

    if (path.extname(fileName).toLowerCase() === '.epub') {
      try {
        const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
        const entry =
          Object.values(zip.files).find((f) => !f.dir && /cover.*\.(jpe?g|png|webp)$/i.test(f.name)) ||
          Object.values(zip.files).find((f) => !f.dir && /\.(jpe?g|png|webp)$/i.test(f.name));
        if (entry) {
          await fs.promises.writeFile(cachedCoverPath, await entry.async('nodebuffer'));
          return cachedCoverPath;
        }
      } catch {
        // Malformed archive; the card falls back to a generated jacket.
      }
    }
  } catch (err) {
    logError('cover', err);
  }
  return undefined;
}

/**
 * Read real title/author from an EPUB's package document.
 *
 * Filenames are a poor source of metadata, and guessing "Author - Title" from
 * them mislabels anything that does not follow that convention.
 */
async function readEpubMetadata(filePath: string): Promise<{ title?: string; author?: string }> {
  try {
    const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) return {};

    const containerXml = await containerFile.async('text');
    const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
    if (!opfPath) return {};

    const opfFile = zip.file(opfPath);
    if (!opfFile) return {};

    const opf = await opfFile.async('text');
    const pick = (field: string) =>
      opf
        .match(new RegExp(`<(?:dc:)?${field}[^>]*>([\\s\\S]*?)</(?:dc:)?${field}>`, 'i'))?.[1]
        ?.replace(/<[^>]+>/g, '')
        .trim();

    return { title: pick('title'), author: pick('creator') };
  } catch {
    return {};
  }
}

/** Strip leading track numbers and split a conventional "Author - Title" filename. */
function cleanTitle(filename: string): { title: string; author: string } {
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
  const cleaned = nameWithoutExt.replace(/^(\d+[\s._-]+)+/i, '').trim();

  const dashMatch = cleaned.match(/^([^-]+)\s*-\s*(.+)$/);
  if (dashMatch) return { author: dashMatch[1].trim(), title: dashMatch[2].trim() };

  const parenMatch = cleaned.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) return { title: parenMatch[1].trim(), author: parenMatch[2].trim() };

  return { title: cleaned, author: '' };
}

interface ScannedItem {
  id: string;
  title: string;
  author: string;
  filePath: string;
  mediaType: 'audio' | 'book';
  format: string;
  fileSize: number;
  dateAdded: number;
  dirName: string;
  durationSeconds?: number;
  companionPath?: string;
  companionType?: string;
  coverUrl?: string;
  trackNumber?: number;
  discNumber?: number;
  album?: string;
  chapters?: AudioChapter[];
}

/** In-memory cache of scanned items to avoid re-parsing tags and covers on rescan. */
const itemMetadataCache = new Map<string, ScannedItem>();

async function scanRecursive(dirPath: string, items: ScannedItem[], onProgress: (count: number) => void) {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    logError('scan-readdir', err);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      await scanRecursive(fullPath, items, onProgress);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const mediaType = AUDIO_EXTS.has(ext) ? 'audio' : BOOK_EXTS.has(ext) ? 'book' : null;
    if (!mediaType) continue;

    try {
      const stats = await fs.promises.stat(fullPath);

      // Mtime + size skip: if file size and mtime are unchanged, reuse cached metadata.
      const cached = itemMetadataCache.get(fullPath);
      if (
        cached &&
        cached.fileSize === stats.size &&
        Math.abs(cached.dateAdded - stats.mtimeMs) < 1000
      ) {
        items.push({
          ...cached,
          dateAdded: stats.mtimeMs,
        });
        onProgress(items.length);
        continue;
      }

      const parentDirName = path.basename(dirPath);
      const fromName = cleanTitle(entry.name);

      let title = fromName.title || entry.name;
      let author = fromName.author;
      let durationSeconds: number | undefined;
      let trackNumber: number | undefined;
      let discNumber: number | undefined;
      let album: string | undefined;
      let chapters: AudioChapter[] | undefined;

      // Embedded metadata beats filename guessing wherever it exists.
      if (mediaType === 'audio') {
        try {
          const meta = await mm.parseFile(fullPath, {
            skipPostHeaders: true,
            duration: true,
            includeChapters: true,
          });
          if (meta.common?.title) title = meta.common.title;
          if (meta.common?.artist || meta.common?.albumartist) {
            author = meta.common.albumartist || meta.common.artist || author;
          }
          if (meta.format?.duration) durationSeconds = meta.format.duration;
          if (meta.common?.track?.no) trackNumber = meta.common.track.no;
          if (meta.common?.disk?.no) discNumber = meta.common.disk.no;
          if (meta.common?.album) album = meta.common.album;

          if (meta.format?.chapters && meta.format.chapters.length > 0) {
            chapters = parseAudioChapters(meta.format.chapters, meta.format.sampleRate, durationSeconds);
          }
        } catch {
          // Keep the filename-derived values.
        }

        // If no chapters found yet and it's an m4b/mp4/m4a file, check for Nero chpl atom
        if ((!chapters || chapters.length === 0) && (ext === '.m4b' || ext === '.m4a' || ext === '.mp4')) {
          try {
            const chplChapters = await extractChplFromFile(fullPath);
            if (chplChapters.length > 0) chapters = chplChapters;
          } catch {
            // Ignore
          }
        }
      } else if (ext === '.epub') {
        const meta = await readEpubMetadata(fullPath);
        if (meta.title) title = meta.title;
        if (meta.author) author = meta.author;
      }

      const finalAuthor = author || parentDirName || 'Unknown';
      const id = computeStableId(title, finalAuthor, stats.size, fullPath);

      const scannedItem: ScannedItem = {
        id,
        title,
        author: finalAuthor,
        filePath: fullPath,
        mediaType,
        format: ext.replace('.', ''),
        fileSize: stats.size,
        dateAdded: stats.mtimeMs,
        dirName: parentDirName,
        durationSeconds,
        coverUrl: await findOrExtractCover(fullPath, mediaType, dirPath, entry.name),
        trackNumber,
        discNumber,
        album,
        chapters,
      };

      itemMetadataCache.set(fullPath, scannedItem);
      items.push(scannedItem);
      onProgress(items.length);
    } catch (err) {
      logError('scan-file', err);
    }
  }
}

ipcMain.handle('scanner:scanFolder', async (event, folderPath: string) => {
  registerAllowedRoot(folderPath);
  registerAllowedRoot(getCoversDir());

  const items: ScannedItem[] = [];
  let lastSent = 0;

  await scanRecursive(folderPath, items, (count) => {
    // Throttle progress so a large library does not flood the IPC channel.
    const now = Date.now();
    if (now - lastSent > 120) {
      lastSent = now;
      event.sender.send('scanner:progress', { count, folder: folderPath });
    }
  });

  // Pair companion audio and text editions.
  pairCompanions(items);

  return items;
});

/* ----------------------------------------------------------------- storage */

function getStorageFilePath() {
  return path.join(app.getPath('userData'), 'acuity_library.json');
}

let pendingWrite: unknown = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Write via a temp file then rename.
 *
 * Renaming is atomic, so a crash mid-write cannot leave a truncated JSON file
 * behind — which would otherwise lose the user's entire library and progress.
 */
async function writeStoreAtomically(data: unknown) {
  const target = getStorageFilePath();
  const temp = `${target}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, JSON.stringify(data), 'utf8');
  await fs.promises.rename(temp, target);
}

async function flushStore() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (pendingWrite === null) return;

  const data = pendingWrite;
  pendingWrite = null;
  try {
    await writeStoreAtomically(data);
  } catch (err) {
    logError('storage-flush', err);
  }
}

ipcMain.handle('storage:load', async () => {
  try {
    const filePath = getStorageFilePath();
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      const { state: migrated, migratedCount } = migrateLibraryState(parsed);
      if (migratedCount > 0) {
        logInfo('storage-migrate', `Migrated ${migratedCount} legacy library items to stable IDs`);
        void writeStoreAtomically(migrated);
      }
      for (const item of (migrated.items || []) as ScannedItem[]) {
        if (item.filePath) {
          itemMetadataCache.set(item.filePath, item);
        }
      }
      for (const folder of migrated?.folders ?? []) registerAllowedRoot(folder);
      registerAllowedRoot(getCoversDir());
      return migrated;
    }
  } catch (err) {
    logError('storage-load', err);
  }
  registerAllowedRoot(getCoversDir());
  return { folders: [], items: [], progress: {}, bookmarks: {} };
});

/**
 * Coalesce saves.
 *
 * Playback progress updates land continuously while audio plays; debouncing
 * means steady listening costs one write per second instead of one per
 * `timeupdate` event, each of which serialises the whole library.
 */
ipcMain.handle('storage:save', async (_event, data: { folders?: string[]; items?: ScannedItem[] }) => {
  for (const folder of data?.folders ?? []) registerAllowedRoot(folder);
  for (const item of data?.items ?? []) {
    if (item.filePath) {
      itemMetadataCache.set(item.filePath, item);
    }
  }

  pendingWrite = data;
  if (!writeTimer) {
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void flushStore();
    }, 1000);
  }
  return true;
});

/** Raw bytes for in-renderer EPUB parsing. Gated by the same allowlist as the protocol. */
ipcMain.handle('file:readBytes', async (_event, filePath: string) => {
  if (!isAllowedPath(filePath)) {
    logError('file-read', `Blocked read outside library roots: ${filePath}`);
    return null;
  }
  try {
    const buffer = await fs.promises.readFile(path.resolve(filePath));
    return new Uint8Array(buffer);
  } catch (err) {
    logError('file-read', err);
    return null;
  }
});

/** Return current system theme info (dark/light, accent color) */
ipcMain.handle('system:getThemeInfo', async () => {
  return {
    isDark: nativeTheme.shouldUseDarkColors,
    accentColor: getSystemAccentColor(),
  };
});

/** Set application theme source ('system' | 'dark' | 'light') */
ipcMain.handle('system:setThemeSource', async (_event, source: 'system' | 'dark' | 'light') => {
  nativeTheme.themeSource = source;
  const isDarkNow = nativeTheme.shouldUseDarkColors;
  mainWindow?.setTitleBarOverlay(getTitleBarOverlay(isDarkNow));
  return {
    isDark: isDarkNow,
    accentColor: getSystemAccentColor(),
  };
});

/** Return available Microsoft Edge neural voices */
ipcMain.handle('tts:getEdgeVoices', async () => {
  return getEdgeVoices();
});

/** Synthesize speech via Edge Neural TTS */
ipcMain.handle('tts:synthesizeEdge', async (_event, options: SynthesisOptions) => {
  return synthesizeEdgeSpeech(options);
});

/** Return detected and installed MCP AI clients */
ipcMain.handle('mcp:getClients', async () => {
  return getMcpClients();
});

/** Install Acuity MCP server configuration to client */
ipcMain.handle('mcp:installClient', async (_event, clientId: string) => {
  return installMcpClient(clientId);
});

/** Remove Acuity MCP server configuration from client */
ipcMain.handle('mcp:uninstallClient', async (_event, clientId: string) => {
  return uninstallMcpClient(clientId);
});

/** Return formatted configuration snippet for manual copying */
ipcMain.handle('mcp:getSnippet', async (_event, clientId: string) => {
  return getMcpSnippet(clientId);
});

/* -------------------------------------------------------------- lifecycle */

// A second instance would fight over the tray icon and the library file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('acuity', serveFile);
    registerAllowedRoot(getCoversDir());
    createMainWindow();
    createTray();

    nativeTheme.on('updated', () => {
      const isDarkNow = nativeTheme.shouldUseDarkColors;
      mainWindow?.setTitleBarOverlay(getTitleBarOverlay(isDarkNow));
      mainWindow?.webContents.send('system:theme-changed', {
        isDark: isDarkNow,
        accentColor: getSystemAccentColor(),
      });
    });
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

// Any debounced save must reach disk before the process exits.
app.on('before-quit', (event) => {
  if (pendingWrite !== null) {
    event.preventDefault();
    void flushStore().finally(() => app.exit(0));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
