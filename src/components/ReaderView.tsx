import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Coffee,
  FolderOpen,
  Headphones,
  List,
  Minus,
  Moon,
  Play,
  Plus,
  Square,
  Sun,
  Trash2,
  Type,
} from 'lucide-react';
import type { Bookmark as BookmarkType, MediaItem, ProgressItem } from '../types';
import { parseEpub, type EpubChapter } from '../lib/epub';
import { canRenderInReader } from '../lib/media';
import { formatReadingTime } from '../lib/format';
import { usePersistentState, useThrottledCallback } from '../hooks/usePersistentState';
import { useDismissable } from '../hooks/useDismissable';
import {
  buildNarrationMap,
  clearHighlight,
  highlightSentence,
  isHighlightSupported,
  type NarrationMap,
} from '../lib/narration';

interface ReaderViewProps {
  item: MediaItem;
  initialProgress?: ProgressItem;
  bookmarks?: BookmarkType[];
  onClose: () => void;
  onProgressUpdate: (itemId: string, chapterIndex: number, percent: number, scroll: number) => void;
  onAddBookmark: (itemId: string, chapterIndex: number, excerpt: string) => void;
  onRemoveBookmark?: (bookmarkId: string) => void;
  onSwitchToAudio?: (companionPath: string) => void;
}

type ReadingTheme = 'dark' | 'sepia' | 'light';

const THEMES: { key: ReadingTheme; label: string; icon: typeof Moon }[] = [
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'sepia', label: 'Sepia', icon: Coffee },
  { key: 'light', label: 'Light', icon: Sun },
];

export const ReaderView: React.FC<ReaderViewProps> = ({
  item,
  initialProgress,
  bookmarks = [],
  onClose,
  onProgressUpdate,
  onAddBookmark,
  onRemoveBookmark,
  onSwitchToAudio,
}) => {
  const scrollRef = useRef<HTMLElement | null>(null);
  const proseRef = useRef<HTMLDivElement | null>(null);
  const appearanceRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<HTMLDivElement | null>(null);
  const narrationMapRef = useRef<NarrationMap | null>(null);
  /** Set while restoring a saved position, to stop the scroll handler overwriting it. */
  const restoringRef = useRef(false);

  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [chapterIndex, setChapterIndex] = useState(initialProgress?.chapterIndex ?? 0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [isNarrating, setIsNarrating] = useState(false);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [navTab, setNavTab] = useState<'toc' | 'bookmarks'>('toc');

  const [fontSize, setFontSize] = usePersistentState('acuity.reader.fontSize', 18);
  const [lineHeight, setLineHeight] = usePersistentState('acuity.reader.lineHeight', 1.72);
  const [typeface, setTypeface] = usePersistentState<'serif' | 'sans'>('acuity.reader.typeface', 'serif');
  const [theme, setTheme] = usePersistentState<ReadingTheme>('acuity.reader.theme', 'dark');
  const [narrationRate, setNarrationRate] = usePersistentState('acuity.reader.narrationRate', 1);

  useDismissable(appearanceRef, isAppearanceOpen, () => setIsAppearanceOpen(false));
  useDismissable(tocRef, isTocOpen, () => setIsTocOpen(false));

  const currentChapter = chapters[chapterIndex];

  /* ------------------------------------------------------------ load book */

  useEffect(() => {
    let cancelled = false;
    let mintedUrls: string[] = [];

    async function load() {
      setStatus('loading');

      if (!canRenderInReader(item)) {
        setStatus('unsupported');
        return;
      }

      try {
        const bytes = await window.electronAPI?.readBytes(item.filePath);
        if (!bytes) throw new Error('The file could not be read from disk.');

        const book = await parseEpub(bytes);
        if (cancelled) {
          book.objectUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }

        mintedUrls = book.objectUrls;
        setChapters(book.chapters);
        setChapterIndex((prev) => Math.min(prev, book.chapters.length - 1));
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : 'This book could not be opened.');
        setStatus('error');
      }
    }

    void load();

    return () => {
      cancelled = true;
      // Blob URLs for embedded images leak for the lifetime of the window otherwise.
      mintedUrls.forEach((url) => URL.revokeObjectURL(url));
      window.speechSynthesis.cancel();
      clearHighlight();
    };
  }, [item]);

  /* ----------------------------------------------------------- progress */

  /** Cumulative word position, so percentage reflects length rather than chapter count. */
  const { wordOffsets, totalWords } = useMemo(() => {
    const offsets: number[] = [];
    let running = 0;
    for (const chapter of chapters) {
      offsets.push(running);
      running += chapter.words;
    }
    return { wordOffsets: offsets, totalWords: running };
  }, [chapters]);

  const percentFor = useCallback(
    (index: number, scrollRatio: number) => {
      if (totalWords === 0 || !chapters[index]) return 0;
      const within = chapters[index].words * Math.min(1, Math.max(0, scrollRatio));
      return Math.min(100, ((wordOffsets[index] + within) / totalWords) * 100);
    },
    [chapters, wordOffsets, totalWords]
  );

  const persistProgress = useThrottledCallback(
    (index: number, scrollTop: number, ratio: number) => {
      onProgressUpdate(item.id, index, percentFor(index, ratio), scrollTop);
    },
    1500
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || restoringRef.current || status !== 'ready') return;
    const scrollable = el.scrollHeight - el.clientHeight;
    const ratio = scrollable > 0 ? el.scrollTop / scrollable : 1;
    persistProgress(chapterIndex, el.scrollTop, ratio);
  }, [chapterIndex, persistProgress, status]);

  /*
   * Restore the saved scroll offset once the chapter has laid out.
   *
   * The saved position is captured into refs rather than read from props: it
   * only applies to the chapter the reader was last in, and keeping it out of
   * the dependency list stops a later progress save from re-triggering a scroll.
   */
  const savedChapterRef = useRef(initialProgress?.chapterIndex ?? -1);
  const savedScrollRef = useRef(initialProgress?.chapterScroll ?? 0);

  useEffect(() => {
    if (status !== 'ready') return;
    const el = scrollRef.current;
    if (!el) return;

    restoringRef.current = true;
    const target = chapterIndex === savedChapterRef.current ? savedScrollRef.current : 0;

    const frame = requestAnimationFrame(() => {
      el.scrollTop = target;
      restoringRef.current = false;
      // Consume the restore so returning to this chapter later starts at the top.
      savedChapterRef.current = -1;
    });
    return () => cancelAnimationFrame(frame);
  }, [chapterIndex, status]);

  /* ---------------------------------------------------------- narration */

  const stopNarration = useCallback(() => {
    window.speechSynthesis.cancel();
    clearHighlight();
    setIsNarrating(false);
  }, []);

  const startNarration = useCallback(() => {
    const container = proseRef.current;
    if (!container) return;

    const map = buildNarrationMap(container);
    if (!map.text.trim()) return;
    narrationMapRef.current = map;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(map.text);
    utterance.rate = narrationRate;

    utterance.onboundary = (event) => {
      const currentMap = narrationMapRef.current;
      if (!currentMap) return;
      const range = highlightSentence(currentMap, event.charIndex);
      // Keep the spoken sentence in view without yanking the page on every word.
      const rect = range?.getBoundingClientRect();
      const host = scrollRef.current;
      if (rect && host) {
        const hostRect = host.getBoundingClientRect();
        if (rect.bottom > hostRect.bottom - 80 || rect.top < hostRect.top + 40) {
          host.scrollBy({ top: rect.top - hostRect.top - hostRect.height / 3, behavior: 'smooth' });
        }
      }
    };

    utterance.onend = () => {
      clearHighlight();
      setIsNarrating(false);
    };
    utterance.onerror = () => {
      clearHighlight();
      setIsNarrating(false);
    };

    setIsNarrating(true);
    window.speechSynthesis.speak(utterance);
  }, [narrationRate]);

  const toggleNarration = useCallback(() => {
    if (isNarrating) stopNarration();
    else startNarration();
  }, [isNarrating, startNarration, stopNarration]);

  /* Narration is bound to one chapter's DOM; moving chapters must end it. */
  useEffect(() => {
    stopNarration();
  }, [chapterIndex, stopNarration]);

  /* ---------------------------------------------------------- navigation */

  const goToChapter = useCallback(
    (index: number) => {
      if (index < 0 || index >= chapters.length) return;
      setChapterIndex(index);
      setIsTocOpen(false);
      onProgressUpdate(item.id, index, percentFor(index, 0), 0);
    },
    [chapters.length, item.id, onProgressUpdate, percentFor]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.isContentEditable) return;

      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight' || event.key === 'PageDown') goToChapter(chapterIndex + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') goToChapter(chapterIndex - 1);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chapterIndex, goToChapter, onClose]);

  const progressPercent = Math.round(percentFor(chapterIndex, 0));

  /* -------------------------------------------------------------- render */

  return (
    <div
      className="reader-surface animate-reader-in fixed inset-0 z-50 flex flex-col"
      data-theme={theme}
    >
      <header
        className="acu-drag flex h-12 shrink-0 items-center justify-between gap-2 border-b px-2.5 backdrop-blur-xl"
        style={{ background: 'var(--reader-chrome)', borderColor: 'var(--reader-rule)' }}
      >
        <div className="acu-no-drag flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="group flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 hover:bg-black/10 dark:hover:bg-white/10"
            style={{ color: 'var(--reader-fg)' }}
            title="Back to library (Esc)"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 ease-[var(--ease-out)] group-hover:-translate-x-0.5" />
            <span>Library</span>
          </button>

          {chapters.length > 0 && (
            <div className="relative" ref={tocRef}>
              <button
                type="button"
                onClick={() => setIsTocOpen((open) => !open)}
                className="icon-button"
                style={{ color: 'var(--reader-muted)' }}
                aria-haspopup="menu"
                aria-expanded={isTocOpen}
                aria-label="Table of contents"
                title="Contents"
              >
                <List className="h-4 w-4" />
              </button>

              {isTocOpen && (
                <div
                  className="menu left-0 top-full mt-1.5 flex max-h-[65vh] w-80 flex-col overflow-hidden p-2"
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
                      Contents ({chapters.length})
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

                  <div className="flex-1 overflow-y-auto pr-1">
                    {navTab === 'toc' ? (
                      chapters.map((chapter, index) => (
                        <button
                          key={chapter.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={index === chapterIndex}
                          className="menu-item"
                          onClick={() => goToChapter(index)}
                        >
                          <span className="line-clamp-2 flex-1">{chapter.title}</span>
                          <span className="shrink-0 text-[10px] tabular-nums opacity-50">
                            {formatReadingTime(chapter.words)}
                          </span>
                        </button>
                      ))
                    ) : bookmarks.length === 0 ? (
                      <p className="py-8 text-center text-[11px] text-[var(--text-tertiary)]">
                        No bookmarks saved yet. Use the bookmark icon in the header to save passages.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {bookmarks.map((bm) => (
                          <div
                            key={bm.id}
                            className="group flex items-start justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--surface-raised-hover)]"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                goToChapter(bm.position);
                                setIsTocOpen(false);
                              }}
                              className="flex flex-1 flex-col truncate"
                            >
                              <span className="text-[11.5px] font-semibold text-[var(--text-primary)]">
                                {chapters[bm.position]?.title ?? `Chapter ${bm.position + 1}`}
                              </span>
                              {bm.excerpt && (
                                <span className="mt-0.5 line-clamp-2 text-[10.5px] italic text-[var(--text-secondary)]">
                                  "{bm.excerpt}"
                                </span>
                              )}
                              <span className="mt-1 text-[9.5px] text-[var(--text-tertiary)]">
                                {new Date(bm.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </button>
                            {onRemoveBookmark && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRemoveBookmark(bm.id);
                                }}
                                className="icon-button opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                                aria-label="Delete bookmark"
                                title="Delete bookmark"
                              >
                                <Trash2 className="h-3 w-3 text-red-400" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pointer-events-none min-w-0 flex-1 text-center">
          <h1 className="truncate text-[12px] font-semibold" style={{ color: 'var(--reader-fg)' }}>
            {item.title}
          </h1>
          <p className="truncate text-[10.5px]" style={{ color: 'var(--reader-muted)' }}>
            {currentChapter?.title ?? item.author}
          </p>
        </div>

        {/*
          Reserve the caption-button strip using the Window Controls Overlay
          variables, falling back to a fixed inset where they are unavailable.
        */}
        <div
          className="acu-no-drag flex items-center gap-1"
          style={{ paddingRight: 'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) - env(titlebar-area-x, 0px))' }}
        >
          {item.companionPath && onSwitchToAudio && (
            <button
              type="button"
              onClick={() => onSwitchToAudio(item.companionPath!)}
              className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--accent-ring)] bg-[var(--accent-muted)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors duration-150 hover:bg-[rgba(240,178,50,0.24)]"
              title="Switch to the audiobook edition"
            >
              <Headphones className="h-3 w-3" />
              <span>Listen</span>
            </button>
          )}

          {status === 'ready' && (
            <button
              type="button"
              onClick={toggleNarration}
              data-active={isNarrating}
              className="icon-button"
              style={isNarrating ? undefined : { color: 'var(--reader-muted)' }}
              aria-label={isNarrating ? 'Stop reading aloud' : 'Read aloud'}
              title={isNarrating ? 'Stop reading aloud' : 'Read aloud'}
            >
              {isNarrating ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
            </button>
          )}

          <div className="relative" ref={appearanceRef}>
            <button
              type="button"
              onClick={() => setIsAppearanceOpen((open) => !open)}
              className="icon-button"
              style={{ color: 'var(--reader-muted)' }}
              aria-haspopup="menu"
              aria-expanded={isAppearanceOpen}
              aria-label="Typography and theme"
              title="Appearance"
            >
              <Type className="h-4 w-4" />
            </button>

            {isAppearanceOpen && (
              <div
                className="menu right-0 top-full mt-1.5 w-64 space-y-3 p-3"
                style={{ '--menu-origin': 'top right' } as React.CSSProperties}
              >
                <Section label="Theme">
                  <div className="flex gap-1.5">
                    {THEMES.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTheme(key)}
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

                <Section label="Text size">
                  <Stepper
                    value={`${fontSize}px`}
                    onDecrease={() => setFontSize((s) => Math.max(13, s - 1))}
                    onIncrease={() => setFontSize((s) => Math.min(30, s + 1))}
                    decreaseLabel="Smaller text"
                    increaseLabel="Larger text"
                  />
                </Section>

                <Section label="Line spacing">
                  <Stepper
                    value={lineHeight.toFixed(2)}
                    onDecrease={() => setLineHeight((v) => Math.max(1.3, Number((v - 0.08).toFixed(2))))}
                    onIncrease={() => setLineHeight((v) => Math.min(2.2, Number((v + 0.08).toFixed(2))))}
                    decreaseLabel="Tighter line spacing"
                    increaseLabel="Looser line spacing"
                  />
                </Section>

                <Section label="Typeface">
                  <div className="flex gap-1.5">
                    {(['serif', 'sans'] as const).map((face) => (
                      <button
                        key={face}
                        type="button"
                        onClick={() => setTypeface(face)}
                        aria-pressed={typeface === face}
                        className={`flex-1 rounded-[var(--radius-sm)] border py-1.5 text-[12px] capitalize transition-colors duration-150 ${
                          face === 'serif' ? 'font-serif' : 'font-sans'
                        } ${
                          typeface === face
                            ? 'border-[var(--accent-ring)] bg-[var(--accent-muted)] text-[var(--accent)]'
                            : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-raised-hover)]'
                        }`}
                      >
                        {face}
                      </button>
                    ))}
                  </div>
                </Section>

                <Section label="Narration speed">
                  <Stepper
                    value={`${narrationRate.toFixed(2)}×`}
                    onDecrease={() => setNarrationRate((v) => Math.max(0.5, Number((v - 0.25).toFixed(2))))}
                    onIncrease={() => setNarrationRate((v) => Math.min(2.5, Number((v + 0.25).toFixed(2))))}
                    decreaseLabel="Slower narration"
                    increaseLabel="Faster narration"
                  />
                </Section>

                {!isHighlightSupported() && (
                  <p className="text-[10px] leading-snug text-[var(--text-tertiary)]">
                    Sentence highlighting is unavailable in this runtime; narration still works.
                  </p>
                )}
              </div>
            )}
          </div>

          {status === 'ready' && (
            <button
              type="button"
              onClick={() =>
                onAddBookmark(item.id, chapterIndex, currentChapter?.text.slice(0, 140) ?? '')
              }
              className="icon-button"
              style={{
                color: bookmarks.some((b) => b.position === chapterIndex)
                  ? 'var(--accent)'
                  : 'var(--reader-muted)',
              }}
              aria-label="Bookmark this chapter"
              title={
                bookmarks.some((b) => b.position === chapterIndex)
                  ? 'Chapter bookmarked (click to add another)'
                  : 'Bookmark this chapter'
              }
            >
              <Bookmark
                className={`h-4 w-4 ${
                  bookmarks.some((b) => b.position === chapterIndex) ? 'fill-current' : ''
                }`}
              />
            </button>
          )}
        </div>
      </header>

      <main
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 select-text overflow-y-auto px-6 py-10"
        style={{ scrollbarGutter: 'stable both-edges' }}
      >
        {status === 'loading' && <ReaderSkeleton title={item.title} />}

        {status === 'unsupported' && (
          <ReaderNotice
            title={`${item.format.toUpperCase()} files aren't supported yet`}
            body="Acuity's reader currently renders EPUB. This title is in your library and its progress is tracked, but it needs to be opened in another application for now."
            action={{
              label: 'Show in folder',
              onClick: () => void window.electronAPI?.revealInFolder(item.filePath),
            }}
          />
        )}

        {status === 'error' && (
          <ReaderNotice
            title="This book couldn't be opened"
            body={errorMessage}
            action={{
              label: 'Show in folder',
              onClick: () => void window.electronAPI?.revealInFolder(item.filePath),
            }}
          />
        )}

        {status === 'ready' && currentChapter && (
          <article
            key={currentChapter.id}
            className="reader-prose animate-fade-rise"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight,
              fontFamily:
                typeface === 'serif'
                  ? "Newsreader, 'Playfair Display', Georgia, serif"
                  : "'Segoe UI Variable Text', -apple-system, system-ui, sans-serif",
            }}
          >
            <header className="mb-8 border-b pb-4" style={{ borderColor: 'var(--reader-rule)' }}>
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.15em]"
                style={{ color: 'var(--reader-muted)' }}
              >
                Chapter {chapterIndex + 1} of {chapters.length}
                {currentChapter.words > 0 && ` · ${formatReadingTime(currentChapter.words)}`}
              </p>
              <h2 className="mt-1.5 text-[1.5em] font-semibold leading-tight">
                {currentChapter.title}
              </h2>
            </header>

            {/*
              Chapter markup is sanitised in parseEpub: scripts, styles, remote
              resources and inline event handlers are stripped, and images are
              rewritten to blob URLs from inside the archive.
            */}
            <div
              ref={proseRef}
              data-dropcap={chapterIndex === 0}
              dangerouslySetInnerHTML={{ __html: currentChapter.html }}
            />
          </article>
        )}
      </main>

      {status === 'ready' && chapters.length > 0 && (
        <footer
          className="flex h-11 shrink-0 items-center justify-between gap-3 border-t px-3 backdrop-blur-xl"
          style={{ background: 'var(--reader-chrome)', borderColor: 'var(--reader-rule)' }}
        >
          <button
            type="button"
            onClick={() => goToChapter(chapterIndex - 1)}
            disabled={chapterIndex === 0}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] transition-opacity duration-150 disabled:opacity-30"
            style={{ color: 'var(--reader-muted)' }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>

          <div className="flex flex-1 items-center gap-2">
            <div
              className="h-[3px] flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--reader-rule)' }}
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-[var(--ease-out)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span
              className="w-9 shrink-0 text-right text-[10.5px] tabular-nums"
              style={{ color: 'var(--reader-muted)' }}
            >
              {progressPercent}%
            </span>
          </div>

          <button
            type="button"
            onClick={() => goToChapter(chapterIndex + 1)}
            disabled={chapterIndex >= chapters.length - 1}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] transition-opacity duration-150 disabled:opacity-30"
            style={{ color: 'var(--reader-muted)' }}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </footer>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- subviews */

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]">
      {label}
    </span>
    {children}
  </div>
);

const Stepper: React.FC<{
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
}> = ({ value, onDecrease, onIncrease, decreaseLabel, increaseLabel }) => (
  <div className="flex items-center justify-between gap-2">
    <button type="button" onClick={onDecrease} className="icon-button h-7 w-7" aria-label={decreaseLabel}>
      <Minus className="h-3 w-3" />
    </button>
    <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">{value}</span>
    <button type="button" onClick={onIncrease} className="icon-button h-7 w-7" aria-label={increaseLabel}>
      <Plus className="h-3 w-3" />
    </button>
  </div>
);

/** Skeleton shaped like a page of prose, so the swap to real text is not jarring. */
const ReaderSkeleton: React.FC<{ title: string }> = ({ title }) => (
  <div className="reader-prose" aria-busy="true" aria-label={`Opening ${title}`}>
    <div className="skeleton mb-8 h-6 w-2/3" />
    {[...Array(9)].map((_, row) => (
      <div key={row} className="mb-3 space-y-2">
        <div className="skeleton h-3.5 w-full" />
        <div className="skeleton h-3.5 w-[96%]" />
        <div className="skeleton h-3.5" style={{ width: `${62 + ((row * 7) % 30)}%` }} />
      </div>
    ))}
  </div>
);

const ReaderNotice: React.FC<{
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}> = ({ title, body, action }) => (
  <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-20 text-center">
    <div
      className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-xl)] border"
      style={{ borderColor: 'var(--reader-rule)' }}
    >
      <FolderOpen className="h-5 w-5" style={{ color: 'var(--reader-muted)' }} />
    </div>
    <h2 className="text-[14px] font-semibold">{title}</h2>
    <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--reader-muted)' }}>
      {body}
    </p>
    {action && (
      <button
        type="button"
        onClick={action.onClick}
        className="mt-1 rounded-[var(--radius-md)] border border-[var(--stroke-default)] px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 hover:bg-[var(--surface-raised-hover)]"
      >
        {action.label}
      </button>
    )}
  </div>
);
