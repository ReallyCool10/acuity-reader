import type { MediaItem } from '../types';
import { localCoverPath } from './media';

/**
 * Background maker of shelf thumbnails.
 *
 * Shelves request each cover as `acuity://thumb/<path>`; the main process serves
 * a saved thumbnail when there is one and the original otherwise
 * (electron/thumbnails.ts). This module makes the missing ones: it reads each
 * full-size cover, has a Web Worker shrink it off the UI thread, and hands the
 * JPEG back to the main process to keep. One cover at a time, after the first
 * screen has loaded, so it never competes with what is on screen.
 */

export interface ThumbnailRequest {
  id: number;
  bytes: Uint8Array;
}

export type ThumbnailResponse = { id: number; jpeg: Uint8Array } | { id: number; error: string };

export interface ThumbnailApi {
  thumbnailsMissing(coverPaths: string[]): Promise<string[]>;
  readBytes(path: string): Promise<Uint8Array | null>;
  saveThumbnail(coverPath: string, jpeg: Uint8Array): Promise<boolean>;
}

/**
 * Turns full-size image bytes into a thumbnail JPEG; null if this image cannot
 * be decoded. Rejects if thumbnails cannot be made at all.
 */
export type ThumbnailMaker = (bytes: Uint8Array) => Promise<Uint8Array | null>;

let latestRun = 0;

/** Resolve once the renderer is idle, so the first screen of covers loads first. */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 0);
  });
}

/**
 * Make thumbnails for any of these items' covers that lack one. A newer call
 * supersedes an older one, since the library has changed; thumbnails already
 * saved are kept.
 */
export async function warmThumbnails(
  items: MediaItem[],
  api: ThumbnailApi | undefined = window.electronAPI,
  make: ThumbnailMaker | null = workerThumbnailMaker()
): Promise<void> {
  const run = ++latestRun;
  const coverPaths = [...new Set(items.map(localCoverPath).filter(Boolean))];
  if (!api || !make || coverPaths.length === 0) return;

  await whenIdle();
  if (run !== latestRun) return;

  let missing: string[];
  try {
    missing = await api.thumbnailsMissing(coverPaths);
  } catch {
    return;
  }

  for (const coverPath of missing) {
    if (run !== latestRun) return;
    const bytes = await api.readBytes(coverPath).catch(() => null);
    if (!bytes) continue;
    let jpeg: Uint8Array | null;
    try {
      jpeg = await make(bytes);
    } catch {
      return; // No way to make thumbnails here; shelves keep using the originals.
    }
    if (jpeg) await api.saveThumbnail(coverPath, jpeg).catch(() => false);
  }
}

let sharedMaker: ThumbnailMaker | null | undefined;

/** A maker backed by one Web Worker, created on first use; null where workers are unavailable. */
function workerThumbnailMaker(): ThumbnailMaker | null {
  if (sharedMaker !== undefined) return sharedMaker;
  if (typeof Worker === 'undefined') return (sharedMaker = null);

  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (sharedMaker = null);
  }

  let nextId = 0;
  let broken = false;
  const waiting = new Map<number, { resolve: (jpeg: Uint8Array | null) => void; reject: (err: Error) => void }>();

  worker.onmessage = (event: MessageEvent<ThumbnailResponse>) => {
    const entry = waiting.get(event.data.id);
    waiting.delete(event.data.id);
    entry?.resolve('jpeg' in event.data ? event.data.jpeg : null);
  };
  // The worker failed to start or crashed: stop using it for this session.
  worker.onerror = () => {
    broken = true;
    worker.terminate();
    for (const entry of waiting.values()) entry.reject(new Error('Thumbnail worker unavailable'));
    waiting.clear();
  };

  sharedMaker = (bytes) =>
    new Promise((resolve, reject) => {
      if (broken) return reject(new Error('Thumbnail worker unavailable'));
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, bytes } satisfies ThumbnailRequest, [bytes.buffer]);
    });
  return sharedMaker;
}
