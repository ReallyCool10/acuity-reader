import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FolderPlus, Headphones, Play } from 'lucide-react';
import type { MediaItem, ProgressItem } from '../types';
import { coverUrl } from '../lib/media';
import { cleanTitleString } from '../lib/metadata';

interface BookCardProps {
  item: MediaItem;
  progress?: ProgressItem;
  isPlaying?: boolean;
  onOpen: (item: MediaItem) => void;
  onAddToCollection?: (item: MediaItem) => void;
}

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

export function themeForTitle(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  return JACKET_THEMES[Math.abs(hash) % JACKET_THEMES.length];
}

export const BookCard: React.FC<BookCardProps> = ({
  item,
  progress,
  isPlaying,
  onOpen,
  onAddToCollection,
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const isAudio = item.mediaType === 'audio';
  const percent = progress?.percent ?? 0;
  const src = coverUrl(item);
  const theme = themeForTitle(item.title);

  // A cached image can finish decoding before React attaches onLoad, which would
  // otherwise leave it stuck at opacity 0. Check completeness on mount too.
  const markLoaded = useCallback(() => setLoaded(true), []);
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setLoaded(true);
  }, [src]);

  const showCover = Boolean(src) && !failed;
  const displayTitle = cleanTitleString(item.title) || item.title;

  const label = `${displayTitle}${item.author ? `, by ${item.author}` : ''}. ${
    isAudio ? 'Audiobook' : 'Book'
  }${percent > 0 ? `, ${Math.round(percent)} percent complete` : ''}.`;

  return (
    <button type="button" className="book-card group" onClick={() => onOpen(item)} aria-label={label}>
      <div className="book-cover">
        {showCover ? (
          <img
            ref={imgRef}
            src={src}
            alt=""
            data-loaded={loaded}
            loading="lazy"
            decoding="async"
            onLoad={markLoaded}
            onError={() => setFailed(true)}
          />
        ) : (
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
              {isAudio ? (
                <Headphones className="h-3 w-3" style={{ color: theme.accent }} />
              ) : (
                <BookOpen className="h-3 w-3" style={{ color: theme.accent }} />
              )}
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
              <div
                className="h-[2px] w-5 rounded-full opacity-50"
                style={{ background: theme.accent }}
              />
            </div>
          </div>
        )}

        {item.companionPath && (
          <span
            className="absolute right-2 top-2 z-[3] rounded-[4px] border border-white/15 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-md"
            title="Both a text and an audio edition are in your library"
          >
            Dual
          </span>
        )}

        {onAddToCollection && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddToCollection(item);
            }}
            className="absolute left-2 top-2 z-[4] flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white/80 opacity-0 backdrop-blur-md transition-opacity duration-150 hover:bg-black/90 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
            title="Add to Collection..."
            aria-label={`Add ${item.title} to collection`}
          >
            <FolderPlus className="h-3 w-3" />
          </button>
        )}

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
              <span className="flex h-11 w-11 translate-y-1 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white opacity-0 backdrop-blur-md transition-all duration-200 ease-[var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
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
  );
};
