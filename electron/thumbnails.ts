import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * Shelf thumbnails: storage and lookup.
 *
 * Covers are often 1,500-2,500 pixels tall, and a shelf draws them a few hundred
 * pixels tall. Decoding full-size covers is what made a fast scroll leave empty
 * slots behind, so shelves request `acuity://thumb/<path>` and are answered with
 * a small JPEG kept on disk here.
 *
 * The thumbnails are made in a Web Worker in the renderer (src/lib/thumbnails.ts),
 * not in this process. Electron's image decoding is synchronous, and this
 * process's JavaScript runs on the UI thread that also moves and repaints the
 * window, so decoding here stalled it for tens of milliseconds per cover. The
 * worker decodes off every UI thread, and reads WebP, which nativeImage cannot.
 *
 * Until a cover has a thumbnail, its original is served, as before.
 */

/** Bump to have every thumbnail made again, for example after changing their size. */
const THUMB_VERSION = 1;
/** A thumbnail is a few tens of kilobytes; anything near this is not one. */
export const MAX_THUMB_BYTES = 1024 * 1024;
const THUMB_FILE = /^[0-9a-f]{40}\.jpg$/;

interface FileStat {
  mtimeMs: number;
  size: number;
}

/**
 * Identifies a thumbnail by its source's path, modification time and size, so a
 * replaced cover gets a new thumbnail instead of a stale one.
 */
export function thumbnailKey(sourcePath: string, stat: FileStat): string {
  return crypto
    .createHash('sha1')
    .update(`${THUMB_VERSION}\0${path.resolve(sourcePath)}\0${stat.mtimeMs}\0${stat.size}`)
    .digest('hex');
}

export const isJpeg = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export interface ThumbnailStore {
  /** The file to serve for a shelf cover: its thumbnail if one exists, otherwise the cover itself. */
  servePath(sourcePath: string, stat: FileStat): Promise<string>;
  /** Which of these covers still need a thumbnail. Unreadable covers are left out. */
  missing(sourcePaths: string[]): Promise<string[]>;
  /** Keep a thumbnail the renderer made for this cover. False if it was refused. */
  save(sourcePath: string, jpeg: Uint8Array): Promise<boolean>;
  /** Delete thumbnails of covers not in this list (books removed, covers replaced). */
  prune(sourcePaths: string[]): Promise<void>;
}

export function createThumbnailStore(dir: string): ThumbnailStore {
  /** Keys known to have a thumbnail on disk this session. */
  const present = new Set<string>();
  const fileFor = (key: string) => path.join(dir, `${key}.jpg`);

  async function has(key: string): Promise<boolean> {
    if (present.has(key)) return true;
    try {
      await fs.promises.access(fileFor(key));
      present.add(key);
      return true;
    } catch {
      return false;
    }
  }

  async function statOf(sourcePath: string): Promise<FileStat | null> {
    try {
      return await fs.promises.stat(sourcePath);
    } catch {
      return null;
    }
  }

  return {
    async servePath(sourcePath, stat) {
      const key = thumbnailKey(sourcePath, stat);
      return (await has(key)) ? fileFor(key) : sourcePath;
    },

    async missing(sourcePaths) {
      const result: string[] = [];
      for (const sourcePath of new Set(sourcePaths)) {
        const stat = await statOf(sourcePath);
        if (stat && !(await has(thumbnailKey(sourcePath, stat)))) result.push(sourcePath);
      }
      return result;
    },

    async save(sourcePath, jpeg) {
      if (!isJpeg(jpeg) || jpeg.length > MAX_THUMB_BYTES) return false;
      const stat = await statOf(sourcePath);
      if (!stat) return false;
      const key = thumbnailKey(sourcePath, stat);
      const target = fileFor(key);
      const temp = `${target}.${process.pid}.tmp`;
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(temp, jpeg);
      await fs.promises.rename(temp, target);
      present.add(key);
      return true;
    },

    async prune(sourcePaths) {
      const keep = new Set<string>();
      for (const sourcePath of new Set(sourcePaths)) {
        const stat = await statOf(sourcePath);
        if (stat) keep.add(thumbnailKey(sourcePath, stat));
      }
      for (const name of await fs.promises.readdir(dir).catch(() => [] as string[])) {
        const key = name.slice(0, -'.jpg'.length);
        // Thumbnails seen or saved this session are current, including books added since the list was taken.
        if (!THUMB_FILE.test(name) || keep.has(key) || present.has(key)) continue;
        await fs.promises.unlink(path.join(dir, name)).catch(() => undefined);
      }
    },
  };
}
