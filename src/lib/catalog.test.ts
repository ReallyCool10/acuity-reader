import { describe, expect, it } from 'vitest';
import type { CatalogEntry, MediaItem } from '../types';
import {
  applyCatalogDates,
  excludeRemoved,
  isInsideFolder,
  markRemoved,
  reconnectReimported,
  recordInCatalog,
  removedEntries,
  restoreRemoved,
  titleKey,
} from './catalog';
import { migrateLegacyItemIds } from './audiobookGrouping';

function book(id: string, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    title: 'The Hobbit',
    author: 'J. R. R. Tolkien',
    filePath: `/books/${id}.epub`,
    mediaType: 'book',
    format: 'epub',
    fileSize: 1000,
    fileModifiedAt: 1,
    firstSeenAt: 100,
    dirName: 'books',
    ...overrides,
  };
}

describe('catalog', () => {
  it('records every title in the library and keeps the earliest date it was added', () => {
    const catalog = recordInCatalog(undefined, [book('a', { firstSeenAt: 500 })], 1000);
    expect(catalog.a).toMatchObject({ id: 'a', title: 'The Hobbit', lastPath: '/books/a.epub', firstSeenAt: 500, lastSeenAt: 1000 });

    const later = recordInCatalog(catalog, [book('a', { firstSeenAt: 900 })], 2000);
    expect(later.a.firstSeenAt).toBe(500);
    expect(later.a.lastSeenAt).toBe(2000);
  });

  it('keeps a title in the catalogue after its folder is disconnected', () => {
    const catalog = recordInCatalog(undefined, [book('a')], 1000);
    const afterRemoval = recordInCatalog(catalog, [], 2000);
    expect(afterRemoval.a).toBeDefined();
  });

  it('leaves removed titles out of a rescan until they are restored', () => {
    const catalog = markRemoved(undefined, [book('a')], 1000);
    expect(catalog.a.removedAt).toBe(1000);

    const scanned = [book('a'), book('b', { title: 'Dune', author: 'Frank Herbert' })];
    const { items, excludedIds } = excludeRemoved(catalog, scanned);
    expect(items.map((i) => i.id)).toEqual(['b']);
    expect([...excludedIds]).toEqual(['a']);

    const restored = restoreRemoved(catalog, (entry) => entry.id === 'a');
    expect(restored.a.removedAt).toBeUndefined();
    expect(excludeRemoved(restored, scanned).items).toHaveLength(2);
  });

  it('lists removed titles, newest first', () => {
    let catalog = markRemoved(undefined, [book('a')], 1000);
    catalog = markRemoved(catalog, [book('b', { title: 'Dune' })], 2000);
    expect(removedEntries(catalog).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('a title that is present again is no longer removed', () => {
    const catalog = markRemoved(undefined, [book('a')], 1000);
    expect(recordInCatalog(catalog, [book('a')], 2000).a.removedAt).toBeUndefined();
  });

  describe('re-imported copies', () => {
    const progress = { old: { id: 'old', percent: 42, lastPlayed: 10, chapterIndex: 3 } };
    const bookmarks = { old: [{ id: 'bm', itemId: 'old', label: 'Ch 4', createdAt: 1, position: 3 }] };
    const catalog: Record<string, CatalogEntry> = recordInCatalog(undefined, [book('old', { fileSize: 999 })], 1000);

    it('reconnects a new copy of an absent title to its old data', () => {
      const [item] = reconnectReimported(catalog, [book('new', { fileSize: 1234 })], progress, bookmarks);
      expect(item.legacyIds).toEqual(['old']);

      const { state } = migrateLegacyItemIds({
        folders: [],
        items: [item],
        progress,
        bookmarks,
        collections: [{ id: 'c', name: 'Fantasy', kind: 'theme', memberIds: ['old'], createdAt: 1, updatedAt: 1 }],
      });
      expect(state.progress.new).toMatchObject({ id: 'new', percent: 42, chapterIndex: 3 });
      expect(state.bookmarks.new[0]).toMatchObject({ itemId: 'new', label: 'Ch 4' });
      expect(state.collections[0].memberIds).toEqual(['new']);
    });

    it('ignores case, accents and punctuation in the title', () => {
      const [item] = reconnectReimported(
        catalog,
        [book('new', { title: 'the hobbit!', author: 'J R R Tolkien' })],
        progress,
        bookmarks
      );
      expect(item.legacyIds).toEqual(['old']);
    });

    it('does not reconnect across formats', () => {
      const [item] = reconnectReimported(catalog, [book('new', { format: 'pdf' })], progress, bookmarks);
      expect(item.legacyIds).toBeUndefined();
    });

    it('does not take the data of a title that is still present', () => {
      const items = reconnectReimported(catalog, [book('old'), book('new')], progress, bookmarks);
      expect(items[1].legacyIds).toBeUndefined();
    });

    it('does not take the data of a removed title whose file is still on disk', () => {
      const [item] = reconnectReimported(catalog, [book('new')], progress, bookmarks, new Set(['old']));
      expect(item.legacyIds).toBeUndefined();
    });

    it('connects nothing when the match is ambiguous', () => {
      const two = recordInCatalog(catalog, [book('older', { fileSize: 5 })], 1000);
      const [item] = reconnectReimported(
        { old: two.old, older: two.older },
        [book('new')],
        progress,
        bookmarks
      );
      expect(item.legacyIds).toBeUndefined();

      const twoCopies = reconnectReimported(catalog, [book('new1'), book('new2', { filePath: '/b/2.epub' })], progress, bookmarks);
      expect(twoCopies.every((i) => !i.legacyIds)).toBe(true);
    });

    it('leaves items that already have data alone', () => {
      const [item] = reconnectReimported(catalog, [book('new')], { ...progress, new: { id: 'new', percent: 5, lastPlayed: 1 } }, bookmarks);
      expect(item.legacyIds).toBeUndefined();
    });

    it('folds the old entry into the new one, keeping the original date', () => {
      const [item] = reconnectReimported(catalog, [book('new', { firstSeenAt: 5000 })], progress, bookmarks);
      expect(applyCatalogDates(catalog, [item])[0].firstSeenAt).toBe(100);
      const next = recordInCatalog(catalog, [item], 6000);
      expect(next.old).toBeUndefined();
      expect(next.new).toMatchObject({ firstSeenAt: 100, legacyIds: ['old'] });
    });
  });

  it('has no title key for untitled items, so they are never matched', () => {
    expect(titleKey(book('a', { title: 'Unknown' }))).toBeNull();
    expect(titleKey(book('a', { title: '' }))).toBeNull();
  });

  it('matches folders on a path boundary', () => {
    expect(isInsideFolder('/Books/a.epub', '/Books')).toBe(true);
    expect(isInsideFolder('C:\\Books\\a.epub', 'C:\\Books\\')).toBe(true);
    expect(isInsideFolder('/Books Archive/a.epub', '/Books')).toBe(false);
  });
});
