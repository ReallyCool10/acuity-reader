import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, Play, Square } from 'lucide-react';
import type { Bookmark as BookmarkType, MediaItem, ProgressItem, EdgeVoice, EdgeSynthesisResult } from '../types';
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
  isHighlightSupported,
  splitNarrationChunks,
  base64ToBlobUrl,
  type NarrationMap,
} from '../lib/narration';

const FALLBACK_VOICE_CHOICES: { name: string; label: string }[] = [
  { name: 'en-US-JennyNeural', label: 'Jenny (US) — Natural, Warm ★' },
  { name: 'en-US-GuyNeural', label: 'Guy (US) — Natural, Conversational ★' },
  { name: 'en-US-AriaNeural', label: 'Aria (US) — Crisp, Clear ★' },
  { name: 'en-GB-SoniaNeural', label: 'Sonia (UK) — Melodic, British ★' },
  { name: 'en-GB-RyanNeural', label: 'Ryan (UK) — Articulate, British ★' },
  { name: 'en-AU-WilliamMultilingualNeural', label: 'William (AU) — Australian' },
  { name: 'en-CA-ClaraNeural', label: 'Clara (CA) — Canadian' },
  { name: 'en-IE-EmilyNeural', label: 'Emily (IE) — Irish' },
];

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

const EpubReaderView: React.FC<ReaderViewProps> = ({
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
  const narrationMapRef = useRef<NarrationMap | null>(null);
  /** Set while restoring a saved position, to stop the scroll handler overwriting it. */
  const restoringRef = useRef(false);

  const [chapters, setChapters] = useState<EpubChapter[]>([]);
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
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const narrationAbortRef = useRef<AbortController | null>(null);
  const prefetchPromiseRef = useRef<Promise<EdgeSynthesisResult> | null>(null);

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

  /* ---------------------------------------------------------- narration */

  const stopNarration = useCallback(() => {
    if (narrationAbortRef.current) {
      narrationAbortRef.current.abort();
      narrationAbortRef.current = null;
    }
    prefetchPromiseRef.current = null;
    if (narrationAudioRef.current) {
      narrationAudioRef.current.pause();
      narrationAudioRef.current.src = '';
      narrationAudioRef.current.ontimeupdate = null;
      narrationAudioRef.current.onended = null;
      narrationAudioRef.current.onerror = null;
    }
    window.speechSynthesis?.cancel();
    clearHighlight();
    setIsNarrating(false);
  }, []);

  const fallbackLocalSpeech = useCallback(
    (map: NarrationMap) => {
      window.speechSynthesis?.cancel();
      const utterance = new SpeechSynthesisUtterance(map.text);
      utterance.rate = narrationRate;

      utterance.onboundary = (event) => {
        const currentMap = narrationMapRef.current;
        if (!currentMap) return;
        const range = highlightSentence(currentMap, event.charIndex);
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
      window.speechSynthesis?.speak(utterance);
    },
    [narrationRate]
  );

  const startNarration = useCallback(() => {
    const container = proseRef.current;
    if (!container) return;

    const map = buildNarrationMap(container);
    if (!map.text.trim()) return;
    narrationMapRef.current = map;

    stopNarration();

    const api = window.electronAPI;
    const useEdge =
      ttsVoice !== 'system-local' &&
      api !== undefined &&
      typeof api.synthesizeEdge === 'function';

    if (useEdge && api) {
      const abortController = new AbortController();
      narrationAbortRef.current = abortController;
      setIsNarrating(true);

      const chunks = splitNarrationChunks(map.text, 800);
      if (chunks.length === 0) {
        setIsNarrating(false);
        return;
      }

      if (!narrationAudioRef.current) {
        narrationAudioRef.current = new Audio();
      }
      const audio = narrationAudioRef.current;
      let currentBlobUrl: string | null = null;

      const playChunkAt = async (index: number) => {
        if (abortController.signal.aborted) return;
        if (index >= chunks.length) {
          stopNarration();
          return;
        }

        const chunk = chunks[index];

        try {
          const synthesisResult = prefetchPromiseRef.current
            ? await prefetchPromiseRef.current
            : await api.synthesizeEdge({
                text: chunk.text,
                voice: ttsVoice,
                rate: narrationRate,
              });
          prefetchPromiseRef.current = null;

          if (abortController.signal.aborted) return;

          // Pre-fetch next chunk concurrently in background
          if (index + 1 < chunks.length) {
            prefetchPromiseRef.current = api.synthesizeEdge({
              text: chunks[index + 1].text,
              voice: ttsVoice,
              rate: narrationRate,
            });
          }

          if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
          }
          currentBlobUrl = base64ToBlobUrl(synthesisResult.audioBase64, synthesisResult.mimeType);
          audio.src = currentBlobUrl;

          audio.ontimeupdate = () => {
            if (abortController.signal.aborted) return;
            const currentMap = narrationMapRef.current;
            if (!currentMap) return;

            const timeMs = audio.currentTime * 1000;
            let active = synthesisResult.boundaries.find(
              (b) => timeMs >= b.offsetMs && timeMs < b.offsetMs + b.durationMs
            );
            if (!active) {
              for (let i = synthesisResult.boundaries.length - 1; i >= 0; i--) {
                if (timeMs >= synthesisResult.boundaries[i].offsetMs) {
                  active = synthesisResult.boundaries[i];
                  break;
                }
              }
            }

            if (active) {
              const relIdx = chunk.text.indexOf(active.text);
              const globalCharIdx = chunk.startChar + (relIdx !== -1 ? relIdx : 0);
              const range = highlightSentence(currentMap, globalCharIdx);
              const rect = range?.getBoundingClientRect();
              const host = scrollRef.current;
              if (rect && host) {
                const hostRect = host.getBoundingClientRect();
                if (rect.bottom > hostRect.bottom - 80 || rect.top < hostRect.top + 40) {
                  host.scrollBy({ top: rect.top - hostRect.top - hostRect.height / 3, behavior: 'smooth' });
                }
              }
            }
          };

          audio.onended = () => {
            if (currentBlobUrl) {
              URL.revokeObjectURL(currentBlobUrl);
              currentBlobUrl = null;
            }
            void playChunkAt(index + 1);
          };

          audio.onerror = () => {
            if (currentBlobUrl) {
              URL.revokeObjectURL(currentBlobUrl);
              currentBlobUrl = null;
            }
            console.warn('Edge TTS playback failed, falling back to local speech');
            fallbackLocalSpeech(map);
          };

          await audio.play();
        } catch (err) {
          if (abortController.signal.aborted) return;
          console.warn('Edge TTS synthesis failed, falling back to local speech:', err);
          fallbackLocalSpeech(map);
        }
      };

      void playChunkAt(0);
      return;
    }

    fallbackLocalSpeech(map);
  }, [fallbackLocalSpeech, narrationRate, stopNarration, ttsVoice]);

  const toggleNarration = useCallback(() => {
    if (isNarrating) stopNarration();
    else startNarration();
  }, [isNarrating, startNarration, stopNarration]);

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
      stopNarration();
    };
  }, [item, stopNarration]);

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

  /* Moving chapters ends narration */
  useEffect(() => {
    stopNarration();
  }, [chapterIndex, stopNarration]);

  /* --------------------------------------------------- chapter navigation */

  const goToChapter = useCallback(
    (index: number) => {
      if (index < 0 || index >= chapters.length) return;
      stopNarration();
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

  /* -------------------------------------------------------------- render */

  return (
    <ReaderShell
      title={item.title}
      subtitle={currentChapter?.title ?? item.author}
      theme={theme}
      onThemeChange={setTheme}
      onClose={onClose}
      companionPath={item.companionPath}
      onSwitchToAudio={onSwitchToAudio}
      headerActionSlot={
        status === 'ready' && (
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
                  {face}
                </button>
              ))}
            </div>
          </Section>

          <Section label="Read Aloud voice">
            <select
              value={ttsVoice}
              onChange={(e) => setTtsVoice(e.target.value)}
              aria-label="Read Aloud Voice"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] transition-colors focus:border-[var(--accent)] focus:outline-none"
            >
              <optgroup label="Microsoft Edge Neural">
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
              <optgroup label="Local System">
                <option value="system-local">System Local Voice (Offline)</option>
              </optgroup>
            </select>
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

            <div
              ref={proseRef}
              data-dropcap={chapterIndex === 0}
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
