import React from 'react';
import { FolderPlus, Play } from 'lucide-react';
import type { MediaItem, ProgressItem } from '../types';
import { cleanTitleString } from '../lib/metadata';
import { useCoverShape } from '../hooks/useCoverShape';
import { CoverArt } from './CoverArt';

interface BookCardProps {
  item: MediaItem;
  progress?: ProgressItem;
  isPlaying?: boolean;
  onOpen: (item: MediaItem) => void;
  onAddToCollection?: (item: MediaItem) => void;
}

/**
 * A book standing on the shelf. Every card reserves the same slot height and
 * the cover stands at the bottom of it at its own shape, so books of different
 * proportions share one shelf line and their titles stay level. The slot stays
 * empty until the cover image is decoded; then the cover fades in.
 *
 * The card is a container rather than a button: the "Add to collection"
 * control is a button too, and a button may not contain another. The open
 * button covers the cover and caption; the control sits in an overlay that
 * mirrors the cover's box (see `.cover-frame` in tokens.css).
 *
 * Memoised: audio progress updates the library about four times a second, and
 * without it every card on the shelf redrew each time. Pass stable callbacks.
 */
export const BookCard = React.memo(function BookCard({
  item,
  progress,
  isPlaying,
  onOpen,
  onAddToCollection,
}: BookCardProps) {
  const { src, ready, aspect, onShown } = useCoverShape(item);
  const isAudio = item.mediaType === 'audio';
  const percent = progress?.percent ?? 0;
  const displayTitle = cleanTitleString(item.title) || item.title;

  const label = `${displayTitle}${item.author ? `, by ${item.author}` : ''}. ${
    isAudio ? 'Audiobook' : 'Book'
  }${percent > 0 ? `, ${Math.round(percent)} percent complete` : ''}.`;

  return (
    <div
      className="book-card group"
      data-cover-ready={ready}
      style={{ '--cover-aspect': aspect } as React.CSSProperties}
    >
      <button type="button" className="book-open" onClick={() => onOpen(item)} aria-label={label}>
        <div className="book-slot">
          <div className="book-cover" data-media-type={item.mediaType}>
            <CoverArt key={src} item={item} displayTitle={displayTitle} src={src} onShown={onShown} />

            {item.companionPath ? (
              <span
                className="absolute right-2 top-2 z-[3] rounded-[4px] border border-white/15 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-md"
                title="Both a text and an audio edition are in your library"
              >
                Dual
              </span>
            ) : item.tracks && item.tracks.length > 1 ? (
              <span
                className="absolute right-2 top-2 z-[3] rounded-[4px] border border-white/15 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-md"
                title={`${item.tracks.length} tracks consolidated into one audiobook`}
              >
                {item.tracks.length} parts
              </span>
            ) : null}

            {isAudio && (
              <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center">
                {isPlaying ? (
                  <span className="flex items-end gap-[3px] rounded-full bg-black/70 p-2.5 backdrop-blur-md">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-[3px] rounded-full bg-[var(--accent)]"
                        style={{
                          height: [10, 16, 7][i],
                          animation: `eq-bar 900ms ${i * 140}ms ease-in-out infinite alternate`,
                          transformOrigin: 'bottom',
                        }}
                      />
                    ))}
                  </span>
                ) : (
                  <span className="flex h-11 w-11 translate-y-1 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white opacity-0 backdrop-blur-md transition-all duration-200 ease-[var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100 in-focus-visible:translate-y-0 in-focus-visible:opacity-100">
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  </span>
                )}
              </div>
            )}

            {percent > 0 && (
              <div className="absolute inset-x-0 bottom-0 z-[3] h-[3px] bg-black/55">
                <div
                  className="h-full rounded-r-full transition-[width] duration-300 ease-[var(--ease-out)]"
                  style={{
                    width: `${Math.min(100, Math.max(2, percent))}%`,
                    background: isAudio ? 'var(--accent)' : 'var(--accent-read)',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-2.5 min-w-0">
          <h4
            className="line-clamp-2 text-[12.5px] font-medium leading-snug text-[var(--text-primary)] transition-colors duration-150 group-hover:text-[var(--accent-hover)]"
            title={displayTitle}
          >
            {displayTitle}
          </h4>
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]" title={item.author}>
            {item.author}
          </p>
        </div>
      </button>

      {onAddToCollection && (
        <div className="book-slot book-slot--overlay">
          <div className="cover-frame">
            <button
              type="button"
              onClick={() => onAddToCollection(item)}
              className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white/80 opacity-0 backdrop-blur-md transition-opacity duration-150 hover:bg-black/90 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
              title="Add to Collection..."
              aria-label={`Add ${displayTitle} to collection`}
            >
              <FolderPlus className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
