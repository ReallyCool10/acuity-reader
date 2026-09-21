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
export function coverUrl(item: Pick<MediaItem, 'coverUrl'>): string {
  if (!item.coverUrl) return '';
  const raw = item.coverUrl.startsWith('file:///')
    ? decodeURI(item.coverUrl.slice('file:///'.length))
    : item.coverUrl;
  return mediaUrl(raw);
}

export function isReadable(item: MediaItem): boolean {
  return item.mediaType === 'book';
}

/** Formats the in-app reader can actually render today. */
export const SUPPORTED_BOOK_FORMATS = new Set(['epub']);

export function canRenderInReader(item: MediaItem): boolean {
  return SUPPORTED_BOOK_FORMATS.has(item.format.toLowerCase());
}
