import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Play, Square, RotateCcw } from 'lucide-react';
import type { Bookmark as BookmarkType, MediaItem, ProgressItem, EdgeVoice } from '../types';
import { parseEpub, type EpubChapter } from '../lib/epub';
import { PdfReaderView } from './PdfReaderView';
import { canRenderInReader } from '../lib/media';
import { formatReadingTime } from '../lib/format';
import { usePersistentState, useThrottledCallback } from '../hooks/usePersistentState';
import { ReaderShell, Section, Stepper, type ReadingTheme } from './ReaderShell';
import {
  buildNarrationMap,
  clearHighlight,
  highlightSentence,
  sentenceBoundsAt,
  isHighlightSupported,
  FALLBACK_VOICE_CHOICES,
  type NarrationMap,
} from '../lib/narration';
import { NarrationEngine, type NarrationSource } from '../lib/narrationEngine';
import {
  LOCAL_VOICE_ID,
  LOCAL_VOICE_LABEL,
  TTS_PRIVACY_NOTICE,
  VOICE_GROUP_LOCAL,
  VOICE_GROUP_ONLINE,
} from '../lib/tts';
import { cleanTitleString } from '../lib/metadata';
import { searchInText, highlightAndScrollToMatch, type SearchResultItem } from '../lib/search';

interface ReaderViewProps {
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

const EpubReaderView: React.FC<ReaderViewProps> = ({
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
  const scrollRef = useRef<HTMLElement | null>(null);
  const proseRef = useRef<HTMLDivElement | null>(null);
  const narrationMapRef = useRef<NarrationMap | null>(null);
  /** Set while restoring a saved position, to stop the scroll handler overwriting it. */
  const restoringRef = useRef(false);
  const onMetadataUpdateRef = useRef(onMetadataUpdate);
  useEffect(() => {
    onMetadataUpdateRef.current = onMetadataUpdate;
  });

  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [bookMeta, setBookMeta] = useState<{ title?: string; author?: string }>({});
  const [chapterIndex, setChapterIndex] = useState(initialProgress?.chapterIndex ?? 0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [isNarrating, setIsNarrating] = useState(false);

  const [fontSize, setFontSize] = usePersistentState('acuity.reader.fontSize', 18);
  const [lineHeight, setLineHeight] = usePersistentState('acuity.reader.lineHeight', 1.72);
  const [typeface, setTypeface] = usePersistentState<'serif' | 'sans'>('acuity.reader.typeface', 'serif');
  const [theme, setTheme] = usePersistentState<ReadingTheme>('acuity.reader.theme', 'dark');
  const [narrationRate, setNarrationRate] = usePersistentState('acuity.reader.narrationRate', 1);
  const [ttsVoice, setTtsVoice] = usePersistentState<string>('acuity.reader.ttsVoice', 'en-US-JennyNeural');
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);
  const engineRef = useRef<NarrationEngine | null>(null);
  const chapterIndexRef = useRef(chapterIndex);
  const currentCharIndexRef = useRef<number>(0);

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
          console.warn('Failed to load Edge neural voices:', err);
        });
    }
  }, []);

  const currentChapter = chapters[chapterIndex];

  const [glowRect, setGlowRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    opacity: number;
  } | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

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

  /* ---------------------------------------------------------- narration */

  const stopNarration = useCallback(() => {
    engineRef.current?.stop();
    clearHighlight();
    setGlowRect(null);
  }, []);

  const saveNarrationProgress = useCallback(
    (charIdx: number) => {
      try {
        localStorage.setItem(
          `acuity.narrationProgress.${item.id}`,
          JSON.stringify({
            chapterIndex: chapterIndexRef.current,
            charIndex: charIdx,
            updatedAt: Date.now(),
          })
        );
      } catch {
        // Ignore quota limits
      }
    },
    [item.id]
  );

  // Restore saved narration sentence progress for this book and chapter
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`acuity.narrationProgress.${item.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.chapterIndex === 'number' && parsed.chapterIndex === chapterIndex) {
          currentCharIndexRef.current = parsed.charIndex || 0;
        }
      }
    } catch {
      // Ignore
    }
  }, [chapterIndex, item.id]);

  useEffect(() => {
    chapterIndexRef.current = chapterIndex;
  }, [chapterIndex]);

  const updateVisualHighlight = useCallback((currentMap: NarrationMap, globalCharIdx: number) => {
    const range = highlightSentence(currentMap, globalCharIdx);
    const rect = range?.getBoundingClientRect();
    const host = scrollRef.current;
    if (rect && host) {
      const hostRect = host.getBoundingClientRect();
      if (rect.bottom > hostRect.bottom - 80 || rect.top < hostRect.top + 40) {
        host.scrollBy({ top: rect.top - hostRect.top - hostRect.height / 3, behavior: 'smooth' });
      }
    }
    if (range && articleRef.current) {
      const articleRect = articleRef.current.getBoundingClientRect();
      const rangeRect = range.getBoundingClientRect();
      if (rangeRect.width > 0 && rangeRect.height > 0) {
        setGlowRect({
          top: rangeRect.top - articleRect.top - 4,
          left: Math.max(0, rangeRect.left - articleRect.left - 8),
          width: Math.min(articleRect.width, rangeRect.width + 16),
          height: rangeRect.height + 8,
          opacity: 1,
        });
      }
    }
  }, []);

  useEffect(() => {
    const source: NarrationSource = {
      getSection: async (sectionIdx: number) => {
        if (sectionIdx < 0 || sectionIdx >= chapters.length) return null;

        // If the DOM currently displays this chapter, build NarrationMap directly
        if (chapterIndexRef.current === sectionIdx && proseRef.current) {
          const map = buildNarrationMap(proseRef.current);
          narrationMapRef.current = map;
          if (map.text.trim()) {
            return { text: map.text };
          }
        }

        // Wait a frame for React to render the new chapter into proseRef if changing chapters
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (proseRef.current) {
          const map = buildNarrationMap(proseRef.current);
          narrationMapRef.current = map;
          if (map.text.trim()) {
            return { text: map.text };
          }
        }

        const fallback = chapters[sectionIdx]?.text || '';
        return fallback.trim() ? { text: fallback } : null;
      },
      hasNextSection: (sectionIdx: number) => {
        return sectionIdx < chapters.length - 1;
      },
      onSectionStart: (nextChapterIdx: number) => {
        chapterIndexRef.current = nextChapterIdx;
        setChapterIndex(nextChapterIdx);
        currentCharIndexRef.current = 0;
        setGlowRect(null);
        clearHighlight();
        if (scrollRef.current) {
          scrollRef.current.scrollTop = 0;
        }
        onProgressUpdate(item.id, nextChapterIdx, percentFor(nextChapterIdx, 0), 0);
      },
    };

    if (!engineRef.current) {
      engineRef.current = new NarrationEngine(source, {
        onStateChange: (state) => {
          setIsNarrating(state.isNarrating);
          if (!state.isNarrating) {
            clearHighlight();
            setGlowRect(null);
          }
        },
        onBoundary: (charIdx) => {
          currentCharIndexRef.current = charIdx;
          saveNarrationProgress(charIdx);
          const map = narrationMapRef.current;
          if (map) {
            updateVisualHighlight(map, charIdx);
          }
        },
        onSectionAdvance: (nextChapterIdx) => {
          chapterIndexRef.current = nextChapterIdx;
          setChapterIndex(nextChapterIdx);
          currentCharIndexRef.current = 0;
          setGlowRect(null);
          clearHighlight();
          if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
          }
          onProgressUpdate(item.id, nextChapterIdx, percentFor(nextChapterIdx, 0), 0);
        },
      });
    } else {
      engineRef.current.setSource(source);
    }
  }, [chapters, item.id, onProgressUpdate, percentFor, saveNarrationProgress, updateVisualHighlight]);

  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  const startNarration = useCallback(
    (fromCharIndex: number = 0, overrideVoice?: string, overrideRate?: number) => {
      if (!proseRef.current && (!chapters[chapterIndex] || !chapters[chapterIndex].text)) return;

      const container = proseRef.current;
      if (container) {
        const map = buildNarrationMap(container);
        narrationMapRef.current = map;
        const clampedFrom = Math.max(0, Math.min(fromCharIndex, map.text.length));
        const sentenceBounds = sentenceBoundsAt(map.text, clampedFrom);
        const startChar = clampedFrom > 0 ? sentenceBounds.start : 0;
        currentCharIndexRef.current = startChar;
        saveNarrationProgress(startChar);
        updateVisualHighlight(map, startChar);
      }

      void engineRef.current?.start({
        sectionIndex: chapterIndex,
        charOffset: fromCharIndex,
        voice: overrideVoice ?? ttsVoice,
        rate: overrideRate ?? narrationRate,
      });
    },
    [chapterIndex, chapters, narrationRate, saveNarrationProgress, ttsVoice, updateVisualHighlight]
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
      startNarration(currentCharIndexRef.current);
    }
  }, [isNarrating, startNarration, stopNarration]);

  const handleRewind = useCallback(() => {
    const container = proseRef.current;
    if (!container) return;
    let map = narrationMapRef.current;
    if (!map) {
      map = buildNarrationMap(container);
      narrationMapRef.current = map;
    }
    if (!map.text.trim()) return;

    const currentPos = currentCharIndexRef.current;
    const currentBounds = sentenceBoundsAt(map.text, currentPos);

    let targetPos = currentBounds.start;
    if (currentPos - currentBounds.start < 20 && currentBounds.start > 0) {
      const prevBounds = sentenceBoundsAt(map.text, Math.max(0, currentBounds.start - 2));
      targetPos = prevBounds.start;
    }

    currentCharIndexRef.current = targetPos;
    saveNarrationProgress(targetPos);

    if (isNarrating) {
      startNarration(targetPos);
    } else {
      updateVisualHighlight(map, targetPos);
    }
  }, [isNarrating, saveNarrationProgress, startNarration, updateVisualHighlight]);

  const handleDoubleClickProse = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = proseRef.current;
      if (!container) return;

      let targetNode: Node | null = null;
      let targetOffset = 0;

      const doc = document as unknown as {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };

      if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          targetNode = pos.offsetNode;
          targetOffset = pos.offset;
        }
      } else if (doc.caretRangeFromPoint) {
        const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
          targetNode = range.startContainer;
          targetOffset = range.startOffset;
        }
      }

      if (!targetNode) return;

      let map = narrationMapRef.current;
      if (!map) {
        map = buildNarrationMap(container);
        narrationMapRef.current = map;
      }

      const seg = map.segments.find((s) => s.node === targetNode);
      if (!seg) return;

      const charIndex = seg.start + targetOffset;
      const bounds = sentenceBoundsAt(map.text, charIndex);

      window.getSelection()?.removeAllRanges();
      currentCharIndexRef.current = bounds.start;
      saveNarrationProgress(bounds.start);
      startNarration(bounds.start);
    },
    [saveNarrationProgress, startNarration]
  );

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
        const cleanBookTitle = book.title ? cleanTitleString(book.title) : undefined;
        setBookMeta({ title: cleanBookTitle, author: book.author });
        if (cleanBookTitle && cleanBookTitle !== item.title) {
          onMetadataUpdateRef.current?.(item.id, { title: cleanBookTitle, author: book.author || item.author });
        }
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
      stopNarration();
    };
  }, [item, stopNarration]);

  /* ----------------------------------------------------------- scroll progress */

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

  /* Restore saved scroll offset */
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
      savedChapterRef.current = -1;
    });
    return () => cancelAnimationFrame(frame);
  }, [chapterIndex, status]);

  /* --------------------------------------------------- chapter navigation */

  const goToChapter = useCallback(
    (index: number) => {
      if (index < 0 || index >= chapters.length) return;
      stopNarration();
      currentCharIndexRef.current = 0;
      setGlowRect(null);
      chapterIndexRef.current = index;
      setChapterIndex(index);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      onProgressUpdate(item.id, index, percentFor(index, 0), 0);
    },
    [chapters.length, item.id, onProgressUpdate, percentFor, stopNarration]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.isContentEditable) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goToChapter(chapterIndex + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToChapter(chapterIndex - 1);
      } else if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        if (status === 'ready' && currentChapter) {
          onAddBookmark(item.id, chapterIndex, currentChapter.text.slice(0, 140));
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chapterIndex, goToChapter, onClose, status, currentChapter, item.id, onAddBookmark]);

  const progressPercent = Math.round(percentFor(chapterIndex, 0));

  const tocEntries = useMemo(() => {
    return chapters.map((ch, idx) => ({
      id: idx,
      title: ch.title,
      subtitle: ch.words > 0 ? formatReadingTime(ch.words) : undefined,
      active: idx === chapterIndex,
    }));
  }, [chapters, chapterIndex]);

  const handleSearch = useCallback(
    async (query: string): Promise<SearchResultItem[]> => {
      if (!query.trim() || chapters.length === 0) return [];
      const results: SearchResultItem[] = [];
      chapters.forEach((ch, idx) => {
        const chapterResults = searchInText(ch.text, query, idx, ch.title || `Chapter ${idx + 1}`);
        results.push(...chapterResults);
      });
      return results;
    },
    [chapters]
  );

  const handleSelectSearchResult = useCallback(
    (result: SearchResultItem) => {
      if (result.locationIndex !== chapterIndex) {
        goToChapter(result.locationIndex);
        setTimeout(() => {
          if (proseRef.current) {
            highlightAndScrollToMatch(proseRef.current, result.matchedText, result.textOffset);
          }
        }, 120);
      } else {
        if (proseRef.current) {
          highlightAndScrollToMatch(proseRef.current, result.matchedText, result.textOffset);
        }
      }
    },
    [chapterIndex, goToChapter]
  );

  /* -------------------------------------------------------------- render */

  return (
    <ReaderShell
      title={bookMeta.title || cleanTitleString(item.title) || item.title}
      subtitle={currentChapter?.title ?? item.author}
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
              aria-label="Rewind to previous sentence"
              title="Rewind to previous sentence"
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
                  {face === 'serif' ? 'Serif' : 'Sans'}
                </button>
              ))}
            </div>
          </Section>

          <Section label="Read Aloud voice">
            <select
              value={ttsVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              aria-label="Read Aloud Voice"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--stroke-default)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] transition-colors focus:border-[var(--accent)] focus:outline-none"
            >
              <optgroup label={VOICE_GROUP_ONLINE}>
                {(edgeVoices.length > 0 ? edgeVoices : FALLBACK_VOICE_CHOICES).map((v) => {
                  const value = 'name' in v ? v.name : (v as { name: string; label: string }).name;
                  const label =
                    'friendlyName' in v
                      ? (v as EdgeVoice).friendlyName.replace('Microsoft ', '').replace(' Online (Natural)', '')
                      : (v as { name: string; label: string }).label;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
              </optgroup>
              <optgroup label={VOICE_GROUP_LOCAL}>
                <option value={LOCAL_VOICE_ID}>{LOCAL_VOICE_LABEL}</option>
              </optgroup>
            </select>
            <p className="mt-1.5 text-[10px] leading-snug text-[var(--text-tertiary)]">
              {TTS_PRIVACY_NOTICE}
            </p>
          </Section>

          <Section label="Narration speed">
            <Stepper
              value={`${narrationRate.toFixed(2)}×`}
              onDecrease={() => handleRateChange(Math.max(0.5, Number((narrationRate - 0.25).toFixed(2))))}
              onIncrease={() => handleRateChange(Math.min(2.5, Number((narrationRate + 0.25).toFixed(2))))}
              decreaseLabel="Slower narration"
              increaseLabel="Faster narration"
            />
          </Section>

          {!isHighlightSupported() && (
            <p className="text-[10px] leading-snug text-[var(--text-tertiary)]">
              Sentence highlighting is unavailable in this runtime; narration still works.
            </p>
          )}
        </>
      }
      tocEntries={tocEntries}
      onSelectTocEntry={(entry) => goToChapter(Number(entry.id))}
      bookmarks={bookmarks}
      onSelectBookmark={(bm) => goToChapter(bm.position)}
      onRemoveBookmark={onRemoveBookmark}
      onToggleBookmark={
        status === 'ready' && currentChapter
          ? () => onAddBookmark(item.id, chapterIndex, currentChapter.text.slice(0, 140))
          : undefined
      }
      isCurrentLocationBookmarked={bookmarks.some((b) => b.position === chapterIndex)}
      bookmarkLabel="Bookmark this chapter (B)"
      showFooter={status === 'ready' && chapters.length > 0}
      canGoPrev={chapterIndex > 0}
      canGoNext={chapterIndex < chapters.length - 1}
      onPrev={() => goToChapter(chapterIndex - 1)}
      onNext={() => goToChapter(chapterIndex + 1)}
      prevLabel="Previous chapter"
      nextLabel="Next chapter"
      progressPercent={progressPercent}
      progressLabel={`${progressPercent}%`}
    >
      <main
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 select-text overflow-y-auto px-6 py-10"
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
            ref={articleRef}
            key={currentChapter.id}
            className="reader-prose animate-fade-rise relative"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight,
              fontFamily:
                typeface === 'serif'
                  ? "Newsreader, 'Playfair Display', Georgia, serif"
                  : "'Segoe UI Variable Text', -apple-system, system-ui, sans-serif",
            }}
          >
            {/* Gentle background glow tracking the active spoken sentence */}
            {glowRect && glowRect.opacity > 0 && (
              <div
                className="pointer-events-none absolute z-0 transition-all duration-300 ease-out"
                style={{
                  top: glowRect.top,
                  left: glowRect.left,
                  width: glowRect.width,
                  height: glowRect.height,
                  opacity: glowRect.opacity,
                  borderRadius: '8px',
                  background:
                    'radial-gradient(ellipse at center, rgba(240, 178, 50, 0.22) 0%, rgba(240, 178, 50, 0.06) 75%, transparent 100%)',
                  boxShadow:
                    '0 0 20px 2px rgba(240, 178, 50, 0.18), inset 0 0 10px rgba(240, 178, 50, 0.08)',
                  borderLeft: '3px solid rgba(240, 178, 50, 0.8)',
                }}
                aria-hidden="true"
              />
            )}

            <header className="mb-8 border-b pb-4 relative z-10" style={{ borderColor: 'var(--reader-rule)' }}>
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

            <div
              ref={proseRef}
              onDoubleClick={handleDoubleClickProse}
              data-dropcap={chapterIndex === 0}
              className="relative z-10"
              dangerouslySetInnerHTML={{ __html: currentChapter.html }}
            />
          </article>
        )}
      </main>
    </ReaderShell>
  );
};

/* ------------------------------------------------------------- subviews */

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

export const ReaderView: React.FC<ReaderViewProps> = (props) => {
  if (props.item.format.toLowerCase() === 'pdf') {
    return <PdfReaderView {...props} />;
  }
  return <EpubReaderView {...props} />;
};
