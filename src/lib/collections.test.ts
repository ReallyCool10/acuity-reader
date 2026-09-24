import { describe, it, expect } from 'vitest';
import type { MediaItem } from '../types';
import {
  createCollection,
  updateCollection,
  addMemberToCollection,
  removeMemberFromCollection,
  reorderCollectionMembers,
  moveMemberInCollection,
  getCollectionsForItem,
  buildItemCollectionsMap,
  resolveCollectionMembers,
  getUnresolvedMemberCount,
  parseSeriesHintFromTitle,
  detectSeriesSuggestions,
} from './collections';

function makeMockItem(overrides: Partial<MediaItem>): MediaItem {
  const id = overrides.id || 'id-default';
  return {
    id,
    title: 'Default Title',
    author: 'Default Author',
    filePath: overrides.filePath || `C:/media/${id}.epub`,
    mediaType: 'book',
    format: 'epub',
    fileSize: 1000,
    fileModifiedAt: 100,
    firstSeenAt: 100,
    dateAdded: 100,
    dirName: 'media',
    ...overrides,
  };
}

describe('src/lib/collections - CRUD & Member Management', () => {
  it('creates a collection with valid defaults and deduped member IDs', () => {
    const col = createCollection('  Sci-Fi Classics  ', 'series', ['id-1', 'id-2', 'id-1']);

    expect(col.id).toMatch(/^col_/);
    expect(col.name).toBe('Sci-Fi Classics');
    expect(col.kind).toBe('series');
    expect(col.memberIds).toEqual(['id-1', 'id-2']);
    expect(col.createdAt).toBeGreaterThan(0);
    expect(col.updatedAt).toBe(col.createdAt);
  });

  it('updates collection metadata and member list with a new timestamp', () => {
    const col = createCollection('Old Name', 'theme', ['id-1']);
    const updated = updateCollection(col, {
      name: 'New Name',
      kind: 'series',
      description: 'A great series',
      memberIds: ['id-1', 'id-3', 'id-1'],
    });

    expect(updated.name).toBe('New Name');
    expect(updated.kind).toBe('series');
    expect(updated.description).toBe('A great series');
    expect(updated.memberIds).toEqual(['id-1', 'id-3']);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(col.updatedAt);
  });

  it('adds a member to the end if not present, and is a no-op if already present', () => {
    const col = createCollection('Favorites', 'theme', ['id-1']);
    const withSecond = addMemberToCollection(col, 'id-2');
    expect(withSecond.memberIds).toEqual(['id-1', 'id-2']);

    const duplicateAdd = addMemberToCollection(withSecond, 'id-1');
    expect(duplicateAdd.memberIds).toEqual(['id-1', 'id-2']);
  });

  it('removes a member if present, and is a no-op if not present', () => {
    const col = createCollection('Favorites', 'theme', ['id-1', 'id-2']);
    const removed = removeMemberFromCollection(col, 'id-1');
    expect(removed.memberIds).toEqual(['id-2']);

    const notPresent = removeMemberFromCollection(removed, 'id-99');
    expect(notPresent.memberIds).toEqual(['id-2']);
  });

  it('reorders members and preserves unmentioned offline IDs at the end', () => {
    const col = createCollection('Trilogy', 'series', ['id-1', 'id-2', 'id-offline', 'id-3']);
    const reordered = reorderCollectionMembers(col, ['id-3', 'id-1', 'id-2']);

    expect(reordered.memberIds).toEqual(['id-3', 'id-1', 'id-2', 'id-offline']);
  });

  it('moves members up and down within bounds', () => {
    const col = createCollection('Trilogy', 'series', ['id-1', 'id-2', 'id-3']);

    // Move id-2 up
    const movedUp = moveMemberInCollection(col, 'id-2', 'up');
    expect(movedUp.memberIds).toEqual(['id-2', 'id-1', 'id-3']);

    // Boundary: move id-1 up when at top is no-op
    const noOpTop = moveMemberInCollection(col, 'id-1', 'up');
    expect(noOpTop.memberIds).toEqual(['id-1', 'id-2', 'id-3']);

    // Move id-2 down
    const movedDown = moveMemberInCollection(col, 'id-2', 'down');
    expect(movedDown.memberIds).toEqual(['id-1', 'id-3', 'id-2']);

    // Boundary: move id-3 down when at bottom is no-op
    const noOpBottom = moveMemberInCollection(col, 'id-3', 'down');
    expect(noOpBottom.memberIds).toEqual(['id-1', 'id-2', 'id-3']);
  });
});

describe('src/lib/collections - Reverse Lookup', () => {
  it('finds collections containing an item or its companion', () => {
    const colA = createCollection('Series A', 'series', ['item-epub-1', 'item-epub-2']);
    const colB = createCollection('Audiobooks', 'theme', ['item-audio-1']);
    const colC = createCollection('Other', 'theme', ['item-other']);

    const collections = [colA, colB, colC];

    // Direct match
    expect(getCollectionsForItem(collections, 'item-epub-1')).toEqual([colA]);

    // Companion match: item-epub-1 has companion item-audio-1
    expect(getCollectionsForItem(collections, 'item-epub-1', 'item-audio-1')).toEqual([
      colA,
      colB,
    ]);
  });

  it('builds item to collections lookup map correctly', () => {
    const col1 = createCollection('Col 1', 'theme', ['a', 'b']);
    const col2 = createCollection('Col 2', 'series', ['b', 'c']);

    const map = buildItemCollectionsMap([col1, col2]);
    expect(map.get('a')).toEqual([col1]);
    expect(map.get('b')).toEqual([col1, col2]);
    expect(map.get('c')).toEqual([col2]);
    expect(map.get('nonexistent')).toBeUndefined();
  });
});

describe('src/lib/collections - Member Resolution & Companion Deduplication', () => {
  const epub1 = makeMockItem({
    id: 'id-epub-1',
    title: 'Dune',
    filePath: 'C:/books/Dune.epub',
    mediaType: 'book',
    format: 'epub',
    companionPath: 'C:/audio/Dune.m4b',
    companionType: 'm4b',
  });

  const audio1 = makeMockItem({
    id: 'id-audio-1',
    title: 'Dune',
    filePath: 'C:/audio/Dune.m4b',
    mediaType: 'audio',
    format: 'm4b',
    companionPath: 'C:/books/Dune.epub',
    companionType: 'epub',
  });

  const epub2 = makeMockItem({
    id: 'id-epub-2',
    title: 'Dune Messiah',
    filePath: 'C:/books/Dune Messiah.epub',
    mediaType: 'book',
    format: 'epub',
  });

  it('dedupes members by companion group so a paired work appears once with Read + Listen', () => {
    // Both epub and audio IDs were added to the collection
    const collection = createCollection('Dune Saga', 'series', [
      'id-epub-1',
      'id-audio-1',
      'id-epub-2',
    ]);
    const libraryItems = [epub1, audio1, epub2];

    const resolved = resolveCollectionMembers(collection, libraryItems);

    expect(resolved).toHaveLength(2);

    // First work: paired Dune work
    const work1 = resolved[0];
    expect(work1.primaryItem.id).toBe('id-epub-1');
    expect(work1.bookItem).toBe(epub1);
    expect(work1.audioItem).toBe(audio1);
    expect(work1.isDual).toBe(true);
    expect(work1.memberIds).toEqual(['id-epub-1', 'id-audio-1']);
    expect(work1.orderIndex).toBe(1);

    // Second work: book only
    const work2 = resolved[1];
    expect(work2.primaryItem.id).toBe('id-epub-2');
    expect(work2.bookItem).toBe(epub2);
    expect(work2.audioItem).toBeUndefined();
    expect(work2.isDual).toBe(false);
    expect(work2.orderIndex).toBe(2);
  });

  it('resolves paired companion even if only one format was added to the collection', () => {
    // Only audio was added
    const collection = createCollection('Dune Saga', 'series', ['id-audio-1']);
    const libraryItems = [epub1, audio1];

    const resolved = resolveCollectionMembers(collection, libraryItems);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].audioItem).toBe(audio1);
    expect(resolved[0].bookItem).toBe(epub1);
    expect(resolved[0].isDual).toBe(true);
  });

  it('filters unresolvable IDs at display time while keeping memberIds intact', () => {
    const offlineId = 'offline-drive-book-999';
    const collection = createCollection('Curated', 'theme', ['id-epub-1', offlineId, 'id-epub-2']);
    const libraryItems = [epub1, epub2]; // offlineId not present

    const resolved = resolveCollectionMembers(collection, libraryItems);

    // Display shows only the 2 resolvable items
    expect(resolved).toHaveLength(2);
    expect(resolved[0].primaryItem.id).toBe('id-epub-1');
    expect(resolved[1].primaryItem.id).toBe('id-epub-2');

    // Original collection still retains all 3 IDs
    expect(collection.memberIds).toEqual(['id-epub-1', offlineId, 'id-epub-2']);
    expect(getUnresolvedMemberCount(collection, libraryItems)).toBe(1);
  });
});

describe('src/lib/collections - Series Hint Parsing & Detection', () => {
  it('parses series name and volume number from various title formats', () => {
    expect(parseSeriesHintFromTitle('The Way of Kings, Book 1')).toEqual({
      seriesName: 'The Way of Kings',
      volumeNumber: 1,
    });

    expect(parseSeriesHintFromTitle('Words of Radiance: Book 2 - Part 1')).toEqual({
      seriesName: 'Words of Radiance',
      volumeNumber: 2,
    });

    expect(parseSeriesHintFromTitle('Harry Potter and the Chamber of Secrets (Harry Potter #2)')).toEqual({
      seriesName: 'Harry Potter',
      volumeNumber: 2,
    });

    expect(parseSeriesHintFromTitle('Mistborn #1: The Final Empire')).toEqual({
      seriesName: 'Mistborn',
      volumeNumber: 1,
    });

    expect(parseSeriesHintFromTitle('Independent Standalone Novel')).toBeNull();
  });

  it('detects series suggestions from title patterns and albums', () => {
    const b1 = makeMockItem({
      id: 'hp-1',
      title: 'Harry Potter #1: Sorcerer’s Stone',
      author: 'J.K. Rowling',
    });
    const b2 = makeMockItem({
      id: 'hp-2',
      title: 'Harry Potter #2: Chamber of Secrets',
      author: 'J.K. Rowling',
    });
    const b3 = makeMockItem({
      id: 'hp-3',
      title: 'Harry Potter #3: Prisoner of Azkaban',
      author: 'J.K. Rowling',
    });
    const standalone = makeMockItem({
      id: 'st-1',
      title: 'Standalone Book',
      author: 'Author',
    });

    const suggestions = detectSeriesSuggestions([b3, b1, b2, standalone]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].name).toBe('Harry Potter');
    // Sorted by volume number 1, 2, 3
    expect(suggestions[0].memberIds).toEqual(['hp-1', 'hp-2', 'hp-3']);
  });

  it('does not suggest series that already exist as collections', () => {
    const b1 = makeMockItem({
      id: 'hp-1',
      title: 'Harry Potter #1: Sorcerer’s Stone',
      author: 'J.K. Rowling',
    });
    const b2 = makeMockItem({
      id: 'hp-2',
      title: 'Harry Potter #2: Chamber of Secrets',
      author: 'J.K. Rowling',
    });

    const existingCollection = createCollection('Harry Potter', 'series', ['hp-1', 'hp-2']);

    const suggestions = detectSeriesSuggestions([b1, b2], [existingCollection]);
    expect(suggestions).toHaveLength(0);
  });
});
