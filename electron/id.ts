import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Normalise a metadata string (casing, excess whitespace, punctuation).
 */
export function normalizeString(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Derive a stable, portable ID for a media item.
 *
 * Unlike absolute file paths (which break bookmarks and reading progress whenever
 * a folder is moved, a drive letter changes, or a file is renamed), this ID is
 * computed from content identifiers: normalised title, author, and file size.
 *
 * If title and author are unknown/empty, falls back to normalised filename stem + size.
 */
export function computeStableId(
  title: string | undefined | null,
  author: string | undefined | null,
  fileSize: number,
  filePath?: string
): string {
  const normTitle = normalizeString(title);
  const normAuthor = normalizeString(author);

  let identity: string;
  const isTitleUnknown = !normTitle || normTitle === 'unknown';
  const isAuthorUnknown = !normAuthor || normAuthor === 'unknown';

  if (!isTitleUnknown && !isAuthorUnknown) {
    identity = `t:${normTitle}|a:${normAuthor}|s:${fileSize}`;
  } else if (!isTitleUnknown) {
    identity = `t:${normTitle}|s:${fileSize}`;
  } else if (filePath) {
    const stem = normalizeString(path.basename(filePath, path.extname(filePath)));
    identity = `stem:${stem}|s:${fileSize}`;
  } else {
    identity = `s:${fileSize}|t:${normTitle || 'untitled'}`;
  }

  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

/**
 * Test if an ID looks like the old base64 path format.
 * Legacy IDs were `Buffer.from(fullPath).toString('base64')`, which decodes to a path.
 */
export function isLegacyPathId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  // Stable IDs are exactly 16 hex characters.
  if (/^[0-9a-f]{16}$/i.test(id)) return false;

  try {
    const decoded = Buffer.from(id, 'base64').toString('utf8');
    // If it contains path separators or Windows drive letter, it's a legacy path ID.
    return decoded.includes('/') || decoded.includes('\\') || /^[a-zA-Z]:/.test(decoded);
  } catch {
    return false;
  }
}

export interface StoredProgressItem {
  id: string;
  currentTime?: number;
  duration?: number;
  chapterIndex?: number;
  chapterScroll?: number;
  percent: number;
  lastPlayed: number;
}

export interface StoredBookmark {
  id: string;
  itemId: string;
  label: string;
  createdAt: number;
  position: number;
  excerpt?: string;
  note?: string;
}

export interface StoredMediaItem {
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
}

export interface StoredLibraryState {
  folders?: string[];
  items?: StoredMediaItem[];
  progress?: Record<string, StoredProgressItem>;
  bookmarks?: Record<string, StoredBookmark[]>;
}

/**
 * Migrate legacy path-keyed library state to stable IDs.
 *
 * Rewrites items[].id, progress keys & id, and bookmarks keys & itemId.
 * Returns the migrated state and the number of migrated IDs.
 */
export function migrateLibraryState(state: StoredLibraryState): {
  state: StoredLibraryState;
  migratedCount: number;
} {
  if (!state || !Array.isArray(state.items)) {
    return { state: state || {}, migratedCount: 0 };
  }

  const items = [...state.items];
  const progress: Record<string, StoredProgressItem> = { ...(state.progress || {}) };
  const bookmarks: Record<string, StoredBookmark[]> = { ...(state.bookmarks || {}) };
  let migratedCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const oldId = item.id;
    const newId = computeStableId(item.title, item.author, item.fileSize, item.filePath);

    if (oldId !== newId) {
      migratedCount++;
      items[i] = { ...item, id: newId };

      // Migrate progress entry if present under old ID
      if (progress[oldId]) {
        progress[newId] = { ...progress[oldId], id: newId };
        delete progress[oldId];
      }

      // Migrate bookmarks array if present under old ID
      if (bookmarks[oldId]) {
        bookmarks[newId] = bookmarks[oldId].map((bm) => ({
          ...bm,
          itemId: newId,
        }));
        delete bookmarks[oldId];
      }
    }
  }

  return {
    state: {
      ...state,
      items,
      progress,
      bookmarks,
    },
    migratedCount,
  };
}
