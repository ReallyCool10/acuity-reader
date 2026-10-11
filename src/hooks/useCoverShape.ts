import { useState } from 'react';
import type { MediaItem } from '../types';
import { coverUrl } from '../lib/media';
import { DEFAULT_COVER_ASPECT } from '../lib/coverArt';

/** A cover image that is decoded and ready to show, and the frame shape it takes. */
export interface ShownCover {
  src: string;
  /** Frame shape (width / height), or null when the image failed and a jacket shows instead. */
  aspect: number | null;
}

/**
 * Whether a card's cover is ready to show, and at what shape.
 *
 * A cover stays hidden until its image is decoded, then appears at its own
 * shape; nothing stands in for it meanwhile. An item with no cover art is ready
 * at once, as a generated jacket. Readiness is tied to the image source, so if
 * a rescan gives the item different art, the new cover waits for its own image.
 */
export function useCoverShape(item: MediaItem) {
  const src = coverUrl(item);
  const [shown, setShown] = useState<ShownCover | null>(null);
  const current = shown !== null && shown.src === src ? shown : null;

  return {
    src,
    ready: !src || current !== null,
    aspect: current?.aspect ?? DEFAULT_COVER_ASPECT[item.mediaType],
    onShown: setShown,
  };
}
