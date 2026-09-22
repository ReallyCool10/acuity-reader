import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bookmark as BookmarkType, MediaItem, ProgressItem } from '../types';
import {
  extractPdfPageText,
  getPdfInfo,
  loadPdfDocument,
  renderPdfPage,
  type PdfDocumentInfo,
} from '../lib/pdf';
import type * as pdfjsLib from 'pdfjs-dist';
import { searchInText, type SearchResultItem } from '../lib/search';
import { usePersistentState, useThrottledCallback } from '../hooks/usePersistentState';
import { ReaderShell, Section, Stepper, type ReadingTheme } from './ReaderShell';

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
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  const restoringRef = useRef(false);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());

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
          pageFilter: 'sepia(0.28) contrast(0.95)',
        };
      case 'light':
        return {
          pageFilter: 'none',
        };
      case 'dark':
      default:
        return {
          pageFilter: 'invert(0.88) hue-rotate(180deg) contrast(0.96)',
        };
    }
  }, [theme]);

  const totalPages = pdfDoc?.numPages ?? 0;
  const progressPercent = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
  const progressLabel = totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : undefined;

  const tocEntries = useMemo(() => {
    return (
      pdfInfo?.outline.map((chap) => ({
        id: chap.id,
        title: chap.title,
        subtitle: `p. ${chap.pageNumber}`,
        active: chap.pageNumber === currentPage,
      })) ?? []
    );
  }, [pdfInfo?.outline, currentPage]);

  const handleSearch = useCallback(
    async (query: string): Promise<SearchResultItem[]> => {
      if (!query.trim() || !pdfDoc || !pdfInfo) return [];

      const results: SearchResultItem[] = [];
      const numPages = pdfInfo.numPages;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        let text = pageTextCacheRef.current.get(pageNum);
        if (text === undefined) {
          try {
            const page = await pdfDoc.getPage(pageNum);
            text = await extractPdfPageText(page);
            pageTextCacheRef.current.set(pageNum, text);
          } catch {
            text = '';
          }
        }

        if (text) {
          const pageResults = searchInText(text, query, pageNum, `Page ${pageNum}`);
          results.push(...pageResults);
          if (results.length >= 150) break;
        }
      }

      return results;
    },
    [pdfDoc, pdfInfo]
  );

  const handleSelectSearchResult = useCallback(
    (result: SearchResultItem) => {
      scrollToPage(result.locationIndex);
    },
    [scrollToPage]
  );

  return (
    <ReaderShell
      title={pdfInfo?.title || item.title}
      subtitle={totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : item.author}
      theme={theme}
      onThemeChange={setTheme}
      onClose={onClose}
      companionPath={item.companionPath}
      onSwitchToAudio={onSwitchToAudio}
      onSearch={handleSearch}
      onSelectSearchResult={handleSelectSearchResult}
      appearanceSlot={
        <>
          <Section label="Page Zoom">
            <Stepper
              value={isFitWidth ? 'Fit' : `${Math.round(effectiveScale * 100)}%`}
              onDecrease={zoomOut}
              onIncrease={zoomIn}
              decreaseLabel="Zoom out (-)"
              increaseLabel="Zoom in (+)"
            />
          </Section>
          <Section label="Presets">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={toggleFitWidth}
                className={`flex-1 rounded-[var(--radius-sm)] border py-1.5 text-[11px] font-medium transition-colors ${
                  isFitWidth
                    ? 'border-[var(--accent-ring)] bg-[var(--accent-muted)] text-[var(--accent)] font-semibold'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-raised-hover)]'
                }`}
              >
                Fit Width
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsFitWidth(false);
                  setScale(1.0);
                }}
                className={`flex-1 rounded-[var(--radius-sm)] border py-1.5 text-[11px] font-medium transition-colors ${
                  !isFitWidth && Math.abs(scale - 1.0) < 0.05
                    ? 'border-[var(--accent-ring)] bg-[var(--accent-muted)] text-[var(--accent)] font-semibold'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-raised-hover)]'
                }`}
              >
                100%
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsFitWidth(false);
                  setScale(1.5);
                }}
                className={`flex-1 rounded-[var(--radius-sm)] border py-1.5 text-[11px] font-medium transition-colors ${
                  !isFitWidth && Math.abs(scale - 1.5) < 0.05
                    ? 'border-[var(--accent-ring)] bg-[var(--accent-muted)] text-[var(--accent)] font-semibold'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-raised-hover)]'
                }`}
              >
                150%
              </button>
            </div>
          </Section>
        </>
      }
      tocEntries={tocEntries}
      onSelectTocEntry={(entry) => {
        const chap = pdfInfo?.outline.find((c) => c.id === entry.id);
        if (chap) scrollToPage(chap.pageNumber);
      }}
      bookmarks={bookmarks}
      onSelectBookmark={(bm) => scrollToPage(bm.position + 1)}
      onRemoveBookmark={onRemoveBookmark}
      onToggleBookmark={handleAddBookmark}
      isCurrentLocationBookmarked={bookmarks.some((b) => b.position === currentPage - 1)}
      bookmarkLabel="Bookmark this page (B)"
      showFooter={status === 'ready' && totalPages > 0}
      canGoPrev={currentPage > 1}
      canGoNext={currentPage < totalPages}
      onPrev={goToPrevPage}
      onNext={goToNextPage}
      prevLabel="Previous page"
      nextLabel="Next page"
      progressPercent={progressPercent}
      progressLabel={progressLabel}
    >
      <main
        ref={containerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto overflow-x-auto px-4 py-6 scroll-smooth"
        style={{ scrollbarGutter: 'stable both-edges' }}
      >
        {status === 'loading' && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <span className="text-[12px]" style={{ color: 'var(--reader-muted)' }}>
              Rendering PDF pages…
            </span>
          </div>
        )}

        {status === 'error' && (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-20 text-center">
            <h2 className="text-[14px] font-semibold">Could not open PDF</h2>
            <p className="max-w-md text-[11px]" style={{ color: 'var(--reader-muted)' }}>
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-[var(--radius-sm)] border border-[var(--stroke-default)] px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--surface-raised-hover)]"
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
      </main>
    </ReaderShell>
  );
};
