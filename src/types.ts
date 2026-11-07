export type MediaType = 'audio' | 'book';
export type BookFormat = 'epub' | 'pdf';
export type AudioFormat = 'm4b' | 'mp3' | 'm4a' | 'aac' | 'flac' | 'ogg' | 'opus';
export type MediaFormat = BookFormat | AudioFormat;

export interface AudioChapter {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
}

export interface AudioTrack {
  id: string;
  title: string;
  filePath: string;
  durationSeconds: number;
  offsetSeconds: number;
  trackNumber?: number;
  discNumber?: number;
  chapters?: AudioChapter[];
}

export interface MediaItem {
  id: string;
  title: string;
  author: string;
  filePath: string;
  mediaType: MediaType;
  format: string;
  fileSize: number;
  /** Filesystem modification time (ms) used for fast cache hit checks on rescan. */
  fileModifiedAt: number;
  /** Timestamp (ms) when the item was first discovered or added to the library. */
  firstSeenAt: number;
  /** @deprecated Kept for migration backwards-compatibility; corresponds to firstSeenAt */
  dateAdded?: number;
  dirName: string;
  /** Present for audio when the tag reader could determine a duration. */
  durationSeconds?: number;
  companionPath?: string;
  companionType?: string;
  /** Absolute path to cover art on disk; rendered via the acuity:// scheme. */
  coverUrl?: string;
  trackNumber?: number;
  discNumber?: number;
  album?: string;
  chapters?: AudioChapter[];
  /** For multi-file audiobooks, constituent audio tracks in chronological order */
  tracks?: AudioTrack[];
  /**
   * IDs this item was previously known by. Progress, bookmarks and collection
   * members still keyed by one of these are moved to `id` on load.
   */
  legacyIds?: string[];
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
  /** When the item was first opened (ms). Set once, kept through later sessions. */
  startedAt?: number;
  /**
   * When the item was finished (ms): reached the end, or marked finished by
   * the user. Cleared only by "Mark as not finished".
   */
  finishedAt?: number;
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

export type CollectionKind = 'series' | 'theme';

export interface Collection {
  id: string;
  name: string;
  description?: string;
  kind: CollectionKind;
  /** Ordered list of stable item IDs (computeStableId). Order is surfaced in the UI when kind === 'series'. */
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * The register: one entry for every title the library has ever held, kept
 * after the title is removed or its folder disconnected. Progress, bookmarks
 * and collection membership live in the library file keyed by the same ID, so
 * a title that comes back - the same file, or a copy elsewhere - finds them.
 */
export interface CatalogEntry {
  id: string;
  title: string;
  author: string;
  mediaType: MediaType;
  format: string;
  /** Where the file was last found. */
  lastPath: string;
  firstSeenAt: number;
  /** Last time a scan found the file. */
  lastSeenAt: number;
  /**
   * Set when the user removed the title from the library. Rescans leave it out
   * until it is restored or its folder is added again.
   */
  removedAt?: number;
  /** Earlier IDs of this title, so data filed under them can still be found. */
  legacyIds?: string[];
}

/** A stretch of reading or listening: progress updates no more than a few minutes apart. */
export interface ReadingSession {
  itemId: string;
  startedAt: number;
  endedAt: number;
  /** 0-100, like ProgressItem.percent. */
  startPercent: number;
  endPercent: number;
}

export interface LibraryState {
  folders: string[];
  items: MediaItem[];
  progress: Record<string, ProgressItem>;
  bookmarks: Record<string, Bookmark[]>;
  collections: Collection[];
  /** Every title ever seen, by ID. Optional: files written before it existed have none. */
  catalog?: Record<string, CatalogEntry>;
  /** Reading sessions, oldest first, capped in length. */
  history?: ReadingSession[];
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

export type AppTheme = 'system' | 'dark' | 'light';

export interface ThemeInfo {
  isDark: boolean;
  accentColor: string | null;
}

export interface EdgeVoice {
  name: string;
  friendlyName: string;
  locale: string;
  gender: 'Female' | 'Male';
  suggested?: boolean;
}

export interface EdgeBoundary {
  offsetMs: number;
  durationMs: number;
  text: string;
  length: number;
  type: 'word' | 'sentence';
}

export interface EdgeSynthesisResult {
  audioBase64: string;
  mimeType: string;
  boundaries: EdgeBoundary[];
}

export interface SynthesisOptions {
  text: string;
  voice?: string;
  rate?: number;
  pitch?: number;
}

export interface OfflineVoiceStatus {
  /** The model is downloaded and verified. */
  installed: boolean;
  /** A download is running now. */
  downloading: boolean;
  /** Size of the download, in bytes. */
  downloadBytes: number;
}

export interface McpClientInfo {
  id: 'claude' | 'cursor' | 'antigravity' | 'windsurf';
  name: string;
  description: string;
  detected: boolean;
  installed: boolean;
  configPath: string;
}

export interface McpSetupResult {
  success: boolean;
  message?: string;
}


