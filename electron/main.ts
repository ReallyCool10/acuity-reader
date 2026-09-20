import { app, BrowserWindow, dialog, ipcMain, screen, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isPinned = false;

// Create a simple 24x24 RGBA buffer for taskbar thumbnail & tray icons
function createIcon(type: 'play' | 'pause' | 'skip-back' | 'skip-forward' | 'tray'): Electron.NativeImage {
  const size = 24;
  const buffer = Buffer.alloc(size * size * 4); // RGBA

  const setPixel = (x: number, y: number, r = 240, g = 240, b = 240, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const offset = (y * size + x) * 4;
    buffer[offset] = r;
    buffer[offset + 1] = g;
    buffer[offset + 2] = b;
    buffer[offset + 3] = a;
  };

  if (type === 'play') {
    // Triangle
    for (let x = 6; x <= 18; x++) {
      const halfHeight = Math.floor((x - 6) * 0.65);
      for (let y = 12 - halfHeight; y <= 12 + halfHeight; y++) {
        setPixel(x, y);
      }
    }
  } else if (type === 'pause') {
    // Two vertical bars
    for (let y = 6; y <= 18; y++) {
      for (let x = 7; x <= 10; x++) setPixel(x, y);
      for (let x = 14; x <= 17; x++) setPixel(x, y);
    }
  } else if (type === 'skip-back') {
    // Left arrow + bar
    for (let y = 6; y <= 18; y++) setPixel(6, y);
    for (let x = 8; x <= 18; x++) {
      const h = Math.floor((18 - x) * 0.65);
      for (let y = 12 - h; y <= 12 + h; y++) setPixel(x, y);
    }
  } else if (type === 'skip-forward') {
    // Right arrow + bar
    for (let y = 6; y <= 18; y++) setPixel(18, y);
    for (let x = 6; x <= 16; x++) {
      const h = Math.floor((x - 6) * 0.65);
      for (let y = 12 - h; y <= 12 + h; y++) setPixel(x, y);
    }
  } else {
    // Minimalist Acuity "A" logo for Tray
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
        tooltip: 'Skip 15s Back',
        icon: createIcon('skip-back'),
        click() {
          mainWindow?.webContents.send('player:command', 'skip-back');
        },
      },
      {
        tooltip: isPlaying ? 'Pause' : 'Play',
        icon: createIcon(isPlaying ? 'pause' : 'play'),
        click() {
          mainWindow?.webContents.send('player:command', 'toggle-play');
        },
      },
      {
        tooltip: 'Skip 15s Forward',
        icon: createIcon('skip-forward'),
        click() {
          mainWindow?.webContents.send('player:command', 'skip-forward');
        },
      },
    ]);
  } catch (err) {
    console.error('Error updating taskbar thumbnail buttons:', err);
  }
}

function createMainWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: workX, y: workY } = primaryDisplay.workArea;

  // Window default: 1/3 screen width, full screen height, docked to the right edge
  const winWidth = Math.max(420, Math.round(screenWidth / 3));
  const winHeight = screenHeight;
  const winX = workX + screenWidth - winWidth;
  const winY = workY;

  mainWindow = new BrowserWindow({
    x: winX,
    y: winY,
    width: winWidth,
    height: winHeight,
    minWidth: 380,
    minHeight: 520,
    frame: false, // Frameless: no standard titlebar or bulky header
    titleBarStyle: 'hidden',
    backgroundColor: '#0c0d0e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Allows streaming local file:// audio and book assets
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    updateThumbarButtons(false);
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

function createTray() {
  try {
    const icon = createIcon('tray');
    tray = new Tray(icon);
    tray.setToolTip('Acuity Reader');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Acuity Reader',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show / Hide',
        click() {
          if (!mainWindow) {
            createMainWindow();
          } else if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Play / Pause',
        click() {
          mainWindow?.webContents.send('player:command', 'toggle-play');
        },
      },
      {
        label: 'Skip 15s Back',
        click() {
          mainWindow?.webContents.send('player:command', 'skip-back');
        },
      },
      {
        label: 'Skip 15s Forward',
        click() {
          mainWindow?.webContents.send('player:command', 'skip-forward');
        },
      },
      { type: 'separator' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: isPinned,
        click(menuItem) {
          isPinned = menuItem.checked;
          mainWindow?.setAlwaysOnTop(isPinned);
          mainWindow?.webContents.send('window:pinned-changed', isPinned);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Acuity',
        click() {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      if (!mainWindow) {
        createMainWindow();
      } else if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.error('Tray initialization error:', err);
  }
}

// IPC Handlers

// Window Controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:togglePin', () => {
  if (!mainWindow) return false;
  isPinned = !isPinned;
  mainWindow.setAlwaysOnTop(isPinned);
  return isPinned;
});
ipcMain.handle('window:isPinned', () => isPinned);

// Taskbar Thumbnails
ipcMain.on('thumbar:update', (_, { isPlaying }: { isPlaying: boolean }) => {
  updateThumbarButtons(isPlaying);
});

// File Dialog
ipcMain.handle('dialog:pickFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Books & Audiobooks Folder',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Automated Scanner
const AUDIO_EXTS = new Set(['.m4b', '.mp3', '.m4a', '.aac', '.flac', '.opus', '.ogg']);
const BOOK_EXTS = new Set(['.epub', '.pdf']);

function cleanTitle(filename: string): { title: string; author: string } {
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
  // Clean track numbers like "01 - Title", "01. Title"
  const cleaned = nameWithoutExt.replace(/^(\d+[\s._-]+)+/i, '').trim();

  // Check if "Author - Title" or "Title (Author)" format
  const dashMatch = cleaned.match(/^([^-]+)\s*-\s*(.+)$/);
  if (dashMatch) {
    return { author: dashMatch[1].trim(), title: dashMatch[2].trim() };
  }

  const parenMatch = cleaned.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    return { title: parenMatch[1].trim(), author: parenMatch[2].trim() };
  }

  return { title: cleaned, author: '' };
}

async function scanRecursive(dirPath: string, items: any[]): Promise<void> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden/system folders
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await scanRecursive(fullPath, items);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        let mediaType: 'audio' | 'book' | null = null;

        if (AUDIO_EXTS.has(ext)) mediaType = 'audio';
        else if (BOOK_EXTS.has(ext)) mediaType = 'book';

        if (mediaType) {
          const stats = await fs.promises.stat(fullPath);
          const parentDirName = path.basename(dirPath);
          const { title, author } = cleanTitle(entry.name);

          items.push({
            id: Buffer.from(fullPath).toString('base64'),
            title: title || entry.name,
            author: author || (parentDirName !== path.basename(path.dirname(fullPath)) ? parentDirName : 'Unknown'),
            filePath: fullPath,
            mediaType,
            format: ext.replace('.', ''),
            fileSize: stats.size,
            dateAdded: stats.mtimeMs,
            dirName: parentDirName,
          });
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }
}

ipcMain.handle('scanner:scanFolder', async (_, folderPath: string) => {
  const items: any[] = [];
  await scanRecursive(folderPath, items);

  // Companion linking: Group by directory or normalized title
  const titleMap = new Map<string, any[]>();
  for (const item of items) {
    const key = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!titleMap.has(key)) titleMap.set(key, []);
    titleMap.get(key)!.push(item);
  }

  for (const group of titleMap.values()) {
    const audioItem = group.find((i) => i.mediaType === 'audio');
    const bookItem = group.find((i) => i.mediaType === 'book');
    if (audioItem && bookItem) {
      audioItem.companionPath = bookItem.filePath;
      audioItem.companionType = bookItem.format;
      bookItem.companionPath = audioItem.filePath;
      bookItem.companionType = audioItem.format;
    }
  }

  return items;
});

// Persistent Storage
const storageFilePath = path.join(app.getPath('userData'), 'acuity_library.json');

ipcMain.handle('storage:load', async () => {
  try {
    if (fs.existsSync(storageFilePath)) {
      const data = await fs.promises.readFile(storageFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading library data:', err);
  }
  return { folders: [], items: [], progress: {}, bookmarks: {} };
});

ipcMain.handle('storage:save', async (_, data: any) => {
  try {
    await fs.promises.writeFile(storageFilePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving library data:', err);
    return false;
  }
});

// Read local file as Base64 (for PDF/EPUB rendering)
ipcMain.handle('file:readBase64', async (_, filePath: string) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return buffer.toString('base64');
  } catch (err) {
    console.error(`Error reading file ${filePath}:`, err);
    return null;
  }
});

app.whenReady().then(() => {
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
