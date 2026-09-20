import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  togglePin: () => Promise<boolean>;
  isPinned: () => Promise<boolean>;
  pickFolder: () => Promise<string | null>;
  scanFolder: (path: string) => Promise<any[]>;
  loadLibrary: () => Promise<any>;
  saveLibrary: (data: any) => Promise<boolean>;
  readBase64: (path: string) => Promise<string | null>;
  updateThumbar: (isPlaying: boolean) => void;
  onPlayerCommand: (callback: (command: 'toggle-play' | 'skip-back' | 'skip-forward') => void) => () => void;
  onPinChanged: (callback: (isPinned: boolean) => void) => () => void;
}

const api: ElectronAPI = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  togglePin: () => ipcRenderer.invoke('window:togglePin'),
  isPinned: () => ipcRenderer.invoke('window:isPinned'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('scanner:scanFolder', folderPath),
  loadLibrary: () => ipcRenderer.invoke('storage:load'),
  saveLibrary: (data: any) => ipcRenderer.invoke('storage:save', data),
  readBase64: (filePath: string) => ipcRenderer.invoke('file:readBase64', filePath),
  updateThumbar: (isPlaying: boolean) => ipcRenderer.send('thumbar:update', { isPlaying }),
  onPlayerCommand: (callback) => {
    const subscription = (_: any, command: any) => callback(command);
    ipcRenderer.on('player:command', subscription);
    return () => ipcRenderer.removeListener('player:command', subscription);
  },
  onPinChanged: (callback) => {
    const subscription = (_: any, pinned: boolean) => callback(pinned);
    ipcRenderer.on('window:pinned-changed', subscription);
    return () => ipcRenderer.removeListener('window:pinned-changed', subscription);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
