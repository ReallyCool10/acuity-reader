import type { LibraryState, MediaItem } from '../types';
import {
  carryForwardFirstSeenAt,
  carryForwardLegacyIds,
  migrateLegacyItemIds,
} from './audiobookGrouping';
import {
  applyCatalogDates,
  excludeRemoved,
  isInsideFolder,
  reconnectReimported,
  recordInCatalog,
  restoreRemoved,
} from './catalog';

/**
 * Fold the result of a folder scan into the library.
 *
 * Re-identified items take their progress, bookmarks and collection
 * memberships with them and keep their original addition date. The catalogue
 * remembers titles that left the library: removed ones stay out, and a
 * returning title, the same file or a new copy, gets its data back.
 *
 * `restoreFolder` is a folder the user has just picked: titles they removed
 * from it come back, because picking it again is an explicit import.
 */
export function applyScan(
  prev: LibraryState,
  scanned: MediaItem[],
  folders: string[],
  restoreFolder?: string,
  now: number = Date.now()
): LibraryState {
  const catalog = restoreFolder
    ? restoreRemoved(prev.catalog, (entry) => isInsideFolder(entry.lastPath, restoreFolder))
    : prev.catalog;
  const withLegacy = carryForwardLegacyIds(prev.items, scanned);
  const { items: kept, excludedIds } = excludeRemoved(catalog, withLegacy);
  const reconnected = reconnectReimported(catalog, kept, prev.progress, prev.bookmarks, excludedIds);
  const withDates = applyCatalogDates(catalog, carryForwardFirstSeenAt(prev.items, reconnected, now));
  const migrated = migrateLegacyItemIds({ ...prev, folders, items: withDates }).state;
  return { ...migrated, catalog: recordInCatalog(catalog, migrated.items, now) };
}
