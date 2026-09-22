import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Headphones,
  List,
  Minus,
  Moon,
  Plus,
  Sun,
  Trash2,
  Type,
} from 'lucide-react';
import type { Bookmark as BookmarkType } from '../types';
import { useDismissable } from '../hooks/useDismissable';

export type ReadingTheme = 'dark' | 'sepia' | 'light';

export const THEMES: { key: ReadingTheme; label: string; icon: typeof Moon }[] = [
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'sepia', label: 'Sepia', icon: Coffee },
  { key: 'light', label: 'Light', icon: Sun },
];

export interface TocEntry {
  id: string | number;
  title: string;
  subtitle?: string;
  active?: boolean;
}

export interface ReaderShellProps {
  title: string;
  subtitle?: string;
  theme: ReadingTheme;
  onThemeChange: (theme: ReadingTheme) => void;
  onClose: () => void;

  // Companion audiobook
  companionPath?: string;
  onSwitchToAudio?: (path: string) => void;

  // Header action slot (e.g. Read Aloud Play/Square button)
  headerActionSlot?: React.ReactNode;

  // Appearance popover custom controls slot (e.g. text size, zoom, font)
  appearanceSlot?: React.ReactNode;

  // Table of Contents / Outline & Bookmarks
  tocEntries?: TocEntry[];
  onSelectTocEntry?: (entry: TocEntry) => void;
  bookmarks?: BookmarkType[];
  onSelectBookmark?: (bookmark: BookmarkType) => void;
  onRemoveBookmark?: (bookmarkId: string) => void;
  onToggleBookmark?: () => void;
  isCurrentLocationBookmarked?: boolean;
  bookmarkLabel?: string;

  // Footer / Navigation
  showFooter?: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel?: string;
  progressPercent: number;
  progressLabel?: string;

  // Main scrollable content
  children: React.ReactNode;
}

export const ReaderShell: React.FC<ReaderShellProps> = ({
  title,
  subtitle,
  theme,
  onThemeChange,
  onClose,
  companionPath,
  onSwitchToAudio,
  headerActionSlot,
  appearanceSlot,
  tocEntries = [],
  onSelectTocEntry,
  bookmarks = [],
  onSelectBookmark,
  onRemoveBookmark,
  onToggleBookmark,
  isCurrentLocationBookmarked = false,
  bookmarkLabel = 'Bookmark this location (B)',
  showFooter = true,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  prevLabel = 'Previous',
  nextLabel = 'Next',
  progressPercent,
  progressLabel,
  children,
}) => {
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [navTab, setNavTab] = useState<'toc' | 'bookmarks'>('toc');

  const tocRef = useRef<HTMLDivElement | null>(null);
  const appearanceRef = useRef<HTMLDivElement | null>(null);

  useDismissable(tocRef, isTocOpen, () => setIsTocOpen(false));
  useDismissable(appearanceRef, isAppearanceOpen, () => setIsAppearanceOpen(false));

  const clampedProgress = Math.max(0, Math.min(100, Math.round(progressPercent)));
  const displayProgressLabel = progressLabel ?? `${clampedProgress}%`;

  return (
    <div
      className="reader-surface animate-reader-in fixed inset-0 z-50 flex flex-col"
      data-theme={theme}
    >
      {/* ------------------------------------------------------------ HEADER */}
      <header
        className="acu-drag relative z-40 flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2.5 backdrop-blur-xl"
        style={{ background: 'var(--reader-chrome)', borderColor: 'var(--reader-rule)' }}
      >
        {/* Left Cluster */}
        <div className="acu-no-drag flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="group flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: 'var(--reader-fg)' }}
            aria-label="Back to library (Esc)"
            title="Back to library (Esc)"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 ease-[var(--ease-out)] group-hover:-translate-x-0.5" />
            <span>Library</span>
          </button>

          {(tocEntries.length > 0 || bookmarks.length > 0) && (
            <div className="relative" ref={tocRef}>
              <button
                type="button"
                onClick={() => setIsTocOpen((open) => !open)}
                className={`icon-button ${isTocOpen ? 'active' : ''}`}
                style={{ color: isTocOpen ? 'var(--accent)' : 'var(--reader-muted)' }}
                aria-haspopup="menu"
                aria-expanded={isTocOpen}
                aria-label="Table of contents"
                title="Contents and Bookmarks"
              >
                <List className="h-4 w-4" />
                {bookmarks.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[8.5px] font-bold text-slate-950">
                    {bookmarks.length}
                  </span>
                )}
              </button>

              {isTocOpen && (
                <div
                  className="menu left-0 top-full mt-1.5 flex max-h-[65vh] w-80 flex-col overflow-hidden p-2 z-50 shadow-2xl"
                  style={{ '--menu-origin': 'top left' } as React.CSSProperties}
                  role="dialog"
                  aria-label="Contents and Bookmarks"
                >
                  <div className="mb-2 flex rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setNavTab('toc')}
                      className={`flex-1 rounded-[var(--radius-xs)] py-1 text-[11px] font-medium transition-colors ${
                        navTab === 'toc'
                          ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      Contents ({tocEntries.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setNavTab('bookmarks')}
                      className={`flex-1 rounded-[var(--radius-xs)] py-1 text-[11px] font-medium transition-colors ${
                        navTab === 'bookmarks'
                          ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      Bookmarks ({bookmarks.length})
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {navTab === 'toc' ? (
                      <div className="space-y-0.5">
                        {tocEntries.length === 0 ? (
                          <p className="px-2 py-4 text-center text-[11px] text-[var(--text-tertiary)]">
                            No outline entries available
                          </p>
                        ) : (
                          tocEntries.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => {
                                onSelectTocEntry?.(entry);
                                setIsTocOpen(false);
                              }}
                              className={`menu-item text-left w-full justify-between ${
                                entry.active ? 'text-[var(--accent)] font-semibold' : ''
                              }`}
                            >
                              <span className="truncate">{entry.title}</span>
                              {entry.subtitle && (
                                <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums shrink-0 ml-2">
                                  {entry.subtitle}
                                </span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {bookmarks.length === 0 ? (
                          <p className="px-2 py-4 text-center text-[11px] text-[var(--text-tertiary)]">
                            No bookmarks yet. Press B to bookmark the current position.
                          </p>
                        ) : (
                          bookmarks.map((b) => (
                            <div
                              key={b.id}
                              className="group flex items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[var(--surface-raised-hover)]"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectBookmark?.(b);
                                  setIsTocOpen(false);
                                }}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="truncate text-[11.5px] font-medium text-[var(--text-primary)]">
                                  {b.label || 'Bookmark'}
                                </p>
                                {b.excerpt && (
                                  <p className="line-clamp-2 text-[10.5px] text-[var(--text-tertiary)]">
                                    {b.excerpt}
                                  </p>
                                )}
                              </button>
                              {onRemoveBookmark && (
                                <button
                                  type="button"
                                  onClick={() => onRemoveBookmark(b.id)}
                                  className="icon-button h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                                  title="Remove bookmark"
                                  aria-label="Remove bookmark"
                                >
                                  <Trash2 className="h-3 w-3 text-[var(--text-tertiary)] hover:text-red-400" />
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Center Title and Subtitle */}
        <div className="pointer-events-none min-w-0 flex-1 px-2 text-center">
          <h1 className="truncate text-[12px] font-semibold" style={{ color: 'var(--reader-fg)' }}>
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-[10.5px]" style={{ color: 'var(--reader-muted)' }}>
              {subtitle}
            </p>
          )}
        </div>

        {/* Right Cluster */}
        <div
          className="acu-no-drag flex items-center gap-1"
          style={{
            paddingRight:
              'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) - env(titlebar-area-x, 0px))',
          }}
        >
          {companionPath && onSwitchToAudio && (
            <button
              type="button"
              onClick={() => onSwitchToAudio(companionPath)}
              className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--accent-ring)] bg-[var(--accent-muted)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors duration-150 hover:bg-[rgba(240,178,50,0.24)]"
              title="Switch to companion audiobook"
              aria-label="Switch to companion audiobook"
            >
              <Headphones className="h-3 w-3" />
              <span>Listen</span>
            </button>
          )}

          {headerActionSlot}

          {/* Appearance / Theme Drawer */}
          <div className="relative" ref={appearanceRef}>
            <button
              type="button"
              onClick={() => setIsAppearanceOpen((open) => !open)}
              className={`icon-button ${isAppearanceOpen ? 'active' : ''}`}
              style={{ color: isAppearanceOpen ? 'var(--accent)' : 'var(--reader-muted)' }}
              aria-haspopup="menu"
              aria-expanded={isAppearanceOpen}
              aria-label="Appearance"
              title="Appearance"
            >
              <Type className="h-4 w-4" />
            </button>

            {isAppearanceOpen && (
              <div
                className="menu right-0 top-full mt-1.5 w-64 space-y-3 p-3 z-50 shadow-2xl"
                style={{ '--menu-origin': 'top right' } as React.CSSProperties}
              >
                <Section label="Theme">
                  <div className="flex gap-1.5">
                    {THEMES.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onThemeChange(key)}
                        aria-pressed={theme === key}
                        className={`flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-sm)] border py-1.5 text-[11px] transition-colors duration-150 ${
                          theme === key
                            ? 'border-[var(--accent-ring)] bg-[var(--accent-muted)] text-[var(--accent)]'
                            : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-raised-hover)]'
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                      </button>
                    ))}
                  </div>
                </Section>

                {appearanceSlot}
              </div>
            )}
          </div>

          {onToggleBookmark && (
            <button
              type="button"
              onClick={onToggleBookmark}
              className="icon-button"
              style={{
                color: isCurrentLocationBookmarked ? 'var(--accent)' : 'var(--reader-muted)',
              }}
              aria-label={bookmarkLabel}
              title={
                isCurrentLocationBookmarked
                  ? 'Bookmarked (click to add another)'
                  : bookmarkLabel
              }
            >
              <Bookmark
                className={`h-4 w-4 ${isCurrentLocationBookmarked ? 'fill-current' : ''}`}
              />
            </button>
          )}
        </div>
      </header>

      {/* -------------------------------------------------------- CONTENT */}
      {children}

      {/* ------------------------------------------------------------ FOOTER */}
      {showFooter && (
        <footer
          className="flex h-11 shrink-0 items-center justify-between gap-3 border-t px-3 backdrop-blur-xl"
          style={{ background: 'var(--reader-chrome)', borderColor: 'var(--reader-rule)' }}
        >
          <button
            type="button"
            onClick={onPrev}
            disabled={!canGoPrev}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] transition-opacity duration-150 disabled:opacity-30"
            style={{ color: 'var(--reader-muted)' }}
            aria-label={`${prevLabel} (Left arrow)`}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {prevLabel}
          </button>

          <div className="flex flex-1 items-center gap-2">
            <div
              className="h-[3px] flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--reader-rule)' }}
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-[var(--ease-out)]"
                style={{ width: `${clampedProgress}%` }}
              />
            </div>
            <span
              className="min-w-[40px] shrink-0 text-right text-[10.5px] tabular-nums"
              style={{ color: 'var(--reader-muted)' }}
            >
              {displayProgressLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={onNext}
            disabled={!canGoNext}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] transition-opacity duration-150 disabled:opacity-30"
            style={{ color: 'var(--reader-muted)' }}
            aria-label={`${nextLabel} (Right arrow)`}
          >
            {nextLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </footer>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- reusable controls */

export const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]">
      {label}
    </span>
    {children}
  </div>
);

export const Stepper: React.FC<{
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
}> = ({ value, onDecrease, onIncrease, decreaseLabel, increaseLabel, decreaseDisabled, increaseDisabled }) => (
  <div className="flex items-center justify-between gap-2">
    <button
      type="button"
      onClick={onDecrease}
      disabled={decreaseDisabled}
      className="icon-button h-7 w-7 disabled:opacity-30"
      aria-label={decreaseLabel}
    >
      <Minus className="h-3 w-3" />
    </button>
    <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">{value}</span>
    <button
      type="button"
      onClick={onIncrease}
      disabled={increaseDisabled}
      className="icon-button h-7 w-7 disabled:opacity-30"
      aria-label={increaseLabel}
    >
      <Plus className="h-3 w-3" />
    </button>
  </div>
);
