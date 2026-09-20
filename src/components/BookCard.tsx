import React from 'react';
import { Headphones, BookOpen, Play } from 'lucide-react';
import type { MediaItem, ProgressItem } from '../types';

interface BookCardProps {
  item: MediaItem;
  progress?: ProgressItem;
  isPlaying?: boolean;
  onOpenBook: (item: MediaItem) => void;
  onPlayAudio: (item: MediaItem) => void;
}

export const BookCard: React.FC<BookCardProps> = ({
  item,
  progress,
  isPlaying,
  onOpenBook,
  onPlayAudio,
}) => {
  const isAudio = item.mediaType === 'audio';
  const percent = progress?.percent ?? 0;
  const hasCompanion = !!item.companionPath;

  const handleClick = () => {
    if (isAudio) {
      onPlayAudio(item);
    } else {
      onOpenBook(item);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`group relative flex flex-col p-2.5 rounded-xl border bg-neutral-900/60 hover:bg-neutral-850 cursor-pointer transition-all ${
        isPlaying ? 'border-amber-500/50 shadow-md shadow-amber-950/30' : 'border-neutral-800/80 hover:border-neutral-700'
      }`}
    >
      {/* Cover representation */}
      <div className="relative aspect-[3/4] w-full rounded-lg overflow-hidden bg-gradient-to-br from-neutral-800 to-neutral-900 flex flex-col justify-between p-3 border border-neutral-800/50">
        {/* Top Badges */}
        <div className="flex items-center justify-between z-10">
          <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-neutral-950/80 text-neutral-300 border border-neutral-700/50">
            {item.format}
          </span>

          {hasCompanion && (
            <span
              title="Companion edition available"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded bg-amber-500/10 text-amber-300 border border-amber-500/20"
            >
              {isAudio ? <BookOpen className="w-2.5 h-2.5" /> : <Headphones className="w-2.5 h-2.5" />}
              <span>Dual</span>
            </span>
          )}
        </div>

        {/* Center Graphic / Play overlay */}
        <div className="flex items-center justify-center py-4">
          {isPlaying ? (
            <div className="flex items-center gap-1">
              <span className="w-1 h-4 bg-amber-400 animate-pulse rounded-full" />
              <span className="w-1 h-6 bg-amber-400 animate-pulse delay-75 rounded-full" />
              <span className="w-1 h-3 bg-amber-400 animate-pulse delay-150 rounded-full" />
            </div>
          ) : isAudio ? (
            <div className="w-9 h-9 rounded-full bg-neutral-950/70 border border-neutral-700/60 flex items-center justify-center text-neutral-300 group-hover:scale-105 group-hover:text-neutral-100 transition-all">
              <Play className="w-4 h-4 ml-0.5" />
            </div>
          ) : (
            <BookOpen className="w-7 h-7 text-neutral-600 group-hover:text-neutral-400 transition-colors" />
          )}
        </div>

        {/* Bottom Progress Bar on Cover */}
        {percent > 0 && (
          <div className="w-full bg-neutral-950/80 rounded-full h-1 overflow-hidden z-10">
            <div
              className={`h-full rounded-full ${isAudio ? 'bg-amber-400' : 'bg-emerald-400'}`}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="mt-2 flex flex-col min-w-0">
        <h4 className="text-xs font-medium text-neutral-200 truncate group-hover:text-white transition-colors" title={item.title}>
          {item.title}
        </h4>
        <div className="flex items-center justify-between text-[11px] text-neutral-500 mt-0.5">
          <span className="truncate pr-1" title={item.author}>{item.author}</span>
          {percent > 0 && <span className="text-[10px] tabular-nums text-neutral-400">{Math.round(percent)}%</span>}
        </div>
      </div>
    </div>
  );
};
