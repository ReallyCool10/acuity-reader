import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Bookmark, LibraryState, MediaItem, ProgressItem } from '../src/types';

/**
 * Resolve the path to acuity_library.json.
 * Follows environment variable, Windows Roaming AppData, and user config locations.
 */
export function getLibraryStoragePath(): string {
  if (process.env.ACUITY_STORAGE_PATH && fs.existsSync(process.env.ACUITY_STORAGE_PATH)) {
    return process.env.ACUITY_STORAGE_PATH;
  }

  const appData = process.env.APPDATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config'));

  const candidateDirs = [
    path.join(appData, 'Acuity Reader'),
    path.join(appData, 'acuity-reader'),
    path.join(appData, 'AcuityReader'),
    path.join(os.homedir(), '.config', 'acuity-reader'),
  ];

  for (const dir of candidateDirs) {
    const candidateFile = path.join(dir, 'acuity_library.json');
    if (fs.existsSync(candidateFile)) {
      return candidateFile;
    }
  }

  // Fallback default target path
  return path.join(candidateDirs[0], 'acuity_library.json');
}

/**
 * Load the library state from disk.
 */
export async function loadLibraryState(customPath?: string): Promise<LibraryState> {
  const filePath = customPath || getLibraryStoragePath();
  try {
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content) as Partial<LibraryState>;
      return {
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        items: Array.isArray(parsed.items) ? parsed.items : [],
        progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {},
        bookmarks: parsed.bookmarks && typeof parsed.bookmarks === 'object' ? parsed.bookmarks : {},
      };
    }
  } catch (err) {
    console.error(`[acuity-mcp] Failed to read library file at ${filePath}:`, err);
  }

  return {
    folders: [],
    items: [],
    progress: {},
    bookmarks: {},
  };
}

/**
 * Save the library state to disk atomically using a temp file and rename.
 */
export async function saveLibraryState(state: LibraryState, customPath?: string): Promise<void> {
  const filePath = customPath || getLibraryStoragePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
  await fs.promises.rename(tempPath, filePath);
}

export interface ListBooksFilter {
  query?: string;
  mediaType?: 'book' | 'audio' | 'all';
  format?: string;
  inProgressOnly?: boolean;
  limit?: number;
}

export interface BookWithContext extends MediaItem {
  progress?: ProgressItem;
  bookmarksCount: number;
}

/**
 * Search and filter items in the library.
 */
export async function listBooks(
  filter: ListBooksFilter = {},
  customPath?: string
): Promise<{ totalMatches: number; books: BookWithContext[] }> {
  const state = await loadLibraryState(customPath);
  let items = state.items;

  if (filter.mediaType && filter.mediaType !== 'all') {
    items = items.filter((item) => item.mediaType === filter.mediaType);
  }

  if (filter.format && filter.format !== 'all') {
    const targetFormat = filter.format.toLowerCase().replace(/^\./, '');
    items = items.filter((item) => item.format.toLowerCase() === targetFormat);
  }

  if (filter.inProgressOnly) {
    items = items.filter((item) => {
      const prog = state.progress[item.id];
      if (!prog) return false;
      const pct = normalizePercent(prog.percent);
      return pct > 0 && pct < 99.5;
    });
  }

  if (filter.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase();
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.filePath.toLowerCase().includes(q) ||
        item.dirName.toLowerCase().includes(q)
    );
  }

  const totalMatches = items.length;
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 50;
  const sliced = items.slice(0, limit);

  const books: BookWithContext[] = sliced.map((item) => ({
    ...item,
    progress: state.progress[item.id],
    bookmarksCount: (state.bookmarks[item.id] || []).length,
  }));

  return { totalMatches, books };
}

/**
 * Find a specific book by stable ID or title.
 */
export async function getBook(
  idOrTitle: string,
  customPath?: string
): Promise<{ book: MediaItem; progress?: ProgressItem; bookmarks: Bookmark[] } | null> {
  const state = await loadLibraryState(customPath);
  const trimmed = idOrTitle.trim();

  // Try exact ID match first
  let item = state.items.find((i) => i.id === trimmed);

  // Fallback to case-insensitive exact title or fuzzy title match
  if (!item) {
    const lower = trimmed.toLowerCase();
    item =
      state.items.find((i) => i.title.toLowerCase() === lower) ||
      state.items.find((i) => i.title.toLowerCase().includes(lower));
  }

  if (!item) return null;

  return {
    book: item,
    progress: state.progress[item.id],
    bookmarks: state.bookmarks[item.id] || [],
  };
}

export interface ProgressSummary {
  bookId: string;
  title: string;
  author: string;
  mediaType: string;
  format: string;
  percent: number;
  chapterIndex?: number;
  currentTime?: number;
  duration?: number;
  lastPlayed: number;
  lastPlayedFormatted: string;
}

/**
 * Get reading or listening progress.
 */
export async function getReadingProgress(
  bookId?: string,
  customPath?: string
): Promise<ProgressSummary[]> {
  const state = await loadLibraryState(customPath);
  const itemMap = new Map(state.items.map((i) => [i.id, i]));

  const entries: ProgressSummary[] = [];

  if (bookId) {
    const prog = state.progress[bookId];
    const item = itemMap.get(bookId);
    if (prog && item) {
      entries.push({
        bookId: item.id,
        title: item.title,
        author: item.author,
        mediaType: item.mediaType,
        format: item.format,
        percent: normalizePercent(prog.percent),
        chapterIndex: prog.chapterIndex,
        currentTime: prog.currentTime,
        duration: prog.duration,
        lastPlayed: prog.lastPlayed,
        lastPlayedFormatted: new Date(prog.lastPlayed).toISOString(),
      });
    }
    return entries;
  }

  // Return all progress entries sorted by lastPlayed descending (most recent first)
  const allEntries = Object.entries(state.progress)
    .map(([id, prog]) => {
      const item = itemMap.get(id);
      if (!item) return null;
      return {
        bookId: item.id,
        title: item.title,
        author: item.author,
        mediaType: item.mediaType,
        format: item.format,
        percent: normalizePercent(prog.percent),
        chapterIndex: prog.chapterIndex,
        currentTime: prog.currentTime,
        duration: prog.duration,
        lastPlayed: prog.lastPlayed,
        lastPlayedFormatted: new Date(prog.lastPlayed).toISOString(),
      };
    })
    .filter((entry): entry is ProgressSummary => entry !== null)
    .sort((a, b) => b.lastPlayed - a.lastPlayed);

  return allEntries;
}

/**
 * Update reading progress for a book.
 */
export async function updateReadingProgress(
  bookId: string,
  updates: { chapterIndex?: number; percent: number; currentTime?: number; chapterScroll?: number },
  customPath?: string
): Promise<ProgressItem> {
  const state = await loadLibraryState(customPath);
  const existing = state.progress[bookId] || {
    id: bookId,
    percent: 0,
    lastPlayed: Date.now(),
  };

  const updated: ProgressItem = {
    ...existing,
    chapterIndex: updates.chapterIndex !== undefined ? updates.chapterIndex : existing.chapterIndex,
    currentTime: updates.currentTime !== undefined ? updates.currentTime : existing.currentTime,
    chapterScroll: updates.chapterScroll !== undefined ? updates.chapterScroll : existing.chapterScroll,
    percent: normalizePercent(updates.percent),
    lastPlayed: Date.now(),
  };

  state.progress[bookId] = updated;
  await saveLibraryState(state, customPath);
  return updated;
}

export interface BookmarkWithContext extends Bookmark {
  bookTitle: string;
  bookAuthor: string;
  createdAtFormatted: string;
}

/**
 * List bookmarks, optionally filtered by bookId.
 */
export async function listBookmarks(
  bookId?: string,
  customPath?: string
): Promise<BookmarkWithContext[]> {
  const state = await loadLibraryState(customPath);
  const itemMap = new Map(state.items.map((i) => [i.id, i]));
  const results: BookmarkWithContext[] = [];

  const targetIds = bookId ? [bookId] : Object.keys(state.bookmarks);

  for (const id of targetIds) {
    const list = state.bookmarks[id] || [];
    const item = itemMap.get(id);
    for (const bm of list) {
      results.push({
        ...bm,
        bookTitle: item ? item.title : 'Unknown Title',
        bookAuthor: item ? item.author : 'Unknown Author',
        createdAtFormatted: new Date(bm.createdAt).toISOString(),
      });
    }
  }

  // Sort by createdAt descending (newest first)
  results.sort((a, b) => b.createdAt - a.createdAt);
  return results;
}

/**
 * Add a bookmark or note to a book.
 */
export async function addBookmark(
  bookId: string,
  bookmarkData: { position: number; label?: string; excerpt?: string; note?: string },
  customPath?: string
): Promise<Bookmark> {
  const state = await loadLibraryState(customPath);
  if (!state.bookmarks[bookId]) {
    state.bookmarks[bookId] = [];
  }

  const now = Date.now();
  const newBookmark: Bookmark = {
    id: `${bookId}-${now}`,
    itemId: bookId,
    position: bookmarkData.position,
    label: bookmarkData.label || `Location ${bookmarkData.position + 1}`,
    createdAt: now,
    excerpt: bookmarkData.excerpt,
    note: bookmarkData.note,
  };

  state.bookmarks[bookId].push(newBookmark);
  await saveLibraryState(state, customPath);
  return newBookmark;
}

/**
 * Delete a bookmark by ID.
 */
export async function deleteBookmark(
  bookId: string,
  bookmarkId: string,
  customPath?: string
): Promise<boolean> {
  const state = await loadLibraryState(customPath);
  const list = state.bookmarks[bookId];
  if (!list) return false;

  const initialLength = list.length;
  state.bookmarks[bookId] = list.filter((b) => b.id !== bookmarkId);

  if (state.bookmarks[bookId].length < initialLength) {
    await saveLibraryState(state, customPath);
    return true;
  }

  return false;
}

/**
 * Normalize percentage so values are strictly between 0 and 100.
 * Handles both legacy 0-1 ratios (e.g. 0.35) and 0-100 percentage numbers.
 */
export function normalizePercent(raw: number): number {
  if (typeof raw !== 'number' || isNaN(raw) || raw <= 0) return 0;
  const val = raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Math.round(val * 10) / 10));
}

export interface CurrentlyReadingItem extends ProgressSummary {
  filePath: string;
  bookmarksCount: number;
  latestBookmark?: {
    id: string;
    label: string;
    excerpt?: string;
    note?: string;
    position: number;
  };
  companionPath?: string;
  companionType?: string;
}

/**
 * Get all books and audiobooks actively in-progress (0% < progress < 99.5%).
 */
export async function getCurrentlyReading(customPath?: string): Promise<CurrentlyReadingItem[]> {
  const state = await loadLibraryState(customPath);
  const itemMap = new Map(state.items.map((i) => [i.id, i]));

  const active = Object.entries(state.progress)
    .map(([id, prog]) => {
      const item = itemMap.get(id);
      if (!item) return null;
      const pct = normalizePercent(prog.percent);
      if (pct <= 0 || pct >= 99.5) return null;

      const bookmarks = state.bookmarks[id] || [];
      const latestBookmark = bookmarks.length > 0 ? bookmarks[bookmarks.length - 1] : undefined;

      return {
        bookId: item.id,
        title: item.title,
        author: item.author,
        mediaType: item.mediaType,
        format: item.format,
        filePath: item.filePath,
        percent: pct,
        chapterIndex: prog.chapterIndex,
        currentTime: prog.currentTime,
        duration: prog.duration,
        lastPlayed: prog.lastPlayed,
        lastPlayedFormatted: new Date(prog.lastPlayed).toISOString(),
        bookmarksCount: bookmarks.length,
        latestBookmark,
        companionPath: item.companionPath,
        companionType: item.companionType,
      };
    })
    .filter((e): e is CurrentlyReadingItem => e !== null)
    .sort((a, b) => b.lastPlayed - a.lastPlayed);

  return active;
}

/**
 * Edit an existing bookmark's label, note, or excerpt.
 */
export async function updateBookmark(
  bookId: string,
  bookmarkId: string,
  updates: { label?: string; note?: string; excerpt?: string },
  customPath?: string
): Promise<Bookmark | null> {
  const state = await loadLibraryState(customPath);
  const list = state.bookmarks[bookId];
  if (!list) return null;

  const target = list.find((b) => b.id === bookmarkId);
  if (!target) return null;

  if (updates.label !== undefined) target.label = updates.label;
  if (updates.note !== undefined) target.note = updates.note;
  if (updates.excerpt !== undefined) target.excerpt = updates.excerpt;

  await saveLibraryState(state, customPath);
  return target;
}

/**
 * Generate a complete Markdown summary of the user's reading activity.
 */
export async function exportReadingSummaryMarkdown(customPath?: string): Promise<string> {
  const stats = await getLibraryStats(customPath);
  const currentlyReading = await getCurrentlyReading(customPath);
  const bookmarks = await listBookmarks(undefined, customPath);

  const lines: string[] = [
    `# 📚 Acuity Reader — Reading Summary`,
    ``,
    `*Generated on ${new Date().toLocaleDateString(undefined, { dateStyle: 'full' })}*`,
    ``,
    `## 📊 Library Overview`,
    `- **Total Items**: ${stats.totalItems} (${stats.totalBooks} books, ${stats.totalAudiobooks} audiobooks)`,
    `- **Formats**: ${Object.entries(stats.formats).map(([f, n]) => `${f.toUpperCase()} (${n})`).join(', ')}`,
    `- **Currently In-Progress**: ${currentlyReading.length}`,
    `- **Saved Bookmarks & Notes**: ${stats.totalBookmarks}`,
    ``,
    `## 📖 Currently Reading`,
  ];

  if (currentlyReading.length === 0) {
    lines.push(`*No books currently in progress.*`);
  } else {
    for (const item of currentlyReading) {
      const barFilled = Math.round(item.percent / 10);
      const bar = '█'.repeat(barFilled) + '░'.repeat(10 - barFilled);
      lines.push(`### ${item.title}`);
      lines.push(`- **Author**: ${item.author}`);
      lines.push(`- **Format**: ${item.format.toUpperCase()} (${item.mediaType})`);
      lines.push(`- **Progress**: \`[${bar}]\` **${item.percent}%**`);
      if (item.chapterIndex !== undefined) {
        lines.push(`- **Current Location**: Chapter/Page ${item.chapterIndex + 1}`);
      }
      lines.push(`- **Last Read**: ${item.lastPlayedFormatted}`);
      if (item.latestBookmark) {
        lines.push(`- **Latest Note**: *"${item.latestBookmark.label}"* ${item.latestBookmark.excerpt ? `— \`${item.latestBookmark.excerpt.slice(0, 100)}\`` : ''}`);
      }
      lines.push(``);
    }
  }

  lines.push(`## 🔖 Recent Notes & Bookmarks`);
  const recentBookmarks = bookmarks.slice(0, 10);
  if (recentBookmarks.length === 0) {
    lines.push(`*No saved bookmarks yet.*`);
  } else {
    for (const bm of recentBookmarks) {
      lines.push(`- **${bm.bookTitle}**: **${bm.label}**`);
      if (bm.excerpt) lines.push(`  > "${bm.excerpt}"`);
      if (bm.note) lines.push(`  *Note:* ${bm.note}`);
    }
  }

  return lines.join('\n');
}

export interface LibraryStats {
  totalItems: number;
  totalBooks: number;
  totalAudiobooks: number;
  formats: Record<string, number>;
  activeReadingCount: number;
  totalBookmarks: number;
  libraryFolders: string[];
}

/**
 * Return summary statistics for the user's Acuity library.
 */
export async function getLibraryStats(customPath?: string): Promise<LibraryStats> {
  const state = await loadLibraryState(customPath);
  const formats: Record<string, number> = {};
  let totalBooks = 0;
  let totalAudiobooks = 0;

  for (const item of state.items) {
    if (item.mediaType === 'book') totalBooks++;
    else if (item.mediaType === 'audio') totalAudiobooks++;

    const fmt = item.format.toLowerCase();
    formats[fmt] = (formats[fmt] || 0) + 1;
  }

  const activeReadingCount = Object.values(state.progress).filter(
    (p) => {
      const pct = normalizePercent(p.percent);
      return pct > 0 && pct < 99.5;
    }
  ).length;

  let totalBookmarks = 0;
  for (const list of Object.values(state.bookmarks)) {
    totalBookmarks += list.length;
  }

  return {
    totalItems: state.items.length,
    totalBooks,
    totalAudiobooks,
    formats,
    activeReadingCount,
    totalBookmarks,
    libraryFolders: state.folders,
  };
}
