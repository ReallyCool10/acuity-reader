import React, { useRef, useState } from 'react';
import { ArrowUpDown, Check, Search, X } from 'lucide-react';
import type { MediaType, SortKey } from '../types';
import { useDismissable } from '../hooks/useDismissable';

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilter: 'all' | MediaType | 'collections';
  onFilterChange: (filter: 'all' | MediaType | 'collections') => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  counts: { all: number; books: number; audio: number; collections: number };
  searchRef?: React.RefObject<HTMLInputElement | null>;
}

const FILTERS: { key: 'all' | MediaType | 'collections'; label: string; countKey: keyof LibraryToolbarProps['counts'] }[] = [
  { key: 'all', label: 'All', countKey: 'all' },
  { key: 'book', label: 'Books', countKey: 'books' },
  { key: 'audio', label: 'Audio', countKey: 'audio' },
  { key: 'collections', label: 'Collections', countKey: 'collections' },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recently played' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'added', label: 'Date added' },
];

export const LibraryToolbar: React.FC<LibraryToolbarProps> = ({
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  sortKey,
  onSortChange,
  counts,
  searchRef,
}) => {
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement | null>(null);
  useDismissable(sortRef, isSortOpen, () => setIsSortOpen(false));

  return (
    <div className="acu-no-drag px-4 pb-3 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search bar with focused, clean width */}
          <div className="relative flex items-center w-56 sm:w-64 md:w-72 shrink-0">
            <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search your library"
              aria-label="Search your library"
              className="h-8.5 w-full rounded-[var(--radius-lg)] border border-[var(--stroke-subtle)] bg-[var(--surface-raised)] pl-8.5 pr-8 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-150 ease-[var(--ease-out)] hover:bg-[var(--surface-raised-hover)] focus:border-[var(--accent-ring)] focus:bg-[var(--surface-sunken)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="icon-button absolute right-1 h-6.5 w-6.5"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Filter buttons in line to the right of the search bar */}
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter by media type">
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className="pill"
                aria-pressed={activeFilter === filter.key}
                onClick={() => onFilterChange(filter.key)}
              >
                {filter.label}
                <span className="pill-count">{counts[filter.countKey]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sort Menu on the far right */}
        <div className="relative shrink-0" ref={sortRef}>
          <button
            type="button"
            className="icon-button"
            onClick={() => setIsSortOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={isSortOpen}
            aria-label={`Sort by ${SORTS.find((s) => s.key === sortKey)?.label}`}
            title="Sort"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>

          {isSortOpen && (
            <div className="menu right-0 top-full mt-1.5" style={{ '--menu-origin': 'top right' } as React.CSSProperties} role="menu">
              {SORTS.map((sort) => (
                <button
                  key={sort.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sortKey === sort.key}
                  className="menu-item"
                  onClick={() => {
                    onSortChange(sort.key);
                    setIsSortOpen(false);
                  }}
                >
                  <span>{sort.label}</span>
                  {sortKey === sort.key && <Check className="h-3 w-3" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
