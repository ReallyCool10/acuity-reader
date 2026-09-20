import React from 'react';
import { Search } from 'lucide-react';
import type { MediaType } from '../types';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilter: 'all' | MediaType;
  onFilterChange: (filter: 'all' | MediaType) => void;
  counts: { all: number; books: number; audio: number };
}

export const SearchBar: React.FC<SearchBarProps> = ({
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  counts,
}) => {
  return (
    <div className="px-3.5 pb-2.5 pt-1 space-y-2">
      {/* Search Input */}
      <div className="relative flex items-center">
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-neutral-500 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search titles, authors..."
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-600 transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 text-xs text-neutral-500 hover:text-neutral-300"
          >
            ×
          </button>
        )}
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onFilterChange('all')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            activeFilter === 'all'
              ? 'bg-neutral-100 text-neutral-900'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          All ({counts.all})
        </button>

        <button
          onClick={() => onFilterChange('book')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            activeFilter === 'book'
              ? 'bg-neutral-100 text-neutral-900'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          Books ({counts.books})
        </button>

        <button
          onClick={() => onFilterChange('audio')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            activeFilter === 'audio'
              ? 'bg-neutral-100 text-neutral-900'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
          }`}
        >
          Audio ({counts.audio})
        </button>
      </div>
    </div>
  );
};
