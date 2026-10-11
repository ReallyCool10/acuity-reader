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
import { findCacheHit } from './scanCache';
import { createScanStore, type ScanStore } from './scanStore';
import { pairCompanions } from './pairing';
import { parseAudioChapters, extractChplFromFile } from './audio';
import { cleanTitle, readPdfMetadata, readEpubMetadata } from './metadata';
import { getEdgeVoices, synthesizeEdgeSpeech } from './edgeTts';
import { createThumbnailStore, isJpeg, MAX_THUMB_BYTES, type ThumbnailStore } from './thumbnails';
import { findEpubCover } from './epubCover';
import { keepUnreadableLibrary } from './libraryFile';
import {
  configureMcpRuntime,
  getMcpClients,
  installMcpClient,
  uninstallMcpClient,
  getMcpSnippet,
} from './mcpSetup';
import type { AudioChapter, SynthesisOptions } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.name = 'Acuity Reader';

// Allow programmatic audio playback for synthesized TTS and previews without user gesture timeouts
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
 * and this process decides whether to serve it. `acuity://thumb/<encoded path>`
 * is the same check, answered with a small copy of an image for shelves.
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
  let wantsThumbnail: boolean;
  try {
    const url = new URL(request.url);
    filePath = path.normalize(decodeURIComponent(url.pathname.replace(/^\//, '')));
    wantsThumbnail = url.hostname === 'thumb';
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

  // The source path passed the allowlist above; its thumbnail lives in our own cache.
  if (wantsThumbnail) {
    const servePath = await getThumbnails().servePath(filePath, stat);
    if (servePath !== filePath) {
      try {
        stat = await fs.promises.stat(servePath);
        filePath = servePath;
      } catch {
        // Thumbnail vanished between creation and serving; fall back to the source.
      }
    }
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

function getAppIconPath(): string {
  const candidates = [
    path.join(__dirname, '../resources/icon.ico'),
    path.join(__dirname, '../dist/icon.ico'),
    path.join(process.resourcesPath, 'resources/icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, '../resources/icon.ico');
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
    icon: getAppIconPath(),
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

  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    updateThumbarButtons(false);
  };

  // Painting before first frame causes a white flash against the Mica backdrop.
  mainWindow.once('ready-to-show', showWindow);

  // If first paint stalls or ready-to-show is delayed, ensure window is shown after load.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(showWindow, 150);
  });

  // Safety fallback: ensure the panel always opens on launch even if Chromium paint stalls.
  const safetyTimer = setTimeout(showWindow, 1000);
  mainWindow.once('show', () => clearTimeout(safetyTimer));

  mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
    logError('did-fail-load', `${code} ${desc}`);
  });

  // Keep navigation inside the app; open real links in the user's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // The window never leaves the app's page. A link in a book that navigated it
  // would replace the whole interface (with chrome-error:// for a path that does
  // not exist); the reader follows book links itself. A reload is still allowed.
  mainWindow.webContents.on('will-navigate', (event) => {
    if (event.url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false);
  });

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
    const iconPath = getAppIconPath();
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
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

ipcMain.on('thumbar:update', (_event, { isPlaying }: { isPlaying: boolean }) => {
  updateThumbarButtons(isPlaying);
});

ipcMain.handle('dialog:pickFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your books and audiobooks folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  // The user chose this folder, so the app may read it. This and the saved
  // library are the only ways a folder becomes readable (see scanner:scanFolder).
  registerAllowedRoot(result.filePaths[0]);
  return result.filePaths[0];
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

let thumbnails: ThumbnailStore | null = null;

function getThumbnails(): ThumbnailStore {
  thumbnails ??= createThumbnailStore(path.join(app.getPath('userData'), 'thumbs'));
  return thumbnails;
}

/** Absolute cover paths for a set of items; older libraries stored some as file:/// URLs. */
function coverPathsOf(items: Array<{ coverUrl?: string }>): string[] {
  const paths: string[] = [];
  for (const { coverUrl } of items) {
    if (!coverUrl) continue;
    const raw = coverUrl.startsWith('file:///') ? decodeURI(coverUrl.slice('file:///'.length)) : coverUrl;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && isAllowedPath(raw)) paths.push(raw);
  }
  return paths;
}

function cacheKeyFor(filePath: string): string {
  return crypto.createHash('md5').update(filePath).digest('hex');
}

/** Where a cover drawn from a PDF's first page is kept (made by src/lib/pdfCovers.ts). */
function pdfCoverPathFor(filePath: string): string {
  return path.join(getCoversDir(), `${cacheKeyFor(filePath)}.pdf-page1.jpg`);
}

async function isDedicatedWorkDirectory(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const mediaFiles = entries.filter((e) => {
      if (!e.isFile()) return false;
      const ext = path.extname(e.name).toLowerCase();
      return AUDIO_EXTS.has(ext) || BOOK_EXTS.has(ext);
    });

    if (mediaFiles.length <= 1) return true;

    // Check if all files in the directory share the same base title/album (e.g. multi-track CD/chapters)
    const titles = new Set<string>();
    for (const f of mediaFiles) {
      const { title } = cleanTitle(f.name);
      titles.add(title.toLowerCase());
    }

    return titles.size === 1;
  } catch {
    return false;
  }
}

async function findOrExtractCover(
  filePath: string,
  mediaType: 'audio' | 'book',
  dirPath: string,
  fileName: string,
  existingPictureData?: Uint8Array
): Promise<string | undefined> {
  try {
    const baseName = path.parse(fileName).name;
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

    // 1. Exact baseName match in directory (e.g. Dune.jpg next to Dune.m4b or Dune.epub)
    for (const imgExt of imageExtensions) {
      const candidate = path.join(dirPath, baseName + imgExt);
      if (fs.existsSync(candidate)) return candidate;
    }

    // 2. Embedded artwork takes absolute precedence over generic folder images
    const cachedCoverPath = path.join(getCoversDir(), `${cacheKeyFor(filePath)}.jpg`);
    const isEpub = path.extname(fileName).toLowerCase() === '.epub';
    // An EPUB's cached .jpg came from the old filename guess; it is extracted afresh below.
    if (!isEpub && fs.existsSync(cachedCoverPath)) return cachedCoverPath;

    if (mediaType === 'audio') {
      try {
        let picData = existingPictureData;
        if (!picData) {
          const metadata = await mm.parseFile(filePath, { skipPostHeaders: true });
          picData = metadata.common?.picture?.[0]?.data;
        }
        if (picData && picData.length > 0) {
          await fs.promises.writeFile(cachedCoverPath, picData);
          return cachedCoverPath;
        }
      } catch {
        // Tag parsing error; fall through
      }
    }

    if (isEpub) {
      try {
        // The cover the book declares (epubCover.ts), saved under a name the old
        // guess never used, so isCacheHit can tell the two apart.
        const cover = await findEpubCover(await JSZip.loadAsync(await fs.promises.readFile(filePath)));
        if (cover) {
          const target = path.join(getCoversDir(), `${cacheKeyFor(filePath)}.epub-v2${cover.extension}`);
          await fs.promises.writeFile(target, await cover.entry.async('nodebuffer'));
          await fs.promises.unlink(cachedCoverPath).catch(() => undefined);
          return target;
        }
      } catch {
        // Malformed archive; card falls back to generated jacket.
      }
    }

    // 3. Generic directory covers (cover.jpg, folder.jpg, front.jpg, albumart.jpg):
    // ONLY allowed if this directory is dedicated to a SINGLE distinct book/work!
    // If the directory has multiple different books/titles (e.g. C:\Audiobooks or a shared author folder with 5 books),
    // generic images MUST NOT be shared across all of them — they fall back to undefined ("clean cover with just the name").
    if (await isDedicatedWorkDirectory(dirPath)) {
      for (const name of ['cover', 'folder', 'front', 'albumart']) {
        for (const imgExt of imageExtensions) {
          const candidate = path.join(dirPath, name + imgExt);
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    }

    // 4. A PDF's first page, drawn by the renderer when it had no other cover.
    if (path.extname(fileName).toLowerCase() === '.pdf' && fs.existsSync(pdfCoverPathFor(filePath))) {
      return pdfCoverPathFor(filePath);
    }
  } catch (err) {
    logError('cover', err);
  }
  return undefined;
}

interface ScannedItem {
  id: string;
  title: string;
  author: string;
  filePath: string;
  mediaType: 'audio' | 'book';
  format: string;
  fileSize: number;
  fileModifiedAt: number;
  firstSeenAt?: number;
  dateAdded?: number;
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

let scanStore: ScanStore<ScannedItem> | null = null;

/** Every file the scanner has read, kept across restarts (scanStore.ts). */
function getScanStore(): ScanStore<ScannedItem> {
  scanStore ??= createScanStore<ScannedItem>(path.join(app.getPath('userData'), 'scan_cache.json'));
  return scanStore;
}

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
      // The saved library's item first (it carries the user's edits), then the
      // scanner's own record, which also covers each file of a grouped audiobook.
      const cached = findCacheHit([itemMetadataCache.get(fullPath), getScanStore().get(fullPath)], stats);
      if (cached) {
        items.push({ ...cached, fileModifiedAt: stats.mtimeMs });
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
      let audioPictureData: Uint8Array | undefined;

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
          if (meta.common?.picture?.[0]?.data?.length) {
            audioPictureData = meta.common.picture[0].data;
          }

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
      } else if (ext === '.pdf') {
        const meta = await readPdfMetadata(fullPath);
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
        fileModifiedAt: stats.mtimeMs,
        // No first-seen date here: the renderer sets it when the item first joins the
        // library (carryForwardFirstSeenAt). The file's mtime is not when it was added.
        dirName: parentDirName,
        durationSeconds,
        coverUrl: await findOrExtractCover(fullPath, mediaType, dirPath, entry.name, audioPictureData),
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
  // The renderer names the folder but cannot widen what the app reads: script
  // in the page (a sanitiser miss in a book, say) could otherwise register C:\
  // and read any file through file:readBytes.
  if (typeof folderPath !== 'string' || !isAllowedPath(folderPath)) {
    logError('scanner', `Refused to scan a folder the user has not chosen: ${String(folderPath)}`);
    return [];
  }
  registerAllowedRoot(getCoversDir());
  await getScanStore().load();

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

  const store = getScanStore();
  store.replaceFolder(folderPath, items);
  await store.save().catch((err) => logError('scan-cache-save', err));

  return items;
});

/* ----------------------------------------------------------------- storage */

function getStorageFilePath() {
  return path.join(app.getPath('userData'), 'acuity_library.json');
}

let pendingWrite: unknown = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/*
 * Edits made outside the app.
 *
 * The MCP server (mcp-server/) edits the library file directly: progress,
 * bookmarks, collections. The app's next save, about once a second during
 * playback, used to write its own copy straight over them. So this process
 * remembers what it last wrote (`libraryBase`) and the file's stamp afterwards;
 * any other stamp means another process wrote the file. That edit goes to the
 * renderer, which merges it (src/lib/libraryMerge.ts) and saves again. Saves
 * sent before it had merged carry an older `libraryGeneration` and are dropped,
 * so none can undo the edit.
 */
let libraryBase: unknown = null;
let knownStamp: { mtimeMs: number; size: number } | null = null;
let libraryGeneration = 0;
let outsideEditCheck: Promise<boolean> = Promise.resolve(false);
let watchingLibraryFile = false;

async function stampOf(file: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const { mtimeMs, size } = await fs.promises.stat(file);
    return { mtimeMs, size };
  } catch {
    return null;
  }
}

/** Hand any edit another process made to the library file to the renderer. True if there was one. */
function checkForOutsideEdit(): Promise<boolean> {
  outsideEditCheck = outsideEditCheck.then(
    async () => {
      const file = getStorageFilePath();
      const stamp = await stampOf(file);
      const changed = stamp && (!knownStamp || stamp.mtimeMs !== knownStamp.mtimeMs || stamp.size !== knownStamp.size);
      if (!changed) return false;

      let external: unknown;
      try {
        external = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      } catch {
        return false; // Unreadable for now; look again on the next check.
      }
      knownStamp = stamp;
      libraryGeneration += 1;
      // Saves already queued predate the merge; the renderer sends a merged one.
      pendingWrite = null;
      if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
      mainWindow?.webContents.send('library:outside-edit', {
        base: libraryBase,
        external,
        generation: libraryGeneration,
      });
      libraryBase = external;
      return true;
    },
    () => false
  );
  return outsideEditCheck;
}

function watchLibraryFile() {
  if (watchingLibraryFile) return;
  watchingLibraryFile = true;
  fs.watchFile(getStorageFilePath(), { interval: 1000 }, () => void checkForOutsideEdit());
}

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
  knownStamp = await stampOf(target);
  libraryBase = data;
}

async function flushStore() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (pendingWrite === null) return;
  // An edit another process made since our last write is merged first, not written over.
  if (await checkForOutsideEdit()) return;
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
  // A (re)loaded renderer starts from what is on disk now.
  libraryGeneration = 0;
  knownStamp = await stampOf(getStorageFilePath());
  watchLibraryFile();
  try {
    const filePath = getStorageFilePath();
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      const { state: migrated, migratedCount, changed } = migrateLibraryState(parsed);
      let libraryModified = migratedCount > 0 || Boolean(changed);

      // 1. Sanitize titles for any items with shadow library markers or malformed endings
      for (const item of (migrated.items || []) as ScannedItem[]) {
        if (item.title && /(?:zblibrary|z-lib|1lib|libgen|\.sk\b|etc\.\))/i.test(item.title)) {
          const cleaned = cleanTitle(item.filePath || item.title);
          if (cleaned.title && cleaned.title !== item.title) {
            item.title = cleaned.title;
            if (cleaned.author && (!item.author || item.author === 'Unknown')) {
              item.author = cleaned.author;
            }
            libraryModified = true;
          }
        }
      }

      // 2. Identify generic covers (cover.jpg, folder.jpg) that were falsely shared across different titles
      const genericCoverTitles = new Map<string, Set<string>>();
      for (const item of (migrated.items || []) as ScannedItem[]) {
        if (item.coverUrl && /(?:cover|folder|front|albumart)\.(?:jpe?g|png|webp)$/i.test(item.coverUrl)) {
          if (!genericCoverTitles.has(item.coverUrl)) {
            genericCoverTitles.set(item.coverUrl, new Set());
          }
          genericCoverTitles.get(item.coverUrl)!.add(item.title.toLowerCase());
        }
      }

      for (const item of (migrated.items || []) as ScannedItem[]) {
        if (item.coverUrl && genericCoverTitles.has(item.coverUrl)) {
          const titles = genericCoverTitles.get(item.coverUrl)!;
          if (titles.size > 1) {
            // Shared generic cover across distinct titles!
            // Clear it so it falls back to a clean procedural cover with just the name
            item.coverUrl = undefined;
            libraryModified = true;
          }
        }
      }

      if (libraryModified) {
        logInfo('storage-load', `Sanitized library metadata and covers on load`);
        void writeStoreAtomically(migrated);
      }
      for (const item of (migrated.items || []) as ScannedItem[]) {
        if (item.filePath) {
          itemMetadataCache.set(item.filePath, item);
        }
      }
      for (const folder of migrated?.folders ?? []) registerAllowedRoot(folder);
      registerAllowedRoot(getCoversDir());
      // Drop shelf thumbnails no book uses any more.
      void getThumbnails().prune(coverPathsOf((migrated.items || []) as ScannedItem[]));
      const loaded = {
        ...migrated,
        collections: Array.isArray(migrated.collections) ? migrated.collections : [],
      };
      libraryBase = loaded;
      return loaded;
    }
  } catch (err) {
    logError('storage-load', err);
    // The empty library returned below would be saved over this file on the next change.
    const copy = await keepUnreadableLibrary(getStorageFilePath()).catch((copyErr) => {
      logError('storage-load-backup', copyErr);
      return null;
    });
    if (copy) logError('storage-load', `Library file could not be read; a copy was kept at ${copy}`);
  }
  registerAllowedRoot(getCoversDir());
  const empty = { folders: [], items: [], progress: {}, bookmarks: {}, collections: [] };
  libraryBase = empty;
  return empty;
});

/**
 * Coalesce saves.
 *
 * Playback progress updates land continuously while audio plays; debouncing
 * means steady listening costs one write per second instead of one per
 * `timeupdate` event, each of which serialises the whole library.
 */
ipcMain.handle('storage:save', async (_event, data: { folders?: string[]; items?: ScannedItem[] }, generation?: number) => {
  // Sent before the renderer merged the latest outside edit: writing it would undo that edit.
  if ((generation ?? 0) !== libraryGeneration) return true;
  // Folders are granted by the folder picker, not by saving. Keep a folder the
  // user never chose out of the file too, or it would be granted at next launch.
  if (Array.isArray(data?.folders)) {
    data = { ...data, folders: data.folders.filter((folder) => typeof folder === 'string' && isAllowedPath(folder)) };
  }
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

/* Shelf thumbnails are made by a worker in the renderer and kept by this process. */
ipcMain.handle('thumbs:missing', async (_event, sourcePaths: unknown) => {
  if (!Array.isArray(sourcePaths)) return [];
  const allowed = sourcePaths.filter((p): p is string => typeof p === 'string' && isAllowedPath(p));
  return getThumbnails().missing(allowed);
});

ipcMain.handle('thumbs:save', async (_event, sourcePath: unknown, jpeg: unknown) => {
  if (typeof sourcePath !== 'string' || !isAllowedPath(sourcePath) || !(jpeg instanceof Uint8Array)) return false;
  try {
    return await getThumbnails().save(sourcePath, jpeg);
  } catch (err) {
    logError('thumbs-save', err);
    return false;
  }
});

ipcMain.handle('covers:savePdfCover', async (_event, pdfPath: unknown, jpeg: unknown) => {
  if (typeof pdfPath !== 'string' || !isAllowedPath(pdfPath) || path.extname(pdfPath).toLowerCase() !== '.pdf') {
    return null;
  }
  if (!(jpeg instanceof Uint8Array) || !isJpeg(jpeg) || jpeg.length > MAX_THUMB_BYTES) return null;
  try {
    await fs.promises.access(pdfPath);
    const target = pdfCoverPathFor(pdfPath);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, jpeg);
    await fs.promises.rename(temp, target);
    return target;
  } catch (err) {
    logError('pdf-cover', err);
    return null;
  }
});

/** A slice of a file, so pdf.js can read only the parts of a PDF it needs. Same allowlist. */
const MAX_RANGE_BYTES = 8 * 1024 * 1024;

ipcMain.handle('file:readRange', async (_event, filePath: unknown, start: unknown, end: unknown) => {
  if (typeof filePath !== 'string' || !isAllowedPath(filePath)) return null;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    return null;
  }
  if (start < 0 || end <= start || end - start > MAX_RANGE_BYTES) return null;

  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(path.resolve(filePath), 'r');
    const { size } = await handle.stat();
    const bytes = new Uint8Array(Math.max(0, Math.min(end, size) - start));
    const { bytesRead } = bytes.length > 0 ? await handle.read(bytes, 0, bytes.length, start) : { bytesRead: 0 };
    return { bytes: bytes.subarray(0, bytesRead), size };
  } catch (err) {
    logError('file-read-range', err);
    return null;
  } finally {
    await handle?.close();
  }
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

/** Set titlebar overlay theme directly (e.g. for reader views) */
ipcMain.handle('system:setTitleBarTheme', async (_event, isDark: boolean) => {
  mainWindow?.setTitleBarOverlay(getTitleBarOverlay(isDark));
  return true;
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
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });

  app.whenReady().then(() => {
    // mcpSetup takes these by injection so it stays importable without Electron.
    configureMcpRuntime({ isPackaged: app.isPackaged, appPath: app.getAppPath() });
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
  if (BrowserWindow.getAllWindows().length === 0 || !mainWindow) {
    createMainWindow();
  } else {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
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
