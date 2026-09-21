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
  /** Present for audio when the tag reader could determine a duration. */
  durationSeconds?: number;
  companionPath?: string;
  companionType?: string;
  /** Absolute path to cover art on disk; rendered via the acuity:// scheme. */
  coverUrl?: string;
}

export interface ProgressItem {
  id: string;
  /** Audio position, in seconds. */
  currentTime?: number;
  duration?: number;
  /** Reader position: index into the parsed spine, plus scroll offset within it. */
  chapterIndex?: number;
  chapterScroll?: number;
  percent: number;
  lastPlayed: number;
}

export interface Bookmark {
  id: string;
  itemId: string;
  label: string;
  createdAt: number;
  /** Seconds for audio, chapter index for books. */
  position: number;
  /** Surrounding text, so a bookmark is recognisable in a list. */
  excerpt?: string;
  note?: string;
}

export interface LibraryState {
  folders: string[];
  items: MediaItem[];
  progress: Record<string, ProgressItem>;
  bookmarks: Record<string, Bookmark[]>;
}

export type SortKey = 'recent' | 'title' | 'author' | 'added';

export interface ActiveAudioTrack {
  item: MediaItem;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  volume: number;
}
