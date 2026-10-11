import type { MediaItem } from '../types';

/**
 * Generated jackets for titles with no embedded art. Hashing the title to a
 * palette keeps a given book visually stable across rescans, so the shelf does
 * not reshuffle its colours every time the library is refreshed.
 */
export const JACKET_THEMES = [
  { from: '#232630', to: '#0b0c0f', ink: '#f0e4cc', accent: '#d9b169' },
  { from: '#43141f', to: '#140407', ink: '#f7dde2', accent: '#e79aa8' },
  { from: '#0f2b23', to: '#04100c', ink: '#d9f2e6', accent: '#6cc9a2' },
  { from: '#13243a', to: '#050a12', ink: '#dbe9f8', accent: '#7fb0e0' },
  { from: '#3a2113', to: '#0f0704', ink: '#f6e4cf', accent: '#d9a463' },
  { from: '#2c1540', to: '#0c0512', ink: '#ead9f6', accent: '#b384d8' },
];

export type JacketTheme = (typeof JACKET_THEMES)[number];

export function themeForTitle(title: string): JacketTheme {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  return JACKET_THEMES[Math.abs(hash) % JACKET_THEMES.length];
}

/**
 * Covers are drawn at their own shape (width / height), standing on a shared
 * shelf line. These are the shapes used before an image has loaded, and for
 * generated jackets: a 2:3 book and a square audiobook.
 */
export const DEFAULT_COVER_ASPECT: Record<MediaItem['mediaType'], number> = {
  book: 2 / 3,
  audio: 1,
};

/**
 * The narrowest and widest shapes a cover frame may take. A badly extracted
 * image (a thin banner, a spine strip) would otherwise squash or stretch its
 * card; outside this range the frame stops at the limit and the whole image is
 * still shown inside it.
 */
export const MIN_COVER_ASPECT = 0.5;
export const MAX_COVER_ASPECT = 1.5;

/** The frame shape for an image of the given natural size, or null if it has none. */
export function coverAspectFor(width: number, height: number): number | null {
  if (!(width > 0 && height > 0)) return null;
  return Math.min(MAX_COVER_ASPECT, Math.max(MIN_COVER_ASPECT, width / height));
}
