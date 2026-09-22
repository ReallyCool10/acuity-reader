import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadLibraryState,
  saveLibraryState,
  listBooks,
  getBook,
  getReadingProgress,
  updateReadingProgress,
  listBookmarks,
  addBookmark,
  updateBookmark,
  deleteBookmark,
  getLibraryStats,
  getCurrentlyReading,
  normalizePercent,
  exportReadingSummaryMarkdown,
} from './storage';
import type { LibraryState } from '../src/types';

describe('mcp-server/storage', () => {
  let tempFilePath: string;
  let sampleState: LibraryState;

  beforeEach(async () => {
    tempFilePath = path.join(os.tmpdir(), `acuity-test-lib-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    sampleState = {
      folders: ['C:/Books'],
      items: [
        {
          id: 'item-1',
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          filePath: 'C:/Books/pride.epub',
          mediaType: 'book',
          format: 'epub',
          fileSize: 1024,
          dateAdded: 1000,
          dirName: 'Books',
        },
        {
          id: 'item-2',
          title: 'The Great Gatsby',
          author: 'F. Scott Fitzgerald',
          filePath: 'C:/Books/gatsby.pdf',
          mediaType: 'book',
          format: 'pdf',
          fileSize: 2048,
          dateAdded: 2000,
          dirName: 'Books',
        },
        {
          id: 'item-3',
          title: 'Dune Audiobook',
          author: 'Frank Herbert',
          filePath: 'C:/Audio/dune.m4b',
          mediaType: 'audio',
          format: 'm4b',
          fileSize: 500000,
          dateAdded: 3000,
          dirName: 'Audio',
        },
      ],
      progress: {
        'item-1': {
          id: 'item-1',
          chapterIndex: 2,
          percent: 0.35,
          lastPlayed: 5000,
        },
        'item-3': {
          id: 'item-3',
          currentTime: 1200,
          duration: 3600,
          percent: 0.33,
          lastPlayed: 6000,
        },
      },
      bookmarks: {
        'item-1': [
          {
            id: 'bm-1',
            itemId: 'item-1',
            label: 'Chapter 2 Quote',
            createdAt: 4000,
            position: 2,
            excerpt: 'It is a truth universally acknowledged...',
          },
        ],
      },
    };
    await saveLibraryState(sampleState, tempFilePath);
  });

  afterEach(async () => {
    if (fs.existsSync(tempFilePath)) {
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
  });

  it('loads library state correctly', async () => {
    const loaded = await loadLibraryState(tempFilePath);
    expect(loaded.items.length).toBe(3);
    expect(loaded.folders).toEqual(['C:/Books']);
    expect(loaded.progress['item-1'].percent).toBe(0.35);
  });

  it('lists books with flexible filters', async () => {
    // Media type filter
    const onlyAudio = await listBooks({ mediaType: 'audio' }, tempFilePath);
    expect(onlyAudio.totalMatches).toBe(1);
    expect(onlyAudio.books[0].title).toBe('Dune Audiobook');

    // Query filter
    const gatsby = await listBooks({ query: 'gatsby' }, tempFilePath);
    expect(gatsby.totalMatches).toBe(1);
    expect(gatsby.books[0].author).toBe('F. Scott Fitzgerald');

    // In-progress filter
    const inProgress = await listBooks({ inProgressOnly: true }, tempFilePath);
    expect(inProgress.totalMatches).toBe(2);

    // Limit filter
    const limited = await listBooks({ limit: 1 }, tempFilePath);
    expect(limited.books.length).toBe(1);
  });

  it('retrieves single book by ID or title match', async () => {
    const byId = await getBook('item-2', tempFilePath);
    expect(byId).not.toBeNull();
    expect(byId?.book.title).toBe('The Great Gatsby');

    const byTitle = await getBook('Pride', tempFilePath);
    expect(byTitle).not.toBeNull();
    expect(byTitle?.book.id).toBe('item-1');
    expect(byTitle?.bookmarks.length).toBe(1);

    const nonExistent = await getBook('Missing Book', tempFilePath);
    expect(nonExistent).toBeNull();
  });

  it('retrieves and updates reading progress', async () => {
    const progressList = await getReadingProgress(undefined, tempFilePath);
    expect(progressList.length).toBe(2);
    expect(progressList[0].bookId).toBe('item-3'); // latest played first

    const singleProg = await getReadingProgress('item-1', tempFilePath);
    expect(singleProg.length).toBe(1);
    expect(singleProg[0].percent).toBe(35);

    // Update progress
    await updateReadingProgress('item-1', { chapterIndex: 5, percent: 55 }, tempFilePath);
    const updated = await getReadingProgress('item-1', tempFilePath);
    expect(updated[0].chapterIndex).toBe(5);
    expect(updated[0].percent).toBe(55);
  });

  it('manages bookmarks (list, add, delete)', async () => {
    const initialBms = await listBookmarks('item-1', tempFilePath);
    expect(initialBms.length).toBe(1);
    expect(initialBms[0].bookTitle).toBe('Pride and Prejudice');

    const newBm = await addBookmark(
      'item-2',
      { position: 4, label: 'Green light passage', excerpt: 'He stretched out his arms...', note: 'Symbolism' },
      tempFilePath
    );
    expect(newBm.itemId).toBe('item-2');
    expect(newBm.note).toBe('Symbolism');

    const afterAdd = await listBookmarks('item-2', tempFilePath);
    expect(afterAdd.length).toBe(1);
    expect(afterAdd[0].label).toBe('Green light passage');

    const deleted = await deleteBookmark('item-2', newBm.id, tempFilePath);
    expect(deleted).toBe(true);

    const afterDelete = await listBookmarks('item-2', tempFilePath);
    expect(afterDelete.length).toBe(0);
  });

  it('calculates library stats accurately', async () => {
    const stats = await getLibraryStats(tempFilePath);
    expect(stats.totalItems).toBe(3);
    expect(stats.totalBooks).toBe(2);
    expect(stats.totalAudiobooks).toBe(1);
    expect(stats.formats['epub']).toBe(1);
    expect(stats.formats['pdf']).toBe(1);
    expect(stats.formats['m4b']).toBe(1);
    expect(stats.activeReadingCount).toBe(2);
    expect(stats.totalBookmarks).toBe(1);
  });

  it('retrieves currently reading items ordered by recency', async () => {
    const active = await getCurrentlyReading(tempFilePath);
    expect(active.length).toBe(2);
    // item-3 has lastPlayed 6000, item-1 has lastPlayed 5000
    expect(active[0].bookId).toBe('item-3');
    expect(active[0].title).toBe('Dune Audiobook');
    expect(active[1].bookId).toBe('item-1');
    expect(active[1].latestBookmark?.label).toBe('Chapter 2 Quote');
  });

  it('updates an existing bookmark note and label', async () => {
    const updated = await updateBookmark(
      'item-1',
      'bm-1',
      { label: 'Updated Label', note: 'New analytical note' },
      tempFilePath
    );
    expect(updated).not.toBeNull();
    expect(updated?.label).toBe('Updated Label');
    expect(updated?.note).toBe('New analytical note');
    expect(updated?.excerpt).toBe('It is a truth universally acknowledged...');

    const bookmarks = await listBookmarks('item-1', tempFilePath);
    expect(bookmarks[0].label).toBe('Updated Label');
    expect(bookmarks[0].note).toBe('New analytical note');
  });

  it('normalizes percentages properly', () => {
    expect(normalizePercent(0)).toBe(0);
    expect(normalizePercent(-5)).toBe(0);
    expect(normalizePercent(0.354)).toBe(35.4);
    expect(normalizePercent(1)).toBe(100);
    expect(normalizePercent(42.5)).toBe(42.5);
    expect(normalizePercent(150)).toBe(100);
  });

  it('generates a clean markdown reading summary', async () => {
    const md = await exportReadingSummaryMarkdown(tempFilePath);
    expect(md).toContain('# 📚 Acuity Reader — Reading Summary');
    expect(md).toContain('Dune Audiobook');
    expect(md).toContain('Pride and Prejudice');
    expect(md).toContain('Chapter 2 Quote');
  });
});
