export type MediaType = 'audio' | 'book';
export type BookFormat = 'epub' | 'pdf';
export type AudioFormat = 'm4b' | 'mp3' | 'm4a' | 'aac' | 'flac' | 'ogg' | 'opus';
export type MediaFormat = BookFormat | AudioFormat;

export interface MediaItem {
  id: string;
  title: string;
  author: string;
  filePath: string;
  mediaType: MediaType;
  format: string;
  fileSize: number;
  dateAdded: number;
  dirName: string;
  companionPath?: string;
  companionType?: string;
  coverUrl?: string;
}

export interface ProgressItem {
  id: string;
  currentTime?: number;
  duration?: number;
  epubCfi?: string;
  pdfPage?: number;
  percent: number;
  lastPlayed: number;
}

export interface Bookmark {
  id: string;
  itemId: string;
  label: string;
  createdAt: number;
  position: number | string; // seconds for audio, CFI or page for book
  note?: string;
}

export interface LibraryState {
  folders: string[];
  items: MediaItem[];
  progress: Record<string, ProgressItem>;
  bookmarks: Record<string, Bookmark[]>;
}

export interface ActiveAudioTrack {
  item: MediaItem;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  volume: number;
}
