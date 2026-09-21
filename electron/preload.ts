import { contextBridge, ipcRenderer } from 'electron';
import type { LibraryState, MediaItem, ThemeInfo } from '../src/types';

export interface ScanProgress {
  count: number;
  folder: string;
}

export type PlayerCommand = 'toggle-play' | 'skip-back' | 'skip-forward';

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  togglePin: () => Promise<boolean>;
  isPinned: () => Promise<boolean>;
  pickFolder: () => Promise<string | null>;
  revealInFolder: (path: string) => Promise<void>;
  scanFolder: (path: string) => Promise<MediaItem[]>;
  loadLibrary: () => Promise<LibraryState>;
  saveLibrary: (data: LibraryState) => Promise<boolean>;
  readBytes: (path: string) => Promise<Uint8Array | null>;
  updateThumbar: (isPlaying: boolean) => void;
  getThemeInfo: () => Promise<ThemeInfo>;
  onThemeChanged: (callback: (info: ThemeInfo) => void) => () => void;
  onPlayerCommand: (callback: (command: PlayerCommand) => void) => () => void;
  onPinChanged: (callback: (isPinned: boolean) => void) => () => void;
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void;
}

/** Wrap an ipcRenderer subscription so callers get an unsubscribe function back. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ElectronAPI = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  togglePin: () => ipcRenderer.invoke('window:togglePin'),
  isPinned: () => ipcRenderer.invoke('window:isPinned'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:revealInFolder', filePath),
  scanFolder: (folderPath) => ipcRenderer.invoke('scanner:scanFolder', folderPath),
  loadLibrary: () => ipcRenderer.invoke('storage:load'),
  saveLibrary: (data) => ipcRenderer.invoke('storage:save', data),
  readBytes: (filePath) => ipcRenderer.invoke('file:readBytes', filePath),
  updateThumbar: (isPlaying) => ipcRenderer.send('thumbar:update', { isPlaying }),
  getThemeInfo: () => ipcRenderer.invoke('system:getThemeInfo'),
  onThemeChanged: (callback) => subscribe('system:theme-changed', callback),
  onPlayerCommand: (callback) => subscribe('player:command', callback),
  onPinChanged: (callback) => subscribe('window:pinned-changed', callback),
  onScanProgress: (callback) => subscribe('scanner:progress', callback),
};

contextBridge.exposeInMainWorld('electronAPI', api);
