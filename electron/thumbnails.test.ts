import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createThumbnailStore, MAX_THUMB_BYTES, thumbnailKey } from './thumbnails';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('electron/thumbnails', () => {
  let root: string;
  let dir: string;

  function cover(name: string, contents = 'full-size cover') {
    const file = path.join(root, name);
    fs.writeFileSync(file, contents);
    return { file, stat: fs.statSync(file) };
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'acuity-thumbs-'));
    dir = path.join(root, 'thumbs');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves the original until a thumbnail is saved, then the thumbnail', async () => {
    const store = createThumbnailStore(dir);
    const { file, stat } = cover('kindle.jpg');

    expect(await store.servePath(file, stat)).toBe(file);
    expect(await store.missing([file, file])).toEqual([file]);

    expect(await store.save(file, JPEG)).toBe(true);
    const served = await store.servePath(file, stat);
    expect(path.dirname(served)).toBe(dir);
    expect(new Uint8Array(fs.readFileSync(served))).toEqual(JPEG);
    expect(await store.missing([file])).toEqual([]);

    // A later session finds it on disk.
    expect(await createThumbnailStore(dir).servePath(file, stat)).toBe(served);
  });

  it('needs a new thumbnail when the cover file is replaced', async () => {
    const store = createThumbnailStore(dir);
    const { file } = cover('cover.jpg');
    await store.save(file, JPEG);

    fs.writeFileSync(file, 'a different, longer cover image');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(await store.missing([file])).toEqual([file]);
    expect(await store.servePath(file, fs.statSync(file))).toBe(file);
  });

  it('refuses anything that is not a small JPEG, and covers that do not exist', async () => {
    const store = createThumbnailStore(dir);
    const { file } = cover('cover.jpg');

    expect(await store.save(file, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    const huge = new Uint8Array(MAX_THUMB_BYTES + 1);
    huge.set(JPEG);
    expect(await store.save(file, huge)).toBe(false);
    expect(await store.save(path.join(root, 'gone.jpg'), JPEG)).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('leaves unreadable covers out of the missing list', async () => {
    const store = createThumbnailStore(dir);
    expect(await store.missing([path.join(root, 'gone.jpg')])).toEqual([]);
  });

  it('prunes thumbnails of covers no longer in the library, and nothing else', async () => {
    const kept = cover('kept.jpg');
    const removed = cover('removed.jpg', 'another cover');
    const first = createThumbnailStore(dir);
    await first.save(kept.file, JPEG);
    await first.save(removed.file, JPEG);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not ours');

    await createThumbnailStore(dir).prune([kept.file]);

    expect(fs.readdirSync(dir).sort()).toEqual([`${thumbnailKey(kept.file, kept.stat)}.jpg`, 'notes.txt'].sort());
  });

  it('does not prune a thumbnail saved for a book added after the list was taken', async () => {
    const store = createThumbnailStore(dir);
    const added = cover('added.jpg');
    await store.save(added.file, JPEG);

    await store.prune([]);

    expect(await store.missing([added.file])).toEqual([]);
    expect(fs.existsSync(path.join(dir, `${thumbnailKey(added.file, added.stat)}.jpg`))).toBe(true);
  });
});
