import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, RotateCcw } from 'lucide-react';
import type { Bookmark as BookmarkType, MediaItem, ProgressItem, EdgeVoice } from '../types';
import {
  extractPdfPageText,
  getPdfInfo,
  loadPdfDocument,
  renderPdfPage,
  type PdfDocumentInfo,
} from '../lib/pdf';
import type * as pdfjsLib from 'pdfjs-dist';
import { searchInText, type SearchResultItem } from '../lib/search';
import { FALLBACK_VOICE_CHOICES } from '../lib/narration';
import { NarrationEngine, type NarrationSource } from '../lib/narrationEngine';
import {
  LOCAL_VOICE_ID,
  LOCAL_VOICE_LABEL,
  TTS_PRIVACY_NOTICE,
  VOICE_GROUP_LOCAL,
  VOICE_GROUP_ONLINE,
} from '../lib/tts';
import { cleanTitleString } from '../lib/metadata';
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
  onMetadataUpdate?: (itemId: string, metadata: { title?: string; author?: string }) => void;
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
  onMetadataUpdate,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  const restoringRef = useRef(false);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const onMetadataUpdateRef = useRef(onMetadataUpdate);
  const itemRef = useRef(item);
  useEffect(() => {
    onMetadataUpdateRef.current = onMetadataUpdate;
    itemRef.current = item;
  });

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

  const [isNarrating, setIsNarrating] = useState(false);
  const [narratingPage, setNarratingPage] = useState<number | null>(null);
  const [narrationRate, setNarrationRate] = usePersistentState('acuity.reader.narrationRate', 1);
  const [ttsVoice, setTtsVoice] = usePersistentState<string>('acuity.reader.ttsVoice', 'en-US-JennyNeural');
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);

  const narratingPageRef = useRef<number>(1);
  const engineRef = useRef<NarrationEngine | null>(null);

  useEffect(() => {
    if (window.electronAPI?.getEdgeVoices) {
      window.electronAPI
        .getEdgeVoices()
        .then((voices) => {
          if (voices && voices.length > 0) {
            setEdgeVoices(voices);
          }
        })
        .catch((err) => {
          console.warn('Failed to load Edge voices:', err);
        });
    }
  }, []);

  /* ------------------------------------------------------------ load document */

  useEffect(() => {
    let cancelled = false;
    /*
     * The created document is held locally so cleanup can destroy the one this
     * effect actually opened. Reading the pdfDoc state in cleanup captured null:
     * the cleanup closes over the render in which the effect ran, which is always
     * the render before setPdfDoc lands, so no document was ever released and the
     * pdf.js worker and page buffers leaked on every file change.
     */
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;

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

        const currentItem = itemRef.current;
        const cleanPdfTitle = info.title ? cleanTitleString(info.title) : undefined;
        if (cleanPdfTitle && cleanPdfTitle !== currentItem.title) {
          onMetadataUpdateRef.current?.(currentItem.id, {
            title: cleanPdfTitle,
            author: info.author || currentItem.author,
          });
        }

        loaded = doc;
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
      if (loaded) {
        void loaded.destroy();
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

  /*
   * Track the viewport width rather than reading the ref while rendering.
   *
   * Measuring containerRef.current inside the memo could not work: it is null on
   * the first render, and a ref is not reactive, so the memo had no way to re-run
   * when the element resized. Fit-width therefore never responded to the window
   * being resized - which this app does constantly, being a dockable side panel.
   * ResizeObserver fires once on observe, so the initial width arrives too.
   */
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') setContainerWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [status]);

  const effectiveScale = useMemo(() => {
    if (!isFitWidth) return scale;
    const usableWidth = containerWidth - 48; // horizontal padding
    if (usableWidth <= 0) return scale;
    // A standard PDF page is roughly 595-612pt wide.
    const autoScale = Math.min(2.5, Math.max(0.6, usableWidth / 612));
    return Number(autoScale.toFixed(2));
  }, [isFitWidth, scale, containerWidth]);

  /* ------------------------------------------------------------ virtual windowing geometry */

  const RENDER_BUFFER = 2; // Render current page ± 2 pages to conserve memory
  const [pageAspect, setPageAspect] = useState<number>(1.414);

  useEffect(() => {
    if (!pdfDoc) return;
    pdfDoc
      .getPage(1)
      .then((p1) => {
        const vp = p1.getViewport({ scale: 1 });
        if (vp.width > 0 && vp.height > 0) {
          setPageAspect(vp.height / vp.width);
        }
      })
      .catch(() => {});
  }, [pdfDoc]);

  const estimatedPageWidth = useMemo(() => {
    return Math.floor(612 * effectiveScale);
  }, [effectiveScale]);

  const estimatedPageHeight = useMemo(() => {
    return Math.floor(estimatedPageWidth * pageAspect);
  }, [estimatedPageWidth, pageAspect]);

  /* ------------------------------------------------------------ re-render on zoom/doc change */

  useEffect(() => {
    if (!pdfDoc || status !== 'ready') return;

    // Render only visible pages within buffer window around current page
    const start = Math.max(1, currentPage - RENDER_BUFFER);
    const end = Math.min(pdfDoc.numPages, currentPage + RENDER_BUFFER);
    for (let p = start; p <= end; p++) {
      void renderSinglePage(p, effectiveScale);
    }
  }, [pdfDoc, status, effectiveScale, currentPage, renderSinglePage]);

  /* ------------------------------------------------------------ initial position restoration */

  /*
   * The saved page is captured once, rather than read from props on every run:
   * it describes where the reader left off, so a later progress save must not
   * scroll the view back to it.
   */
  const savedPageRef = useRef(initialProgress?.chapterIndex);

  useEffect(() => {
    if (status !== 'ready' || !pdfDoc) return;

    const savedPage = savedPageRef.current;
    const initialPage = savedPage !== undefined && savedPage >= 0 ? savedPage + 1 : 1;
    const targetElement = pageRefs.current.get(initialPage);
    if (targetElement && containerRef.current) {
      restoringRef.current = true;
      targetElement.scrollIntoView?.({ behavior: 'auto', block: 'start' });
      setCurrentPage(initialPage);
      setTimeout(() => {
        restoringRef.current = false;
      }, 300);
      savedPageRef.current = undefined;
    }
  }, [status, pdfDoc]);

  /* ------------------------------------------------------------ scroll tracking */

  const reportProgress = useThrottledCallback(
    (page: number, numPages: number, scrollY: number) => {
      const percent = numPages > 0 ? (page / numPages) * 100 : 0;
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

  /* ------------------------------------------------------------ narration */

  const getPageText = useCallback(
    async (pageNum: number): Promise<string> => {
      if (pageTextCacheRef.current.has(pageNum)) {
        return pageTextCacheRef.current.get(pageNum)!;
      }
      if (!pdfDoc) return '';
      try {
        const page = await pdfDoc.getPage(pageNum);
        const rawText = await extractPdfPageText(page);
        const cleaned = rawText.replace(/\s+/g, ' ').trim();
        pageTextCacheRef.current.set(pageNum, cleaned);
        return cleaned;
      } catch {
        return '';
      }
    },
    [pdfDoc]
  );

  const stopNarration = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  useEffect(() => {
    const source: NarrationSource = {
      getSection: async (pageNum: number) => {
        const text = await getPageText(pageNum);
        return text ? { text } : null;
      },
      hasNextSection: (pageNum: number) => {
        return pdfInfo !== null && pageNum < pdfInfo.numPages;
      },
      onSectionStart: (pageNum: number) => {
        narratingPageRef.current = pageNum;
        setNarratingPage(pageNum);
        scrollToPage(pageNum);
      },
    };

    if (!engineRef.current) {
      engineRef.current = new NarrationEngine(source, {
        onStateChange: (state) => {
          setIsNarrating(state.isNarrating);
          if (!state.isNarrating) {
            setNarratingPage(null);
          }
        },
        onSectionAdvance: (nextPage) => {
          narratingPageRef.current = nextPage;
          setNarratingPage(nextPage);
          scrollToPage(nextPage);
        },
      });
    } else {
      engineRef.current.setSource(source);
    }
  }, [getPageText, pdfInfo, scrollToPage]);

  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  const startNarration = useCallback(
    (fromPage: number = currentPage, overrideVoice?: string, overrideRate?: number) => {
      if (!pdfDoc || !pdfInfo) return;
      if (fromPage < 1 || fromPage > pdfInfo.numPages) {
        stopNarration();
        return;
      }
      narratingPageRef.current = fromPage;
      setNarratingPage(fromPage);
      void engineRef.current?.start({
        sectionIndex: fromPage,
        voice: overrideVoice ?? ttsVoice,
        rate: overrideRate ?? narrationRate,
      });
    },
    [currentPage, narrationRate, pdfDoc, pdfInfo, stopNarration, ttsVoice]
  );

  const handleVoiceChange = useCallback(
    (newVoice: string) => {
      setTtsVoice(newVoice);
      engineRef.current?.setVoice(newVoice);
    },
    [setTtsVoice]
  );

  const handleRateChange = useCallback(
    (newRate: number) => {
      setNarrationRate(newRate);
      engineRef.current?.setRate(newRate);
    },
    [setNarrationRate]
  );

  const toggleNarration = useCallback(() => {
    if (isNarrating) {
      stopNarration();
    } else {
      startNarration(currentPage);
    }
  }, [currentPage, isNarrating, startNarration, stopNarration]);

  const handleRewind = useCallback(() => {
    const targetPage = Math.max(1, (narratingPage ?? currentPage) - 1);
    if (isNarrating) {
      startNarration(targetPage);
    } else {
      scrollToPage(targetPage);
    }
  }, [currentPage, isNarrating, narratingPage, scrollToPage, startNarration]);

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
      title={cleanTitleString(pdfInfo?.title || '') || cleanTitleString(item.title) || item.title}
      subtitle={totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : item.author}
      theme={theme}
      onThemeChange={setTheme}
      onClose={onClose}
      companionPath={item.companionPath}
      onSwitchToAudio={onSwitchToAudio}
      onSearch={handleSearch}
      onSelectSearchResult={handleSelectSearchResult}
      headerActionSlot={
        status === 'ready' && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRewind}
              className="icon-button"
              style={{ color: 'var(--reader-muted)' }}
              aria-label="Rewind to previous page"
              title="Rewind to previous page"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
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
          </div>
        )
      }
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

          <Section label="Voice">
            <select
              value={ttsVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--stroke-default)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            >
              <optgroup label={VOICE_GROUP_ONLINE}>
                {(edgeVoices.length > 0 ? edgeVoices : FALLBACK_VOICE_CHOICES).map((v) => (
                  <option key={v.name} value={v.name}>
                    {'label' in v ? (v as { label: string }).label : `${v.friendlyName || v.name} (${v.locale})`}
                  </option>
                ))}
              </optgroup>
              <optgroup label={VOICE_GROUP_LOCAL}>
                <option value={LOCAL_VOICE_ID}>{LOCAL_VOICE_LABEL}</option>
              </optgroup>
            </select>
            <p className="mt-1.5 text-[10px] leading-snug text-[var(--text-tertiary)]">
              {TTS_PRIVACY_NOTICE}
            </p>
          </Section>

          <Section label="Reading speed">
            <Stepper
              value={`${narrationRate.toFixed(2)}x`}
              onDecrease={() => handleRateChange(Math.max(0.5, Number((narrationRate - 0.1).toFixed(2))))}
              onIncrease={() => handleRateChange(Math.min(2.0, Number((narrationRate + 0.1).toFixed(2))))}
              decreaseLabel="Slower narration"
              increaseLabel="Faster narration"
            />
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
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
              const isNearViewport =
                pageNum >= currentPage - RENDER_BUFFER &&
                pageNum <= currentPage + RENDER_BUFFER;

              return (
                <div
                  key={pageNum}
                  ref={(el) => {
                    if (el) pageRefs.current.set(pageNum, el);
                    else pageRefs.current.delete(pageNum);
                  }}
                  onDoubleClick={() => {
                    void startNarration(pageNum);
                  }}
                  className={`relative rounded-sm shadow-xl transition-all duration-300 flex items-center justify-center ${
                    narratingPage === pageNum
                      ? 'ring-4 ring-[var(--accent)] ring-offset-4 ring-offset-transparent shadow-[0_0_35px_rgba(240,178,50,0.35)]'
                      : ''
                  }`}
                  style={{
                    filter: themeStyle.pageFilter,
                    backgroundColor: '#ffffff',
                    minWidth: `${estimatedPageWidth}px`,
                    minHeight: `${estimatedPageHeight}px`,
                  }}
                >
                  {isNearViewport ? (
                    <canvas
                      ref={(canvas) => {
                        if (canvas) {
                          canvasRefs.current.set(pageNum, canvas);
                          void renderSinglePage(pageNum, effectiveScale);
                        } else {
                          canvasRefs.current.delete(pageNum);
                          const ongoing = renderTasksRef.current.get(pageNum);
                          if (ongoing) {
                            try {
                              ongoing.cancel();
                            } catch {
                              // ignore
                            }
                            renderTasksRef.current.delete(pageNum);
                          }
                        }
                      }}
                      className="block rounded-sm"
                    />
                  ) : (
                    <div
                      className="flex flex-col items-center justify-center text-[12px] opacity-35 select-none"
                      style={{
                        width: `${estimatedPageWidth}px`,
                        height: `${estimatedPageHeight}px`,
                      }}
                    >
                      <span>Page {pageNum}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </ReaderShell>
  );
};
