import React, { useState } from 'react';
import { Headphones, BookOpen, Play } from 'lucide-react';
import type { MediaItem, ProgressItem } from '../types';

interface BookCardProps {
  item: MediaItem;
  progress?: ProgressItem;
  isPlaying?: boolean;
  onOpenBook: (item: MediaItem) => void;
  onPlayAudio: (item: MediaItem) => void;
}

// 6 Apple Books classical jacket palettes for titles without embedded cover art
const JACKET_THEMES = [
  {
    gradient: 'from-[#1a1c22] via-[#121317] to-[#0a0b0d]',
    border: 'border-white/10',
    titleColor: 'text-amber-100/90',
    accentColor: 'text-amber-400/80',
    frameBorder: 'border-amber-400/20',
  },
  {
    gradient: 'from-[#42121e] via-[#280911] to-[#120307]',
    border: 'border-rose-950/40',
    titleColor: 'text-rose-100/90',
    accentColor: 'text-rose-300/80',
    frameBorder: 'border-rose-300/20',
  },
  {
    gradient: 'from-[#0e2a22] via-[#081a15] to-[#030d0a]',
    border: 'border-emerald-950/40',
    titleColor: 'text-emerald-100/90',
    accentColor: 'text-emerald-400/80',
    frameBorder: 'border-emerald-400/20',
  },
  {
    gradient: 'from-[#122238] via-[#091422] to-[#040910]',
    border: 'border-blue-950/40',
    titleColor: 'text-sky-100/90',
    accentColor: 'text-sky-300/80',
    frameBorder: 'border-sky-300/20',
  },
  {
    gradient: 'from-[#382012] via-[#221209] to-[#0e0703]',
    border: 'border-amber-950/40',
    titleColor: 'text-amber-100/90',
    accentColor: 'text-amber-300/80',
    frameBorder: 'border-amber-400/20',
  },
  {
    gradient: 'from-[#2b143a] via-[#1a0a24] to-[#0b0410]',
    border: 'border-purple-950/40',
    titleColor: 'text-purple-100/90',
    accentColor: 'text-purple-300/80',
    frameBorder: 'border-purple-300/20',
  },
];

function getThemeForTitle(title: string) {
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
  onOpenBook,
  onPlayAudio,
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const isAudio = item.mediaType === 'audio';
  const percent = progress?.percent ?? 0;
  const hasCompanion = !!item.companionPath;
  const theme = getThemeForTitle(item.title);

  const handleClick = () => {
    if (isAudio) {
      onPlayAudio(item);
    } else {
      onOpenBook(item);
    }
  };

  const hasValidCover = !!item.coverUrl && !imageFailed;

  return (
    <div
      onClick={handleClick}
      className="group relative flex flex-col cursor-pointer select-none transition-transform duration-300 ease-out"
    >
      {/* Physical 3D Book Container */}
      <div className="relative aspect-[1/1.45] w-full rounded-r-md rounded-l-xs overflow-hidden shadow-[0_8px_20px_-3px_rgba(0,0,0,0.6)] group-hover:shadow-[0_16px_36px_-4px_rgba(0,0,0,0.85)] group-hover:-translate-y-1.5 transition-all duration-300 ease-out bg-neutral-900">
        {/* Realistic Book Spine Shadow (Left edge indent) */}
        <div className="absolute top-0 bottom-0 left-0 w-3 bg-gradient-to-r from-black/50 via-black/15 to-transparent pointer-events-none z-20 rounded-l-xs" />

        {/* Realistic Book Page Edge Highlight (Right edge) */}
        <div className="absolute top-0 bottom-0 right-0 w-[1.5px] bg-white/20 pointer-events-none z-20" />

        {/* Real Cover Image */}
        {hasValidCover ? (
          <img
            src={item.coverUrl}
            alt={item.title}
            onError={() => setImageFailed(true)}
            className="w-full h-full object-cover select-none transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          /* Procedural Apple Books Classic Hardcover Jacket */
          <div
            className={`w-full h-full bg-gradient-to-br ${theme.gradient} p-3 flex flex-col justify-between border ${theme.border} relative`}
          >
            {/* Subtle linen/bookcloth overlay texture */}
            <div className="absolute inset-0 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:12px_12px] opacity-[0.03] pointer-events-none" />

            {/* Inner debossed foil frame */}
            <div
              className={`absolute inset-2 border ${theme.frameBorder} rounded pointer-events-none`}
            />

            {/* Top metadata on jacket */}
            <div className="z-10 flex items-center justify-between">
              <span className={`text-[9px] uppercase font-semibold tracking-wider ${theme.accentColor}`}>
                {item.format}
              </span>
              {isAudio ? (
                <Headphones className={`w-3 h-3 ${theme.accentColor}`} />
              ) : (
                <BookOpen className={`w-3 h-3 ${theme.accentColor}`} />
              )}
            </div>

            {/* Center Embossed Title & Author */}
            <div className="z-10 my-auto text-center px-2 py-3 space-y-1.5">
              <h4
                className={`text-[12px] font-serif font-bold leading-tight line-clamp-3 ${theme.titleColor} drop-shadow-sm`}
              >
                {item.title}
              </h4>
              <p
                className={`text-[10px] uppercase tracking-widest font-sans ${theme.accentColor} opacity-90 truncate`}
              >
                {item.author}
              </p>
            </div>

            {/* Bottom jacket mark */}
            <div className="z-10 flex justify-center">
              <div className={`w-4 h-0.5 rounded-full ${theme.accentColor} opacity-40`} />
            </div>
          </div>
        )}

        {/* Top Floating Badges (Format & Dual Companion) */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
          <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded bg-black/60 backdrop-blur-md text-white/90 border border-white/10 shadow-sm">
            {item.format}
          </span>

          {hasCompanion && (
            <span
              title="Companion edition available"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded bg-amber-500/80 backdrop-blur-md text-amber-950 font-semibold shadow-sm"
            >
              {isAudio ? <BookOpen className="w-2.5 h-2.5" /> : <Headphones className="w-2.5 h-2.5" />}
              <span>Dual</span>
            </span>
          )}
        </div>

        {/* Play Overlay for Audiobooks */}
        {isAudio && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            {isPlaying ? (
              <div className="flex items-end gap-1 p-2 rounded-full bg-black/70 backdrop-blur-md shadow-lg border border-amber-500/40">
                <span className="w-1 h-3 bg-amber-400 animate-pulse rounded-full" />
                <span className="w-1 h-5 bg-amber-400 animate-pulse delay-75 rounded-full" />
                <span className="w-1 h-2.5 bg-amber-400 animate-pulse delay-150 rounded-full" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 group-hover:scale-105 transition-all duration-200 shadow-xl">
                <Play className="w-4 h-4 ml-0.5 text-white fill-white" />
              </div>
            )}
          </div>
        )}

        {/* Bottom Reading / Audio Progress Bar */}
        {percent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60 backdrop-blur-xs z-20">
            <div
              className={`h-full rounded-r-full ${
                isAudio ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
              }`}
              style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
            />
          </div>
        )}
      </div>

      {/* Book Metadata Below Cover (Apple Books typography) */}
      <div className="mt-2.5 px-0.5 flex flex-col min-w-0">
        <h4
          className="text-[12px] font-semibold text-neutral-100 group-hover:text-amber-200 line-clamp-2 leading-snug transition-colors tracking-tight"
          title={item.title}
        >
          {item.title}
        </h4>
        <div className="flex items-center justify-between text-[11px] text-neutral-400 mt-0.5 font-normal">
          <span className="truncate pr-1 group-hover:text-neutral-300" title={item.author}>
            {item.author}
          </span>
          {percent > 0 && (
            <span className="text-[10px] font-medium tabular-nums text-neutral-400 shrink-0">
              {Math.round(percent)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
