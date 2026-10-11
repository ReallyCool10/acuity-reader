import { describe, it, expect, vi } from 'vitest';
import type { MediaItem } from '../types';
import { warmThumbnails, type ThumbnailApi } from './thumbnails';

const item = (id: string, coverUrl?: string): MediaItem => ({
  id,
  title: id,
  author: '',
  filePath: `C:/books/${id}.epub`,
  mediaType: 'book',
  format: 'epub',
  fileSize: 1,
  fileModifiedAt: 0,
  firstSeenAt: 0,
  dirName: 'books',
  coverUrl,
});

function fakeApi(missing: (paths: string[]) => string[] = (paths) => paths) {
  const saved: string[] = [];
  const api: ThumbnailApi = {
    thumbnailsMissing: vi.fn(async (paths: string[]) => missing(paths)),
    readBytes: vi.fn(async (path: string) => (path.includes('unreadable') ? null : new TextEncoder().encode(path))),
    saveThumbnail: vi.fn(async (path: string) => {
      saved.push(path);
      return true;
    }),
  };
  return { api, saved };
}

const thumbnailOf = vi.fn(async (bytes: Uint8Array) => {
  const name = new TextDecoder().decode(bytes);
  return name.includes('corrupt') ? null : new Uint8Array([0xff, 0xd8, 0xff]);
});

describe('src/lib/thumbnails - warmThumbnails', () => {
  it('makes thumbnails for local covers the main process says are missing', async () => {
    const { api, saved } = fakeApi((paths) => paths.filter((p) => !p.includes('done')));
    await warmThumbnails(
      [
        item('a', 'C:/covers/a.jpg'),
        item('b', 'C:/covers/done.jpg'),
        item('c', 'C:/covers/a.jpg'), // a second edition sharing the same art
        item('d', 'data:image/png;base64,AAAA'),
        item('e'),
      ],
      api,
      thumbnailOf
    );

    expect(api.thumbnailsMissing).toHaveBeenCalledWith(['C:/covers/a.jpg', 'C:/covers/done.jpg']);
    expect(saved).toEqual(['C:/covers/a.jpg']);
  });

  it('skips covers that cannot be read or decoded and carries on', async () => {
    const { api, saved } = fakeApi();
    await warmThumbnails(
      [item('a', 'C:/covers/unreadable.jpg'), item('b', 'C:/covers/corrupt.jpg'), item('c', 'C:/covers/fine.jpg')],
      api,
      thumbnailOf
    );
    expect(saved).toEqual(['C:/covers/fine.jpg']);
  });

  it('stops when thumbnails cannot be made at all, leaving shelves on the originals', async () => {
    const { api, saved } = fakeApi();
    const unavailable = vi.fn(async () => {
      throw new Error('Thumbnail worker unavailable');
    });
    await warmThumbnails([item('a', 'C:/covers/a.jpg'), item('b', 'C:/covers/b.jpg')], api, unavailable);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(saved).toEqual([]);
  });

  it('gives way to a newer call when the library changes', async () => {
    const { api, saved } = fakeApi();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const slowFirst = vi.fn(async (bytes: Uint8Array) => {
      if (new TextDecoder().decode(bytes).includes('old-1')) await gate;
      return new Uint8Array([0xff, 0xd8, 0xff]);
    });

    const older = warmThumbnails(
      [item('1', 'C:/covers/old-1.jpg'), item('2', 'C:/covers/old-2.jpg')],
      api,
      slowFirst
    );
    await vi.waitFor(() => expect(slowFirst).toHaveBeenCalledTimes(1));
    const newer = warmThumbnails([item('3', 'C:/covers/new.jpg')], api, slowFirst);
    releaseFirst();
    await Promise.all([older, newer]);

    // The cover already in progress is kept; the rest of the old list is dropped.
    expect(saved.sort()).toEqual(['C:/covers/new.jpg', 'C:/covers/old-1.jpg']);
  });
});
