import type { MediaItem } from '../types';

/**
 * Build a URL the renderer can load for a file on disk.
 *
 * Everything goes through the `acuity://` scheme registered in the main process
 * rather than raw `file://`. That is what allows `webSecurity` to stay enabled:
 * the main process resolves each request against the user's registered library
 * folders and refuses anything outside them.
 */
export function mediaUrl(absolutePath: string): string {
  if (!absolutePath) return '';
  if (/^(acuity|https?|data|blob):/i.test(absolutePath)) return absolutePath;
  return `acuity://media/${encodeURIComponent(absolutePath)}`;
}

/** Covers extracted at scan time are already absolute paths; normalise both shapes. */
function coverPath(item: Pick<MediaItem, 'coverUrl'>): string {
  if (!item.coverUrl) return '';
  return item.coverUrl.startsWith('file:///')
    ? decodeURI(item.coverUrl.slice('file:///'.length))
    : item.coverUrl;
}

const NON_FILE_URL = /^(acuity|https?|data|blob):/i;

/** The cover's path on disk, or '' when it has none or it is not a local file. */
export function localCoverPath(item: Pick<MediaItem, 'coverUrl'>): string {
  const raw = coverPath(item);
  return NON_FILE_URL.test(raw) ? '' : raw;
}

/** The full-size cover, for the full-screen player and the system media controls. */
export function coverUrl(item: Pick<MediaItem, 'coverUrl'>): string {
  return mediaUrl(coverPath(item));
}

/**
 * A small copy of the cover, for shelves and lists. Thumbnails are made in the
 * background (`src/lib/thumbnails.ts`) and kept by the main process, which
 * serves the original until one exists. A cover that is not a local file is
 * used as it is.
 */
export function coverThumbUrl(item: Pick<MediaItem, 'coverUrl'>): string {
  const local = localCoverPath(item);
  return local ? `acuity://thumb/${encodeURIComponent(local)}` : coverPath(item);
}

export function isReadable(item: MediaItem): boolean {
  return item.mediaType === 'book';
}

/** Formats the in-app reader can actually render today. */
export const SUPPORTED_BOOK_FORMATS = new Set(['epub', 'pdf']);

export function canRenderInReader(item: MediaItem): boolean {
  return SUPPORTED_BOOK_FORMATS.has(item.format.toLowerCase());
}
