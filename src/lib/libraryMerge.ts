import type { Bookmark, Collection, LibraryState, ProgressItem } from '../types';

/**
 * Merging changes the MCP server made to the library file into the app's own
 * state.
 *
 * The MCP server (mcp-server/) edits acuity_library.json directly: reading
 * progress, bookmarks and collections. The app used to keep its own copy in
 * memory and save the whole of it again a moment later, silently undoing those
 * edits. Now the main process notices the file changing and the app merges it.
 *
 * A three-way merge against `base`, the state the app last saved: an entry the
 * app has not touched since takes the file's version, including deletions; an
 * entry the app has changed keeps the app's version. Books and folders belong to
 * the app alone (the MCP server never edits them), so those always stay the
 * app's.
 */
export function mergeExternalLibraryChanges(
  base: LibraryState,
  ours: LibraryState,
  theirs: LibraryState
): LibraryState {
  return {
    ...ours,
    progress: mergeRecords<ProgressItem>(base.progress, ours.progress, theirs.progress),
    bookmarks: mergeBookmarks(base.bookmarks, ours.bookmarks, theirs.bookmarks),
    collections: mergeById<Collection>(base.collections, ours.collections, theirs.collections),
  };
}

/** Deep equality that ignores key order: two processes may write the same object differently. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const bKeys = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Per-key three-way merge: the app's change wins; otherwise the file's version (or its deletion). */
function pick<T>(base: T | undefined, ours: T | undefined, theirs: T | undefined): T | undefined {
  return same(ours, base) ? theirs : ours;
}

function mergeRecords<T>(
  base: Record<string, T> = {},
  ours: Record<string, T> = {},
  theirs: Record<string, T> = {}
): Record<string, T> {
  const merged: Record<string, T> = {};
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
    const value = pick(base[key], ours[key], theirs[key]);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** Merge lists of objects by `id`, keeping the app's order and adding the file's new entries after. */
function mergeById<T extends { id: string }>(base: T[] = [], ours: T[] = [], theirs: T[] = []): T[] {
  const byId = (list: T[]) => new Map(list.map((entry) => [entry.id, entry]));
  const baseById = byId(base);
  const oursById = byId(ours);
  const theirsById = byId(theirs);
  const order = [...ours.map((e) => e.id), ...theirs.map((e) => e.id).filter((id) => !oursById.has(id))];

  const merged: T[] = [];
  for (const id of new Set(order)) {
    const value = pick(baseById.get(id), oursById.get(id), theirsById.get(id));
    if (value !== undefined) merged.push(value);
  }
  return merged;
}

function mergeBookmarks(
  base: Record<string, Bookmark[]> = {},
  ours: Record<string, Bookmark[]> = {},
  theirs: Record<string, Bookmark[]> = {}
): Record<string, Bookmark[]> {
  const merged: Record<string, Bookmark[]> = {};
  for (const itemId of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const list = mergeById(base[itemId], ours[itemId], theirs[itemId]);
    if (list.length > 0) merged[itemId] = list;
  }
  return merged;
}
