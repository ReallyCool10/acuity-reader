import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Headphones } from 'lucide-react';
import type { MediaItem } from '../types';
import { coverUrl } from '../lib/media';
import { coverAspectFor, themeForTitle } from '../lib/coverArt';

interface CoverArtProps {
  item: MediaItem;
  /** Cleaned title, printed on the generated jacket. */
  displayTitle: string;
  /**
   * Reports the frame shape once the image's natural size is known, or null
   * when there is no usable image and the default shape applies.
   */
  onAspectChange?: (aspect: number | null) => void;
}

/**
 * The art inside a `.book-cover`: the item's own cover at its natural shape,
 * or a generated jacket when it has none or the image fails to load.
 */
export const CoverArt: React.FC<CoverArtProps> = ({ item, displayTitle, onAspectChange }) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = coverUrl(item);

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    onAspectChange?.(coverAspectFor(img.naturalWidth, img.naturalHeight));
    setLoaded(true);
  }, [onAspectChange]);

  const handleError = useCallback(() => {
    setFailed(true);
    onAspectChange?.(null);
  }, [onAspectChange]);

  // A cached image can finish decoding before React attaches onLoad, which would
  // otherwise leave it stuck at opacity 0. Check completeness on mount too.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) handleLoad();
  }, [src, handleLoad]);

  if (!src || failed) return <Jacket item={item} displayTitle={displayTitle} />;

  return (
    <img
      ref={imgRef}
      src={src}
      alt=""
      data-loaded={loaded}
      loading="lazy"
      decoding="async"
      onLoad={handleLoad}
      onError={handleError}
      className="cover-image"
    />
  );
};

const Jacket: React.FC<{ item: MediaItem; displayTitle: string }> = ({ item, displayTitle }) => {
  const theme = themeForTitle(item.title);
  const Icon = item.mediaType === 'audio' ? Headphones : BookOpen;

  return (
    <div
      className="flex h-full w-full flex-col justify-between p-3"
      style={{ background: `linear-gradient(145deg, ${theme.from}, ${theme.to})` }}
    >
      {/* Debossed foil frame, echoing a cloth-bound hardcover. */}
      <div
        className="pointer-events-none absolute inset-2 rounded-[3px] border"
        style={{ borderColor: `${theme.accent}33` }}
      />
      <div className="relative flex items-center justify-between">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: theme.accent }}
        >
          {item.format}
        </span>
        <Icon className="h-3 w-3" style={{ color: theme.accent }} />
      </div>

      <div className="relative my-auto px-1 text-center">
        <h4
          className="line-clamp-4 font-serif text-[13px] font-semibold leading-snug"
          style={{ color: theme.ink }}
        >
          {displayTitle}
        </h4>
        {item.author && (
          <p
            className="mt-2 truncate text-[9px] uppercase tracking-[0.16em]"
            style={{ color: theme.accent }}
          >
            {item.author}
          </p>
        )}
      </div>

      <div className="relative flex justify-center">
        <div className="h-[2px] w-5 rounded-full opacity-50" style={{ background: theme.accent }} />
      </div>
    </div>
  );
};
