import { describe, expect, it } from 'vitest';
import type { LibraryState, MediaItem } from '../types';
import { applyScan } from './libraryScan';
import { isInsideFolder, markRemoved, recordInCatalog } from './catalog';

function book(id: string, folder: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    title: `Title ${id}`,
    author: 'Author',
    filePath: `${folder}/${id}.epub`,
    mediaType: 'book',
    format: 'epub',
    fileSize: 1000,
    fileModifiedAt: 1,
    firstSeenAt: 5000,
    dirName: folder,
    ...overrides,
  };
}

const empty: LibraryState = { folders: [], items: [], progress: {}, bookmarks: {}, collections: [], catalog: {}, history: [] };

/** The library after the user had read some of `a` (in /A) and bookmarked it, a while ago. */
function readingLibrary(): LibraryState {
  const scanned = applyScan(empty, [book('a', '/A', { firstSeenAt: 100 }), book('b', '/B')], ['/A', '/B'], undefined, 100);
  return {
    ...scanned,
    progress: { a: { id: 'a', percent: 40, lastPlayed: 200, chapterIndex: 2, startedAt: 150 } },
    bookmarks: { a: [{ id: 'bm', itemId: 'a', label: 'Ch 3', createdAt: 200, position: 2 }] },
  };
}

/** What the app does when a folder is disconnected. */
function removeFolder(state: LibraryState, folder: string): LibraryState {
  return {
    ...state,
    folders: state.folders.filter((f) => f !== folder),
    items: state.items.filter((item) => !isInsideFolder(item.filePath, folder)),
    catalog: recordInCatalog(state.catalog, state.items),
  };
}

describe('applyScan', () => {
  it('gives a title its data back when its folder is removed and added again', () => {
    const removed = removeFolder(readingLibrary(), '/A');
    expect(removed.items.map((i) => i.id)).toEqual(['b']);
    expect(removed.progress.a.percent).toBe(40);

    const readded = applyScan(removed, [book('a', '/A'), book('b', '/B')], ['/B', '/A'], '/A', 9000);
    expect(readded.items.find((i) => i.id === 'a')?.firstSeenAt).toBe(100);
    expect(readded.progress.a).toMatchObject({ percent: 40, chapterIndex: 2 });
    expect(readded.bookmarks.a).toHaveLength(1);
  });

  it('keeps a removed title out of rescans, and brings it back when restored or its folder is picked again', () => {
    const state = readingLibrary();
    const removed = {
      ...state,
      items: state.items.filter((i) => i.id !== 'a'),
      catalog: markRemoved(state.catalog, [state.items.find((i) => i.id === 'a')!], 300),
    };
    const files = [book('a', '/A'), book('b', '/B')];

    const rescanned = applyScan(removed, files, ['/A', '/B'], undefined, 400);
    expect(rescanned.items.map((i) => i.id)).toEqual(['b']);
    expect(rescanned.catalog?.a.removedAt).toBe(300);

    const picked = applyScan(rescanned, files, ['/A', '/B'], '/A', 500);
    expect(picked.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(picked.catalog?.a.removedAt).toBeUndefined();
    expect(picked.progress.a.percent).toBe(40);
  });

  it('moves the data of an absent title onto a re-imported copy with a different ID', () => {
    const removed = removeFolder(readingLibrary(), '/A');
    // A re-download of the same book into a new folder: different size, so a different ID.
    const copy = book('a2', '/New', { title: 'Title a', fileSize: 2048 });

    const imported = applyScan(removed, [copy, book('b', '/B')], ['/B', '/New'], '/New', 9000);

    expect(imported.progress.a).toBeUndefined();
    expect(imported.progress.a2).toMatchObject({ percent: 40, chapterIndex: 2 });
    expect(imported.bookmarks.a2[0].itemId).toBe('a2');
    expect(imported.items.find((i) => i.id === 'a2')?.firstSeenAt).toBe(100);
    expect(imported.catalog?.a).toBeUndefined();
    expect(imported.catalog?.a2.legacyIds).toEqual(['a']);
  });
});
