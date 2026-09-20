import React from 'react';
import { Search, X } from 'lucide-react';
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
    <div className="px-4 pb-3 pt-2.5 space-y-2.5 select-none">
      {/* Fluent Glass Search Input */}
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search titles, authors, formats..."
          className="w-full pl-9 pr-8 py-2 text-xs bg-white/[0.05] hover:bg-white/[0.08] focus:bg-neutral-900/90 border border-white/[0.08] focus:border-amber-500/50 rounded-lg text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-all shadow-xs"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 p-1 text-neutral-400 hover:text-white rounded-md hover:bg-white/[0.1] transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Filter Pills - Windows 11 Fluent style */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onFilterChange('all')}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all shadow-2xs ${
            activeFilter === 'all'
              ? 'bg-white text-neutral-900 shadow-sm font-semibold'
              : 'text-neutral-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
          }`}
        >
          All ({counts.all})
        </button>

        <button
          onClick={() => onFilterChange('book')}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all shadow-2xs ${
            activeFilter === 'book'
              ? 'bg-white text-neutral-900 shadow-sm font-semibold'
              : 'text-neutral-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
          }`}
        >
          Books ({counts.books})
        </button>

        <button
          onClick={() => onFilterChange('audio')}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all shadow-2xs ${
            activeFilter === 'audio'
              ? 'bg-white text-neutral-900 shadow-sm font-semibold'
              : 'text-neutral-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
          }`}
        >
          Audio ({counts.audio})
        </button>
      </div>
    </div>
  );
};
