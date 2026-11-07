import type { Bookmark, CatalogEntry, MediaItem, ProgressItem } from '../types';
import { cleanTitleString } from './metadata';

/*
 * The catalogue: the library's register of every title it has held.
 *
 * Reader data (progress, bookmarks, collections, reading history) is kept in
 * one central file, keyed by item ID, and is never deleted when a title leaves
 * the library. The catalogue is what lets that data find its way back:
 *
 * - Removing a title marks its entry `removedAt`; rescans of a folder that
 *   still holds the file leave it out until the user restores it.
 * - Disconnecting a folder leaves its entries in place. Adding the folder back
 *   brings the same files back under the same IDs, so their data is simply
 *   still there.
 * - A re-imported copy whose ID differs (a re-download of a different size,
 *   say) is matched to its old entry by title, author and format, and the old
 *   ID is recorded in `legacyIds` so `migrateLegacyItemIds` moves the data.
 */

/** Lower-case, accents and punctuation stripped, whitespace collapsed. */
function normalise(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * What makes two files "the same title" for re-import matching. Format is part
 * of it: a PDF position means nothing in an EPUB, nor an MP3 time in an M4B.
 */
export function titleKey(item: Pick<MediaItem, 'title' | 'author' | 'mediaType' | 'format'>): string | null {
  const title = normalise(cleanTitleString(item.title) || item.title);
  if (!title || title === 'unknown' || title === 'untitled') return null;
  const author = normalise(item.author);
  return `${item.mediaType}|${item.format.toLowerCase()}|${title}|${author === 'unknown' ? '' : author}`;
}

/** Find a title's entry by its ID or any ID it was known by before. */
function entryFor(catalog: Record<string, CatalogEntry>, item: MediaItem): CatalogEntry | undefined {
  if (catalog[item.id]) return catalog[item.id];
  for (const legacy of item.legacyIds ?? []) {
    if (catalog[legacy]) return catalog[legacy];
  }
  return undefined;
}

/**
 * Leave out titles the user removed. Returns the IDs left out as well: those
 * files are still on disk, so their entries must not be claimed by another
 * copy in `reconnectReimported`.
 */
export function excludeRemoved(
  catalog: Record<string, CatalogEntry> | undefined,
  items: MediaItem[]
): { items: MediaItem[]; excludedIds: Set<string> } {
  const excludedIds = new Set<string>();
  if (!catalog) return { items, excludedIds };
  const kept = items.filter((item) => {
    const entry = entryFor(catalog, item);
    if (entry?.removedAt) {
      excludedIds.add(entry.id);
      return false;
    }
    return true;
  });
  return { items: kept, excludedIds };
}

/**
 * Point newly found items at the catalogue entry of the same title, when the
 * item is new to the catalogue and exactly one absent entry matches. The old
 * ID goes into `legacyIds`; `migrateLegacyItemIds` then moves its data.
 *
 * Deliberately conservative: an ambiguous match (two absent entries with the
 * same title) connects nothing, since moving one book's progress onto another
 * is worse than starting afresh.
 */
export function reconnectReimported(
  catalog: Record<string, CatalogEntry> | undefined,
  items: MediaItem[],
  progress: Record<string, ProgressItem>,
  bookmarks: Record<string, Bookmark[]>,
  excludedIds: Set<string> = new Set()
): MediaItem[] {
  if (!catalog) return items;

  const present = new Set<string>();
  for (const item of items) {
    present.add(item.id);
    for (const legacy of item.legacyIds ?? []) present.add(legacy);
  }

  const absentByKey = new Map<string, CatalogEntry[]>();
  for (const entry of Object.values(catalog)) {
    if (present.has(entry.id) || excludedIds.has(entry.id)) continue;
    const key = titleKey(entry);
    if (!key) continue;
    absentByKey.set(key, [...(absentByKey.get(key) ?? []), entry]);
  }
  if (absentByKey.size === 0) return items;

  // Items new to the catalogue, by title; two new copies of one title claim nothing.
  const newByKey = new Map<string, number>();
  for (const item of items) {
    if (entryFor(catalog, item) || progress[item.id] || bookmarks[item.id]) continue;
    const key = titleKey(item);
    if (key) newByKey.set(key, (newByKey.get(key) ?? 0) + 1);
  }

  return items.map((item) => {
    if (entryFor(catalog, item) || progress[item.id] || bookmarks[item.id]) return item;
    const key = titleKey(item);
    if (!key || newByKey.get(key) !== 1) return item;
    const matches = absentByKey.get(key);
    if (!matches || matches.length !== 1) return item;
    const [entry] = matches;
    absentByKey.delete(key);
    const legacyIds = Array.from(
      new Set([...(item.legacyIds ?? []), entry.id, ...(entry.legacyIds ?? [])])
    ).filter((id) => id !== item.id);
    return { ...item, legacyIds };
  });
}

/** Give each item the earliest "added" date its catalogue entry remembers. */
export function applyCatalogDates(
  catalog: Record<string, CatalogEntry> | undefined,
  items: MediaItem[]
): MediaItem[] {
  if (!catalog) return items;
  return items.map((item) => {
    const entry = entryFor(catalog, item);
    if (!entry || !(entry.firstSeenAt < (item.firstSeenAt ?? Infinity))) return item;
    return { ...item, firstSeenAt: entry.firstSeenAt, dateAdded: entry.firstSeenAt };
  });
}

/**
 * Record the items now in the library. An entry under a superseded ID is
 * folded into the current one, and a title that is present is by definition
 * not removed.
 */
export function recordInCatalog(
  catalog: Record<string, CatalogEntry> | undefined,
  items: MediaItem[],
  now: number = Date.now()
): Record<string, CatalogEntry> {
  const next: Record<string, CatalogEntry> = { ...(catalog ?? {}) };
  const presentIds = new Set(items.map((item) => item.id));

  for (const item of items) {
    const earlier = [next[item.id], ...(item.legacyIds ?? []).map((id) => next[id])].filter(
      (entry): entry is CatalogEntry => Boolean(entry)
    );
    const legacyIds = Array.from(
      new Set([...(item.legacyIds ?? []), ...earlier.flatMap((entry) => entry.legacyIds ?? [])])
    ).filter((id) => id !== item.id);
    const firstSeenAt = Math.min(item.firstSeenAt ?? now, ...earlier.map((entry) => entry.firstSeenAt));

    for (const legacy of item.legacyIds ?? []) {
      if (!presentIds.has(legacy)) delete next[legacy];
    }
    next[item.id] = {
      id: item.id,
      title: item.title,
      author: item.author,
      mediaType: item.mediaType,
      format: item.format,
      lastPath: item.filePath,
      firstSeenAt,
      lastSeenAt: now,
      ...(legacyIds.length > 0 ? { legacyIds } : {}),
    };
  }
  return next;
}

/** Mark titles removed. Their progress and bookmarks are kept. */
export function markRemoved(
  catalog: Record<string, CatalogEntry> | undefined,
  items: MediaItem[],
  now: number = Date.now()
): Record<string, CatalogEntry> {
  const next = recordInCatalog(catalog, items, now);
  for (const item of items) next[item.id] = { ...next[item.id], removedAt: now };
  return next;
}

/** Clear the removed mark, so the next scan brings the titles back. */
export function restoreRemoved(
  catalog: Record<string, CatalogEntry> | undefined,
  shouldRestore: (entry: CatalogEntry) => boolean
): Record<string, CatalogEntry> {
  const next: Record<string, CatalogEntry> = { ...(catalog ?? {}) };
  for (const [id, entry] of Object.entries(next)) {
    if (entry.removedAt && shouldRestore(entry)) {
      const restored = { ...entry };
      delete restored.removedAt;
      next[id] = restored;
    }
  }
  return next;
}

/** Removed titles, most recently removed first. */
export function removedEntries(catalog: Record<string, CatalogEntry> | undefined): CatalogEntry[] {
  return Object.values(catalog ?? {})
    .filter((entry) => entry.removedAt)
    .sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0));
}

/**
 * True when `filePath` is `folder` or inside it. Matched on a path boundary:
 * a bare prefix test would put "/Books Archive" inside "/Books".
 */
export function isInsideFolder(filePath: string, folder: string): boolean {
  const prefix = folder.replace(/[/\\]+$/, '');
  if (filePath === prefix) return true;
  const next = filePath.charAt(prefix.length);
  return filePath.startsWith(prefix) && (next === '/' || next === '\\');
}
