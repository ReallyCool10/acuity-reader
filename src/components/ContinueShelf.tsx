import React from 'react';
import type { MediaItem, ProgressItem } from '../types';
import { BookCard } from './BookCard';
import { resolveAudiobookProgress } from '../lib/audiobookGrouping';

interface ContinueShelfProps {
  items: MediaItem[];
  progress: Record<string, ProgressItem>;
  activeAudioId?: string;
  onOpen: (item: MediaItem) => void;
}

/**
 * The "pick up where you left off" row.
 *
 * Apple Books leads with this because the thing a reader wants on launch is
 * almost always the book they were last in — not an alphabetical wall.
 */
export const ContinueShelf: React.FC<ContinueShelfProps> = ({
  items,
  progress,
  activeAudioId,
  onOpen,
}) => {
  if (items.length === 0) return null;

  return (
    <section className="mb-5" aria-labelledby="continue-heading">
      <h2
        id="continue-heading"
        className="mb-2.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]"
      >
        Continue
      </h2>
      <div className="shelf-scroller">
        {items.map((item) => (
          <BookCard
            key={item.id}
            item={item}
            progress={resolveAudiobookProgress(item, progress) ?? progress[item.id]}
            isPlaying={activeAudioId === item.id}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
};
