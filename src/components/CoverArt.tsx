import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Headphones } from 'lucide-react';
import type { MediaItem } from '../types';
import { coverAspectFor, themeForTitle } from '../lib/coverArt';
import type { ShownCover } from '../hooks/useCoverShape';

interface CoverArtProps {
  item: MediaItem;
  /** Cleaned title, printed on the generated jacket. */
  displayTitle: string;
  /** From `useCoverShape`. Render with `key={src}` so a new image starts afresh. */
  src: string;
  /** Called once the image is decoded and can be shown, or has failed. */
  onShown: (shown: ShownCover) => void;
  /** A badge sits in a top corner; keep the jacket's label row clear of it. */
  belowBadges?: boolean;
}

/**
 * The art inside a `.book-cover`: the item's own cover at its natural shape,
 * or a generated jacket when it has none or the image fails to load.
 */
export const CoverArt: React.FC<CoverArtProps> = ({ item, displayTitle, src, onShown, belowBadges = false }) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);

  const reveal = useCallback(
    (img: HTMLImageElement) => onShown({ src, aspect: coverAspectFor(img.naturalWidth, img.naturalHeight) }),
    [src, onShown]
  );

  // Wait for the decode as well as the download, so the cover appears whole
  // rather than as an empty frame that the picture pops into a moment later.
  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    img.decode().then(
      () => reveal(img),
      () => {
        if (img.naturalWidth > 0) reveal(img);
      }
    );
  }, [reveal]);

  const handleError = useCallback(() => {
    setFailed(true);
    onShown({ src, aspect: null });
  }, [src, onShown]);

  // An image already in memory (the library grid remounting, say) is shown
  // before the first paint, without a fade. Its load event may also have fired
  // before React attached the handler.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) reveal(img);
  }, [reveal]);

  if (!src || failed) return <Jacket item={item} displayTitle={displayTitle} belowBadges={belowBadges} />;

  return (
    <img
      ref={imgRef}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={handleLoad}
      onError={handleError}
      className="cover-image"
    />
  );
};

const Jacket: React.FC<{ item: MediaItem; displayTitle: string; belowBadges: boolean }> = ({
  item,
  displayTitle,
  belowBadges,
}) => {
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
      <div className={`relative flex items-center justify-between ${belowBadges ? 'mt-5' : ''}`}>
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
