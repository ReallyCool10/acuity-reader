import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import type { Bookmark as BookmarkType, MediaItem, ProgressItem } from '../types';
import {
  getPdfInfo,
  loadPdfDocument,
  renderPdfPage,
  type PdfChapter,
  type PdfDocumentInfo,
} from '../lib/pdf';
import type * as pdfjsLib from 'pdfjs-dist';
import { usePersistentState, useThrottledCallback } from '../hooks/usePersistentState';
import { useDismissable } from '../hooks/useDismissable';

interface PdfReaderViewProps {
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

export const PdfReaderView: React.FC<PdfReaderViewProps> = ({
  item,
  initialProgress,
  bookmarks = [],
  onClose,
  onProgressUpdate,
  onAddBookmark,
  onRemoveBookmark,
  onSwitchToAudio,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  const restoringRef = useRef(false);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfInfo, setPdfInfo] = useState<PdfDocumentInfo | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // 1-based current page index
  const [currentPage, setCurrentPage] = useState<number>(() => {
    if (initialProgress?.chapterIndex !== undefined && initialProgress.chapterIndex >= 0) {
      return initialProgress.chapterIndex + 1;
    }
    return 1;
  });

  const [scale, setScale] = useState<number>(1.2);
  const [isFitWidth, setIsFitWidth] = useState<boolean>(true);
  const [theme, setTheme] = usePersistentState<ReadingTheme>('acuity.reader.theme', 'dark');
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [navTab, setNavTab] = useState<'toc' | 'bookmarks'>('toc');

  useDismissable(tocRef, isTocOpen, () => setIsTocOpen(false));

  /* ------------------------------------------------------------ load document */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus('loading');
      try {
        let doc: pdfjsLib.PDFDocumentProxy;
        const bytes = await window.electronAPI?.readBytes(item.filePath);
        if (bytes && bytes.byteLength > 0) {
          doc = await loadPdfDocument(bytes);
        } else {
          // Fallback to streaming via custom acuity:// protocol
          const url = `acuity://media/${encodeURIComponent(item.filePath)}`;
          doc = await loadPdfDocument(url);
        }

        if (cancelled) {
          void doc.destroy();
          return;
        }

        const info = await getPdfInfo(doc);
        if (cancelled) {
          void doc.destroy();
          return;
        }

        setPdfDoc(doc);
        setPdfInfo(info);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load PDF document.');
        setStatus('error');
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (pdfDoc) {
        void pdfDoc.destroy();
      }
    };
  }, [item.filePath]);

  /* ------------------------------------------------------------ render page canvas */

  const renderSinglePage = useCallback(
    async (pageNumber: number, targetScale: number) => {
      if (!pdfDoc) return;
      const canvas = canvasRefs.current.get(pageNumber);
      if (!canvas) return;

      // Cancel any ongoing render task for this page
      const ongoing = renderTasksRef.current.get(pageNumber);
      if (ongoing) {
        try {
          ongoing.cancel();
        } catch {
          // Ignore cancelled tasks
        }
      }

      try {
        const page = await pdfDoc.getPage(pageNumber);
        const task = await renderPdfPage(page, canvas, targetScale);
        renderTasksRef.current.set(pageNumber, task);
        await task.promise;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err && err.name !== 'RenderingCancelledException') {
          // Ignored normal cancellations
        }
      }
    },
    [pdfDoc]
  );

  /* ------------------------------------------------------------ fit width calculation */

  const effectiveScale = useMemo(() => {
    if (!isFitWidth || !containerRef.current) return scale;
    const containerWidth = containerRef.current.clientWidth - 48; // padding
    if (containerWidth <= 0) return scale;
    // Standard PDF page width is around 595 - 612 pt
    const autoScale = Math.min(2.5, Math.max(0.6, containerWidth / 612));
    return Number(autoScale.toFixed(2));
  }, [isFitWidth, scale]);

  /* ------------------------------------------------------------ re-render on zoom/doc change */

  useEffect(() => {
    if (!pdfDoc || status !== 'ready') return;

    // Render visible pages
    const numPages = pdfDoc.numPages;
    for (let p = 1; p <= numPages; p++) {
      void renderSinglePage(p, effectiveScale);
    }
  }, [pdfDoc, status, effectiveScale, renderSinglePage]);

  /* ------------------------------------------------------------ initial position restoration */

  useEffect(() => {
    if (status !== 'ready' || !pdfDoc) return;

    const initialPage =
      initialProgress?.chapterIndex !== undefined && initialProgress.chapterIndex >= 0
        ? initialProgress.chapterIndex + 1
        : 1;
    const targetElement = pageRefs.current.get(initialPage);
    if (targetElement && containerRef.current) {
      restoringRef.current = true;
      targetElement.scrollIntoView?.({ behavior: 'auto', block: 'start' });
      setCurrentPage(initialPage);
      setTimeout(() => {
        restoringRef.current = false;
      }, 300);
    }
  }, [status, pdfDoc]);

  /* ------------------------------------------------------------ scroll tracking */

  const reportProgress = useThrottledCallback(
    (page: number, numPages: number, scrollY: number) => {
      const percent = numPages > 0 ? page / numPages : 0;
      onProgressUpdate(item.id, page - 1, percent, scrollY);
    },
    250
  );

  const handleScroll = useCallback(() => {
    if (restoringRef.current || !containerRef.current || !pdfDoc) return;

    const container = containerRef.current;
    const containerTop = container.getBoundingClientRect().top;
    const numPages = pdfDoc.numPages;

    let closestPage = currentPage;
    let minDistance = Infinity;

    for (let p = 1; p <= numPages; p++) {
      const el = pageRefs.current.get(p);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const distance = Math.abs(rect.top - containerTop);
      if (distance < minDistance) {
        minDistance = distance;
        closestPage = p;
      }
    }

    if (closestPage !== currentPage) {
      setCurrentPage(closestPage);
    }

    reportProgress(closestPage, numPages, container.scrollTop);
  }, [currentPage, pdfDoc, reportProgress]);

  /* ------------------------------------------------------------ page navigation */

  const scrollToPage = useCallback((pageNum: number) => {
    if (!pdfDoc) return;
    const clamped = Math.max(1, Math.min(pageNum, pdfDoc.numPages));
    setCurrentPage(clamped);
    const target = pageRefs.current.get(clamped);
    if (target) {
      target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [pdfDoc]);

  const goToNextPage = useCallback(() => {
    if (!pdfDoc) return;
    if (currentPage < pdfDoc.numPages) {
      scrollToPage(currentPage + 1);
    }
  }, [currentPage, pdfDoc, scrollToPage]);

  const goToPrevPage = useCallback(() => {
    if (currentPage > 1) {
      scrollToPage(currentPage - 1);
    }
  }, [currentPage, scrollToPage]);

  /* ------------------------------------------------------------ zoom handlers */

  const zoomIn = useCallback(() => {
    setIsFitWidth(false);
    setScale((prev) => Math.min(3.0, Number((prev + 0.2).toFixed(2))));
  }, []);

  const zoomOut = useCallback(() => {
    setIsFitWidth(false);
    setScale((prev) => Math.max(0.5, Number((prev - 0.2).toFixed(2))));
  }, []);

  const toggleFitWidth = useCallback(() => {
    setIsFitWidth((prev) => !prev);
  }, []);

  /* ------------------------------------------------------------ bookmarks */

  const handleAddBookmark = useCallback(() => {
    const excerpt = `Page ${currentPage} of ${pdfDoc?.numPages ?? 1}`;
    onAddBookmark(item.id, currentPage - 1, excerpt);
  }, [currentPage, pdfDoc, item.id, onAddBookmark]);

  /* ------------------------------------------------------------ keyboard shortcuts */

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPrevPage();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        toggleFitWidth();
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        handleAddBookmark();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goToNextPage, goToPrevPage, zoomIn, zoomOut, toggleFitWidth, handleAddBookmark]);

  /* ------------------------------------------------------------ theme style */

  const themeStyle = useMemo(() => {
    switch (theme) {
      case 'sepia':
        return {
          bg: '#fbf0d9',
          fg: '#433422',
          muted: '#87745d',
          pageFilter: 'sepia(0.28) contrast(0.95)',
        };
      case 'light':
        return {
          bg: '#f8fafc',
          fg: '#0f172a',
          muted: '#64748b',
          pageFilter: 'none',
        };
      case 'dark':
      default:
        return {
          bg: '#0f1218',
          fg: '#f1f5f9',
          muted: '#94a3b8',
          pageFilter: 'invert(0.88) hue-rotate(180deg) contrast(0.96)',
        };
    }
  }, [theme]);

  const totalPages = pdfDoc?.numPages ?? 0;

  return (
    <div
      className="relative flex h-full w-full flex-col select-none overflow-hidden"
      style={
        {
          backgroundColor: themeStyle.bg,
          color: themeStyle.fg,
          '--reader-bg': themeStyle.bg,
          '--reader-fg': themeStyle.fg,
          '--reader-muted': themeStyle.muted,
        } as React.CSSProperties
      }
    >
      {/* ---------------------------------------------------------- HEADER */}
      <header
        className="acu-drag relative z-40 flex h-12 flex-shrink-0 items-center justify-between border-b px-3 backdrop-blur-md"
        style={{
          borderColor: 'rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
        }}
      >
        <div className="acu-no-drag flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="icon-button"
            aria-label="Back to library (Esc)"
            title="Back to library (Esc)"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* Table of Contents & Bookmarks Toggle */}
          <div className="relative" ref={tocRef}>
            <button
              type="button"
              onClick={() => setIsTocOpen((prev) => !prev)}
              className={`icon-button ${isTocOpen ? 'active' : ''}`}
              aria-label="Document Outline and Bookmarks"
              title="Document Outline and Bookmarks"
            >
              <List className="h-4 w-4" />
              {bookmarks.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500/90 px-1 text-[9px] font-bold text-slate-950">
                  {bookmarks.length}
                </span>
              )}
            </button>

            {/* Outline / Bookmarks Popover Drawer */}
            {isTocOpen && (
              <div
                className="absolute left-0 top-full mt-2 w-72 rounded-[var(--radius-md)] border p-2 shadow-2xl backdrop-blur-xl z-50 max-h-[70vh] flex flex-col"
                style={{
                  backgroundColor: 'var(--surface-raised)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <div className="flex border-b pb-1.5 mb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <button
                    type="button"
                    onClick={() => setNavTab('toc')}
                    className={`flex-1 py-1 text-[11px] font-semibold rounded-[var(--radius-sm)] transition-colors ${
                      navTab === 'toc'
                        ? 'bg-[var(--surface-raised-hover)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    Outline ({pdfInfo?.outline.length ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavTab('bookmarks')}
                    className={`flex-1 py-1 text-[11px] font-semibold rounded-[var(--radius-sm)] transition-colors ${
                      navTab === 'bookmarks'
                        ? 'bg-[var(--surface-raised-hover)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    Bookmarks ({bookmarks.length})
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  {navTab === 'toc' ? (
                    pdfInfo?.outline && pdfInfo.outline.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {pdfInfo.outline.map((chap: PdfChapter) => (
                          <button
                            key={chap.id}
                            type="button"
                            onClick={() => {
                              scrollToPage(chap.pageNumber);
                              setIsTocOpen(false);
                            }}
                            className={`flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[11.5px] transition-colors ${
                              currentPage === chap.pageNumber
                                ? 'bg-[var(--accent)] font-semibold text-[var(--accent-fg)]'
                                : 'text-[var(--text-primary)] hover:bg-[var(--surface-raised-hover)]'
                            }`}
                          >
                            <span className="truncate pr-2">{chap.title}</span>
                            <span className="text-[10px] opacity-70">p. {chap.pageNumber}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-[11px] text-[var(--text-secondary)]">
                        No outline available for this document.
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {bookmarks.length === 0 ? (
                        <div className="py-6 text-center text-[11px] text-[var(--text-secondary)]">
                          No bookmarks saved yet. Press 'B' to bookmark.
                        </div>
                      ) : (
                        bookmarks.map((bm) => (
                          <div
                            key={bm.id}
                            className="group flex items-start justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-raised-hover)]"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                scrollToPage(bm.position + 1);
                                setIsTocOpen(false);
                              }}
                              className="flex flex-1 flex-col truncate"
                            >
                              <span className="text-[11.5px] font-semibold text-[var(--text-primary)]">
                                Page {bm.position + 1}
                              </span>
                              {bm.excerpt && (
                                <span className="mt-0.5 line-clamp-2 text-[10.5px] italic text-[var(--text-secondary)]">
                                  {bm.excerpt}
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
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Title */}
        <div className="pointer-events-none min-w-0 flex-1 px-2 text-center">
          <h1 className="truncate text-[12px] font-semibold" style={{ color: 'var(--reader-fg)' }}>
            {pdfInfo?.title || item.title}
          </h1>
          <p className="truncate text-[10.5px]" style={{ color: 'var(--reader-muted)' }}>
            {totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : item.author}
          </p>
        </div>

        {/* Right Controls */}
        <div
          className="acu-no-drag flex items-center gap-1.5"
          style={{
            paddingRight:
              'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) - env(titlebar-area-x, 0px))',
          }}
        >
          {/* Page controls */}
          <div className="flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-slate-800/40 p-0.5 border border-white/5">
            <button
              type="button"
              onClick={goToPrevPage}
              disabled={currentPage <= 1}
              className="icon-button disabled:opacity-30"
              aria-label="Previous page (Left arrow)"
              title="Previous page (Left arrow)"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 text-[11px] font-medium min-w-[50px] text-center text-slate-300">
              {currentPage} / {totalPages || 1}
            </span>
            <button
              type="button"
              onClick={goToNextPage}
              disabled={currentPage >= totalPages}
              className="icon-button disabled:opacity-30"
              aria-label="Next page (Right arrow)"
              title="Next page (Right arrow)"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-slate-800/40 p-0.5 border border-white/5">
            <button
              type="button"
              onClick={zoomOut}
              className="icon-button"
              aria-label="Zoom out (-)"
              title="Zoom out (-)"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleFitWidth}
              className={`px-1.5 py-0.5 text-[10.5px] font-medium rounded transition-colors ${
                isFitWidth ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
              title="Fit to window width (0)"
            >
              {isFitWidth ? 'Fit' : `${Math.round(effectiveScale * 100)}%`}
            </button>
            <button
              type="button"
              onClick={zoomIn}
              className="icon-button"
              aria-label="Zoom in (+)"
              title="Zoom in (+)"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Theme Switcher */}
          <div className="flex items-center gap-0.5 rounded-[var(--radius-sm)] bg-slate-800/40 p-0.5 border border-white/5">
            {THEMES.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                className={`icon-button ${theme === key ? 'active' : ''}`}
                aria-label={`${label} theme`}
                title={`${label} theme`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>

          {/* Bookmark Current Page */}
          <button
            type="button"
            onClick={handleAddBookmark}
            className="icon-button"
            aria-label="Bookmark this page (B)"
            title="Bookmark this page (B)"
          >
            <Bookmark className="h-3.5 w-3.5" />
          </button>

          {/* Companion Audiobook Switcher */}
          {item.companionPath && onSwitchToAudio && (
            <button
              type="button"
              onClick={() => onSwitchToAudio(item.companionPath!)}
              className="icon-button text-amber-400 hover:text-amber-300"
              aria-label="Switch to companion audiobook"
              title="Listen to companion audiobook"
            >
              <Headphones className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------- CONTENT BODY */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto overflow-x-auto px-4 py-6 scroll-smooth"
      >
        {status === 'loading' && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <p className="text-[12px]" style={{ color: 'var(--reader-muted)' }}>
              Opening PDF document...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-[13px] font-semibold text-red-400">Unable to render PDF</p>
            <p className="max-w-md text-[11px]" style={{ color: 'var(--reader-muted)' }}>
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-[var(--radius-sm)] bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:bg-slate-700"
            >
              Return to library
            </button>
          </div>
        )}

        {status === 'ready' && pdfDoc && (
          <div className="flex flex-col items-center gap-6 pb-20">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                ref={(el) => {
                  if (el) pageRefs.current.set(pageNum, el);
                  else pageRefs.current.delete(pageNum);
                }}
                className="relative rounded-sm shadow-xl transition-all duration-150"
                style={{
                  filter: themeStyle.pageFilter,
                  backgroundColor: '#ffffff',
                }}
              >
                <canvas
                  ref={(canvas) => {
                    if (canvas) canvasRefs.current.set(pageNum, canvas);
                    else canvasRefs.current.delete(pageNum);
                  }}
                  className="block rounded-sm"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
