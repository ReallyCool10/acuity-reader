import React from 'react';
import { Layers, Library } from 'lucide-react';
import type { Collection } from '../types';
import type { CollectionWorkItem } from '../lib/collections';
import { coverUrl } from '../lib/media';

interface CollectionCardProps {
  collection: Collection;
  resolvedWorks: CollectionWorkItem[];
  unresolvedCount?: number;
  onClick: () => void;
}

export const CollectionCard: React.FC<CollectionCardProps> = ({
  collection,
  resolvedWorks,
  unresolvedCount = 0,
  onClick,
}) => {
  const isSeries = collection.kind === 'series';
  const totalDisplayWorks = resolvedWorks.length;

  // Extract candidate items for cover mosaic (up to 4)
  const mosaicItems = resolvedWorks.slice(0, 4).map((w) => w.primaryItem);

  // Author summary if not explicitly provided in description
  const authors = Array.from(
    new Set(resolvedWorks.map((w) => w.primaryItem.author).filter(Boolean))
  );
  const subtitle =
    collection.description ||
    (authors.length === 1
      ? authors[0]
      : authors.length > 1
      ? `${authors[0]} & others`
      : `${totalDisplayWorks} ${totalDisplayWorks === 1 ? 'title' : 'titles'}`);

  const label = `${collection.name}, ${isSeries ? 'Series' : 'Collection'}. ${totalDisplayWorks} ${
    totalDisplayWorks === 1 ? 'work' : 'works'
  }${unresolvedCount > 0 ? `, ${unresolvedCount} offline` : ''}.`;

  return (
    <button
      type="button"
      className="book-card group"
      onClick={onClick}
      aria-label={label}
    >
      <div className="book-cover">
        {mosaicItems.length === 0 ? (
          /* Empty collection jacket */
          <div
            className="flex h-full w-full flex-col justify-between p-3.5"
            style={{
              background: 'linear-gradient(145deg, #181924, #0d0d14)',
            }}
          >
            <div
              className="pointer-events-none absolute inset-2 rounded-[3px] border"
              style={{ borderColor: 'var(--stroke-subtle)' }}
            />
            <div className="relative flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                {isSeries ? 'Series' : 'Collection'}
              </span>
              <Layers className="h-3.5 w-3.5 text-[var(--accent)]" />
            </div>

            <div className="relative my-auto px-1 text-center">
              <h4 className="line-clamp-3 font-serif text-[13px] font-semibold leading-snug text-[var(--text-primary)]">
                {collection.name}
              </h4>
              <p className="mt-1.5 text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                Empty
              </p>
            </div>

            <div className="relative flex justify-center">
              <div className="h-[2px] w-6 rounded-full bg-[var(--stroke-default)]" />
            </div>
          </div>
        ) : mosaicItems.length === 1 ? (
          /* Single cover */
          <div className="relative h-full w-full">
            {coverUrl(mosaicItems[0]) ? (
              <img
                src={coverUrl(mosaicItems[0])}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[var(--surface-raised)] text-[var(--text-tertiary)]">
                <Library className="h-8 w-8 opacity-40" />
              </div>
            )}
          </div>
        ) : mosaicItems.length === 2 || mosaicItems.length === 3 ? (
          /* 2 or 3 items split */
          <div className="grid h-full w-full grid-cols-2 divide-x divide-black/30">
            {mosaicItems.slice(0, 2).map((item, idx) => {
              const url = coverUrl(item);
              return (
                <div key={item.id || idx} className="relative h-full w-full overflow-hidden bg-[var(--surface-raised)]">
                  {url ? (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[var(--text-tertiary)]">
                      <Library className="h-5 w-5 opacity-40" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 4 items quadrant mosaic */
          <div className="grid h-full w-full grid-cols-2 grid-rows-2 divide-x divide-y divide-black/30">
            {mosaicItems.map((item, idx) => {
              const url = coverUrl(item);
              return (
                <div key={item.id || idx} className="relative h-full w-full overflow-hidden bg-[var(--surface-raised)]">
                  {url ? (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[var(--text-tertiary)]">
                      <Library className="h-4 w-4 opacity-40" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Collection Kind Badge */}
        <span
          className="absolute right-2 top-2 z-[3] rounded-[4px] border border-white/15 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-md"
          title={isSeries ? 'Ordered series' : 'Thematic collection'}
        >
          {isSeries ? 'Series' : 'Theme'}
        </span>

        {/* Member count pill in bottom */}
        <div className="absolute inset-x-0 bottom-0 z-[3] flex items-center justify-between bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 pb-2 pt-4">
          <span className="flex items-center gap-1 text-[10px] font-medium text-white/90">
            <Layers className="h-3 w-3 text-[var(--accent)]" />
            {totalDisplayWorks} {totalDisplayWorks === 1 ? 'work' : 'works'}
          </span>
          {unresolvedCount > 0 && (
            <span
              className="text-[9px] text-white/60"
              title={`${unresolvedCount} items offline`}
            >
              +{unresolvedCount} offline
            </span>
          )}
        </div>
      </div>

      <div className="mt-2.5 min-w-0">
        <h4
          className="line-clamp-2 text-[12.5px] font-medium leading-snug text-[var(--text-primary)] transition-colors duration-150 group-hover:text-[var(--accent-hover)]"
          title={collection.name}
        >
          {collection.name}
        </h4>
        <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]" title={subtitle}>
          {subtitle}
        </p>
      </div>
    </button>
  );
};
