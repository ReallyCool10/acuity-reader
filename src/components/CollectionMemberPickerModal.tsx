import React, { useMemo, useRef, useState } from 'react';
import { Check, Headphones, BookOpen, Search, X } from 'lucide-react';
import type { Collection, MediaItem } from '../types';
import { useDismissable } from '../hooks/useDismissable';
import { coverUrl } from '../lib/media';

interface CollectionMemberPickerModalProps {
  isOpen: boolean;
  collection: Collection;
  libraryItems: MediaItem[];
  onClose: () => void;
  onToggleMember: (itemId: string, shouldInclude: boolean) => void;
}

export const CollectionMemberPickerModal: React.FC<CollectionMemberPickerModalProps> = ({
  isOpen,
  collection,
  libraryItems,
  onClose,
  onToggleMember,
}) => {
  const [search, setSearch] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDismissable(dialogRef, isOpen, onClose);

  const memberSet = useMemo(() => new Set(collection.memberIds), [collection.memberIds]);

  // Group or dedupe candidate items by companion group so paired editions appear together
  const displayItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = libraryItems.filter((item) => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.author && item.author.toLowerCase().includes(q)) ||
        item.format.toLowerCase().includes(q)
      );
    });

    return filtered.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  }, [libraryItems, search]);

  if (!isOpen) return null;

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-picker-title"
        className="animate-sheet-in flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--stroke-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-xl)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--stroke-subtle)] px-5 py-3.5">
          <div className="min-w-0 pr-3">
            <h2 id="member-picker-title" className="text-[13.5px] font-semibold text-[var(--text-primary)]">
              Manage Collection Members
            </h2>
            <p className="truncate text-[11.5px] text-[var(--text-tertiary)]">
              {collection.name} ({collection.memberIds.length} members)
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close dialog">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Search bar */}
        <div className="border-b border-[var(--stroke-subtle)] bg-[var(--surface-sunken)]/30 px-4 py-2.5">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter books and audiobooks..."
              autoFocus
              className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--stroke-subtle)] bg-[var(--surface-raised)] pl-8 pr-3 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-ring)] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {displayItems.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-[var(--text-tertiary)]">
              No matching books found in your library.
            </p>
          ) : (
            <div className="space-y-1">
              {displayItems.map((item) => {
                const isMember = memberSet.has(item.id);
                const isAudio = item.mediaType === 'audio';
                const url = coverUrl(item);

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onToggleMember(item.id, !isMember)}
                    className="flex w-full items-center justify-between rounded-[var(--radius-md)] p-2 text-left transition-colors hover:bg-[var(--surface-raised)]"
                  >
                    <div className="flex min-w-0 items-center gap-2.5 pr-3">
                      {/* Mini thumbnail */}
                      <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded-[2px] bg-[var(--surface-sunken)]">
                        {url ? (
                          <img
                            src={url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--text-tertiary)]">
                            {isAudio ? (
                              <Headphones className="h-3.5 w-3.5" />
                            ) : (
                              <BookOpen className="h-3.5 w-3.5" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                            {item.title}
                          </span>
                          <span className="shrink-0 rounded-[3px] border border-[var(--stroke-subtle)] bg-[var(--surface-sunken)] px-1 py-0.2 text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">
                            {item.format}
                          </span>
                        </div>
                        {item.author && (
                          <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                            {item.author}
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                        isMember
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                          : 'border-[var(--stroke-default)] bg-[var(--surface-base)]'
                      }`}
                    >
                      {isMember && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end border-t border-[var(--stroke-subtle)] bg-[var(--surface-sunken)]/40 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="button-primary text-[12px]"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
};
