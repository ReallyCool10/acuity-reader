import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScanStore } from './scanStore';

interface Entry {
  filePath: string;
  title: string;
}

describe('electron/scanStore', () => {
  let dir: string;
  let file: string;
  const at = (...parts: string[]) => path.join(dir, ...parts);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acuity-scanstore-'));
    file = at('scan_cache.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every scanned file across a restart', async () => {
    const store = createScanStore<Entry>(file);
    await store.load();
    store.replaceFolder(at('books'), [
      { filePath: at('books', 'Long Book', '01.mp3'), title: 'Part 1' },
      { filePath: at('books', 'Long Book', '02.mp3'), title: 'Part 2' },
    ]);
    await store.save();

    const next = createScanStore<Entry>(file);
    await next.load();
    expect(next.get(at('books', 'Long Book', '02.mp3'))?.title).toBe('Part 2');
  });

  it("replaces only the rescanned folder's files, so removed books drop out", async () => {
    const store = createScanStore<Entry>(file);
    await store.load();
    store.replaceFolder(at('books'), [
      { filePath: at('books', 'kept.epub'), title: 'Kept' },
      { filePath: at('books', 'deleted.epub'), title: 'Deleted' },
    ]);
    store.replaceFolder(at('books-private'), [{ filePath: at('books-private', 'other.epub'), title: 'Other' }]);

    store.replaceFolder(at('books'), [{ filePath: at('books', 'kept.epub'), title: 'Kept' }]);

    expect(store.get(at('books', 'kept.epub'))).toBeDefined();
    expect(store.get(at('books', 'deleted.epub'))).toBeUndefined();
    // A sibling folder whose name merely starts the same is untouched.
    expect(store.get(at('books-private', 'other.epub'))).toBeDefined();
  });

  it('lists what the last scan of a folder found, and nothing from a neighbouring folder', async () => {
    const store = createScanStore<Entry>(file);
    await store.load();
    store.replaceFolder(at('books'), [{ filePath: at('books', 'a.epub'), title: 'A' }]);
    store.replaceFolder(at('books-private'), [{ filePath: at('books-private', 'b.epub'), title: 'B' }]);

    expect(store.inFolder(at('books')).map((e) => e.title)).toEqual(['A']);
  });

  it('starts empty from a missing, unreadable or older-format file', async () => {
    const missing = createScanStore<Entry>(file);
    await missing.load();
    expect(missing.get(at('x.epub'))).toBeUndefined();

    fs.writeFileSync(file, '{ not json');
    const corrupt = createScanStore<Entry>(file);
    await corrupt.load();
    expect(corrupt.get(at('x.epub'))).toBeUndefined();

    fs.writeFileSync(file, JSON.stringify({ version: 0, items: [{ filePath: at('x.epub'), title: 'Old' }] }));
    const older = createScanStore<Entry>(file);
    await older.load();
    expect(older.get(at('x.epub'))).toBeUndefined();
  });
});
