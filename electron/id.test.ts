import { describe, it, expect } from 'vitest';
import {
  computeStableId,
  isLegacyPathId,
  migrateLibraryState,
  type StoredLibraryState,
} from './id';

describe('electron/id - computeStableId', () => {
  it('derives identical IDs for identical books at different paths', () => {
    const idPathA = computeStableId('Dune', 'Frank Herbert', 1542000, '/drive1/Books/Dune.epub');
    const idPathB = computeStableId('Dune', 'Frank Herbert', 1542000, 'D:\\Library\\SciFi\\Dune.epub');

    expect(idPathA).toBe(idPathB);
    expect(idPathA).toHaveLength(16);
  });

  it('is case and whitespace insensitive for title and author', () => {
    const id1 = computeStableId('  The Great Gatsby ', 'F. Scott Fitzgerald  ', 500000);
    const id2 = computeStableId('the great gatsby', 'f. scott fitzgerald', 500000);

    expect(id1).toBe(id2);
  });

  it('differentiates different books with the same size', () => {
    const id1 = computeStableId('Book A', 'Author A', 1000000);
    const id2 = computeStableId('Book B', 'Author B', 1000000);

    expect(id1).not.toBe(id2);
  });

  it('falls back to filename stem when title/author are unknown', () => {
    const id = computeStableId(null, null, 12345, '/path/to/MyAudiobook.m4b');
    expect(id).toHaveLength(16);

    const idSameStem = computeStableId('', 'unknown', 12345, '/other/MyAudiobook.m4b');
    expect(id).toBe(idSameStem);
  });
});

describe('electron/id - isLegacyPathId', () => {
  it('identifies base64 encoded paths as legacy', () => {
    const legacyWindows = Buffer.from('C:\\Books\\Classic.epub').toString('base64');
    const legacyPosix = Buffer.from('/home/user/books/Classic.epub').toString('base64');

    expect(isLegacyPathId(legacyWindows)).toBe(true);
    expect(isLegacyPathId(legacyPosix)).toBe(true);
  });

  it('identifies 16-hex stable IDs as non-legacy', () => {
    const stable = computeStableId('Title', 'Author', 1000);
    expect(isLegacyPathId(stable)).toBe(false);
  });
});

describe('electron/id - migrateLibraryState', () => {
  it('migrates legacy base64 IDs to stable IDs across items, progress, and bookmarks', () => {
    const oldPath = 'C:\\Books\\PrideAndPrejudice.epub';
    const oldLegacyId = Buffer.from(oldPath).toString('base64');

    const initialState: StoredLibraryState = {
      folders: ['C:\\Books'],
      items: [
        {
          id: oldLegacyId,
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          filePath: oldPath,
          mediaType: 'book',
          format: 'epub',
          fileSize: 850000,
          dateAdded: 1600000000000,
          dirName: 'Books',
        },
      ],
      progress: {
        [oldLegacyId]: {
          id: oldLegacyId,
          percent: 55,
          lastPlayed: 1650000000000,
          chapterIndex: 4,
        },
      },
      bookmarks: {
        [oldLegacyId]: [
          {
            id: 'bm-1',
            itemId: oldLegacyId,
            label: 'Favorite quote',
            createdAt: 1650000001000,
            position: 4,
          },
        ],
      },
    };

    const { state: migrated, migratedCount } = migrateLibraryState(initialState);

    expect(migratedCount).toBe(1);

    const expectedNewId = computeStableId(
      'Pride and Prejudice',
      'Jane Austen',
      850000,
      oldPath
    );

    // Item ID updated
    expect(migrated.items![0].id).toBe(expectedNewId);

    // Progress updated and old key removed
    expect(migrated.progress![oldLegacyId]).toBeUndefined();
    expect(migrated.progress![expectedNewId]).toBeDefined();
    expect(migrated.progress![expectedNewId].id).toBe(expectedNewId);
    expect(migrated.progress![expectedNewId].percent).toBe(55);

    // Bookmarks updated and old key removed
    expect(migrated.bookmarks![oldLegacyId]).toBeUndefined();
    expect(migrated.bookmarks![expectedNewId]).toBeDefined();
    expect(migrated.bookmarks![expectedNewId][0].itemId).toBe(expectedNewId);
  });

  it('is a no-op when items already have stable IDs', () => {
    const stableId = computeStableId('Emma', 'Jane Austen', 920000);
    const modernState: StoredLibraryState = {
      items: [
        {
          id: stableId,
          title: 'Emma',
          author: 'Jane Austen',
          filePath: '/books/Emma.epub',
          mediaType: 'book',
          format: 'epub',
          fileSize: 920000,
          dateAdded: 1600000000000,
          dirName: 'books',
        },
      ],
      progress: {
        [stableId]: {
          id: stableId,
          percent: 10,
          lastPlayed: 1650000000000,
        },
      },
    };

    const { migratedCount } = migrateLibraryState(modernState);
    expect(migratedCount).toBe(0);
  });

  it('migrates legacy item IDs within collection memberIds and preserves unmigrated ones', () => {
    const oldPath = 'C:\\Books\\Neuromancer.epub';
    const oldLegacyId = Buffer.from(oldPath).toString('base64');
    const stableIdOther = computeStableId('Count Zero', 'William Gibson', 800000);
    const unresolvableId = 'offline_item_1234';

    const initialState: StoredLibraryState = {
      items: [
        {
          id: oldLegacyId,
          title: 'Neuromancer',
          author: 'William Gibson',
          filePath: oldPath,
          mediaType: 'book',
          format: 'epub',
          fileSize: 750000,
          dateAdded: 1600000000000,
          dirName: 'Books',
        },
      ],
      collections: [
        {
          id: 'col-sprawl',
          name: 'Sprawl Trilogy',
          kind: 'series',
          memberIds: [oldLegacyId, stableIdOther, unresolvableId],
          createdAt: 1650000000000,
          updatedAt: 1650000000000,
        },
      ],
    };

    const { state: migrated, migratedCount } = migrateLibraryState(initialState);
    expect(migratedCount).toBe(1);

    const expectedNewId = computeStableId('Neuromancer', 'William Gibson', 750000, oldPath);
    expect(migrated.collections).toBeDefined();
    expect(migrated.collections![0].memberIds).toEqual([
      expectedNewId,
      stableIdOther,
      unresolvableId,
    ]);
  });

  it('migrates legacy dateAdded into fileModifiedAt and firstSeenAt', () => {
    const stableId = computeStableId('Emma', 'Jane Austen', 920000, '/books/Emma.epub');
    const legacyDateState: StoredLibraryState = {
      items: [
        {
          id: stableId,
          title: 'Emma',
          author: 'Jane Austen',
          filePath: '/books/Emma.epub',
          mediaType: 'book',
          format: 'epub',
          fileSize: 920000,
          dateAdded: 1600000000000,
          dirName: 'books',
        },
      ],
    };

    const { state: migrated, migratedCount, changed } = migrateLibraryState(legacyDateState);
    expect(migratedCount).toBe(0);
    expect(changed).toBe(true);
    expect(migrated.items![0].fileModifiedAt).toBe(1600000000000);
    expect(migrated.items![0].firstSeenAt).toBe(1600000000000);
    expect(migrated.items![0].dateAdded).toBe(1600000000000);
  });
});

