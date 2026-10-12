import { describe, it, expect } from 'vitest';
import type { Bookmark, Collection, LibraryState, MediaItem, ProgressItem } from '../types';
import { mergeExternalLibraryChanges } from './libraryMerge';

const progress = (id: string, percent: number, lastPlayed = 1): ProgressItem => ({ id, percent, lastPlayed });
const bookmark = (id: string, itemId: string, label = id): Bookmark => ({ id, itemId, label, createdAt: 1, position: 1 });
const collection = (id: string, name = id, memberIds: string[] = []): Collection => ({
  id,
  name,
  kind: 'theme',
  memberIds,
  createdAt: 1,
  updatedAt: 1,
});
const item = (id: string): MediaItem => ({
  id,
  title: id,
  author: '',
  filePath: `C:/b/${id}.epub`,
  mediaType: 'book',
  format: 'epub',
  fileSize: 1,
  fileModifiedAt: 1,
  firstSeenAt: 1,
  dirName: 'b',
});

function state(overrides: Partial<LibraryState> = {}): LibraryState {
  return { folders: ['C:/b'], items: [item('a'), item('b')], progress: {}, bookmarks: {}, collections: [], ...overrides };
}

describe('src/lib/libraryMerge - mergeExternalLibraryChanges', () => {
  it('keeps a collection made over MCP while the app was saving playback progress', () => {
    const base = state({ progress: { a: progress('a', 10) } });
    const ours = state({ progress: { a: progress('a', 12, 2) } });
    const theirs = state({ progress: { a: progress('a', 10) }, collections: [collection('mcp', 'Made over MCP')] });

    const merged = mergeExternalLibraryChanges(base, ours, theirs);

    expect(merged.progress.a.percent).toBe(12);
    expect(merged.collections.map((c) => c.name)).toEqual(['Made over MCP']);
  });

  it('takes progress the MCP server set for one book alongside the app’s progress on another', () => {
    const base = state();
    const ours = state({ progress: { a: progress('a', 30) } });
    const theirs = state({ progress: { b: progress('b', 75) } });

    const merged = mergeExternalLibraryChanges(base, ours, theirs);

    expect(merged.progress).toEqual({ a: progress('a', 30), b: progress('b', 75) });
  });

  it('keeps the app’s version when both changed the same entry', () => {
    const base = state({ progress: { a: progress('a', 10) } });
    const ours = state({ progress: { a: progress('a', 40) } });
    const theirs = state({ progress: { a: progress('a', 90) } });

    expect(mergeExternalLibraryChanges(base, ours, theirs).progress.a.percent).toBe(40);
  });

  it('applies a deletion made over MCP, unless the app has changed that entry since', () => {
    const base = state({ collections: [collection('untouched'), collection('edited')] });
    const ours = state({ collections: [collection('untouched'), collection('edited', 'Renamed in the app')] });
    const theirs = state({ collections: [] });

    const merged = mergeExternalLibraryChanges(base, ours, theirs);

    expect(merged.collections.map((c) => c.name)).toEqual(['Renamed in the app']);
  });

  it('merges bookmarks one by one: one added over MCP, another removed in the app', () => {
    const base = state({ bookmarks: { a: [bookmark('kept', 'a'), bookmark('removed-in-app', 'a')] } });
    const ours = state({ bookmarks: { a: [bookmark('kept', 'a')] } });
    const theirs = state({
      bookmarks: { a: [bookmark('kept', 'a'), bookmark('removed-in-app', 'a'), bookmark('added-over-mcp', 'a')] },
    });

    const merged = mergeExternalLibraryChanges(base, ours, theirs);

    expect(merged.bookmarks.a.map((b) => b.id)).toEqual(['kept', 'added-over-mcp']);
  });

  it('does not mistake the same object written with keys in another order for a change', () => {
    const base = state({ progress: { a: { id: 'a', percent: 10, lastPlayed: 1 } } });
    const ours = state({ progress: { a: { lastPlayed: 1, percent: 10, id: 'a' } } });
    const theirs = state({ progress: { a: progress('a', 55) } });

    expect(mergeExternalLibraryChanges(base, ours, theirs).progress.a.percent).toBe(55);
  });

  it('leaves books and folders as the app has them', () => {
    const ours = state({ items: [item('a'), item('new-from-scan')] });
    const theirs = state({ items: [], folders: [] });

    const merged = mergeExternalLibraryChanges(state(), ours, theirs);

    expect(merged.items.map((i) => i.id)).toEqual(['a', 'new-from-scan']);
    expect(merged.folders).toEqual(['C:/b']);
  });
});
