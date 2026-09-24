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
  fileModifiedAt?: number;
  firstSeenAt?: number;
  dateAdded?: number;
  dirName: string;
  durationSeconds?: number;
  companionPath?: string;
  companionType?: string;
  coverUrl?: string;
}

export interface StoredCollection {
  id: string;
  name: string;
  description?: string;
  kind: 'series' | 'theme';
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredLibraryState {
  folders?: string[];
  items?: StoredMediaItem[];
  progress?: Record<string, StoredProgressItem>;
  bookmarks?: Record<string, StoredBookmark[]>;
  collections?: StoredCollection[];
}

/**
 * Migrate legacy path-keyed library state to stable IDs.
 *
 * Rewrites items[].id, progress keys & id, bookmarks keys & itemId,
 * and collections[].memberIds.
 * Returns the migrated state and the number of migrated IDs.
 */
export function migrateLibraryState(state: StoredLibraryState): {
  state: StoredLibraryState;
  migratedCount: number;
  changed: boolean;
} {
  if (!state || !Array.isArray(state.items)) {
    return {
      state: {
        ...(state || {}),
        collections: Array.isArray(state?.collections) ? state.collections : [],
      },
      migratedCount: 0,
      changed: false,
    };
  }

  const items = [...state.items];
  const progress: Record<string, StoredProgressItem> = { ...(state.progress || {}) };
  const bookmarks: Record<string, StoredBookmark[]> = { ...(state.bookmarks || {}) };
  const rawCollections = Array.isArray(state.collections) ? state.collections : [];
  const idMap = new Map<string, string>();
  let migratedCount = 0;
  let changed = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const oldId = item.id;
    const newId = computeStableId(item.title, item.author, item.fileSize, item.filePath);
    const targetId = newId || oldId;

    const fileModifiedAt = item.fileModifiedAt ?? item.dateAdded ?? Date.now();
    const firstSeenAt = item.firstSeenAt ?? item.dateAdded ?? fileModifiedAt;
    const datesChanged = item.fileModifiedAt !== fileModifiedAt || item.firstSeenAt !== firstSeenAt;

    if (oldId !== targetId || datesChanged) {
      if (oldId !== targetId) {
        migratedCount++;
        idMap.set(oldId, targetId);
      }
      changed = true;
      items[i] = {
        ...item,
        id: targetId,
        fileModifiedAt,
        firstSeenAt,
        dateAdded: firstSeenAt,
      };

      // Migrate progress entry if present under old ID
      if (oldId !== targetId) {
        if (progress[oldId]) {
          progress[targetId] = { ...progress[oldId], id: targetId };
          delete progress[oldId];
        }

        // Migrate bookmarks array if present under old ID
        if (bookmarks[oldId]) {
          bookmarks[targetId] = bookmarks[oldId].map((bm) => ({
            ...bm,
            itemId: targetId,
          }));
          delete bookmarks[oldId];
        }
      }
    }
  }

  // Remap member IDs in collections
  const collections = rawCollections.map((col) => {
    let collectionChanged = false;
    const newMemberIds = (col.memberIds || []).map((mid) => {
      const mapped = idMap.get(mid);
      if (mapped && mapped !== mid) {
        collectionChanged = true;
        return mapped;
      }
      return mid;
    });
    if (collectionChanged) changed = true;
    return collectionChanged ? { ...col, memberIds: newMemberIds } : col;
  });

  return {
    state: {
      ...state,
      items,
      progress,
      bookmarks,
      collections,
    },
    migratedCount,
    changed: changed || migratedCount > 0,
  };
}
