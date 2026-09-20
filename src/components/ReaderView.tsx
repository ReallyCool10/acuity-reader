import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Headphones,
  Play,
  Square,
  Type,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Coffee,
} from 'lucide-react';
import JSZip from 'jszip';
import type { MediaItem, ProgressItem } from '../types';
import { AcuityLogo } from './AcuityLogo';

interface ReaderViewProps {
  item: MediaItem;
  initialProgress?: ProgressItem;
  onClose: () => void;
  onProgressUpdate: (itemId: string, page: number, percent: number) => void;
  onAddBookmark: (itemId: string, page: number) => void;
  onSwitchToAudio?: (companionPath: string) => void;
}

type ReadingTheme = 'dark' | 'sepia' | 'light';

export const ReaderView: React.FC<ReaderViewProps> = ({
  item,
  initialProgress,
  onClose,
  onProgressUpdate,
  onAddBookmark,
  onSwitchToAudio,
}) => {
  const [chapters, setChapters] = useState<{ title: string; text: string }[]>([]);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(
    initialProgress?.pdfPage ? Math.max(0, initialProgress.pdfPage - 1) : 0
  );
  const [fontSize, setFontSize] = useState(17);
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans'>('serif');
  const [theme, setTheme] = useState<ReadingTheme>('dark');
  const [isNarrating, setIsNarrating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const contentContainerRef = useRef<HTMLDivElement | null>(null);

  // Load real EPUB text if possible, or fallback to clean reader structure
  useEffect(() => {
    let isCancelled = false;

    async function loadContent() {
      setIsLoading(true);
      const ext = item.format.toLowerCase();

      if (ext === 'epub') {
        try {
          // If local file path, read file using fetch or electron fs
          const res = await fetch(item.filePath.startsWith('file://') ? item.filePath : 'file:///' + item.filePath.replace(/\\/g, '/'));
          const buffer = await res.arrayBuffer();
          const zip = await JSZip.loadAsync(buffer);

          // Find all xhtml / html documents
          const htmlFiles = Object.values(zip.files).filter(
            (f) => !f.dir && /\.(x?html|xml)$/i.test(f.name) && !f.name.includes('toc')
          );

          if (htmlFiles.length > 0) {
            const parsedChapters: { title: string; text: string }[] = [];
            for (let i = 0; i < Math.min(htmlFiles.length, 30); i++) {
              const htmlStr = await htmlFiles[i].async('text');
              const parser = new DOMParser();
              const doc = parser.parseFromString(htmlStr, 'text/html');

              // Extract readable body text
              const body = doc.body;
              if (body) {
                // Remove scripts, styles
                const scripts = body.querySelectorAll('script, style');
                scripts.forEach((s) => s.remove());

                const text = body.innerText?.trim() || '';
                if (text.length > 80) {
                  const heading = doc.querySelector('h1, h2, h3')?.textContent?.trim();
                  parsedChapters.push({
                    title: heading || `Chapter ${parsedChapters.length + 1}`,
                    text,
                  });
                }
              }
            }

            if (!isCancelled && parsedChapters.length > 0) {
              setChapters(parsedChapters);
              setIsLoading(false);
              return;
            }
          }
        } catch {
          // Fall back gracefully
        }
      }

      // Default editorial sample / preview for PDF or when parsing is not direct
      if (!isCancelled) {
        setChapters([
          {
            title: item.title,
            text: `Welcome to Acuity Reader's reader edition for "${item.title}".\n\nAuthored by ${item.author || 'Unknown'}.\n\nAcuity provides synchronized cross-modal reading and listening for your library. When an audiobook companion edition is present in your library, you can switch seamlessly between listening and reading with a single click.\n\nUse the Read Aloud toggle in the top bar to have Acuity narrate this chapter using high-quality local speech synthesis. You can also customize your typography, toggle between light, dark, and warm sepia themes, and bookmark memorable passages.\n\nEnjoy an immersive, distraction-free reading experience.`,
          },
        ]);
        setIsLoading(false);
      }
    }

    loadContent();
    return () => {
      isCancelled = true;
      window.speechSynthesis.cancel();
    };
  }, [item]);

  // Speech synthesis Read Aloud
  const toggleNarration = useCallback(() => {
    if (isNarrating) {
      window.speechSynthesis.cancel();
      setIsNarrating(false);
    } else {
      window.speechSynthesis.cancel();
      const currentText = chapters[currentChapterIdx]?.text || '';
      if (!currentText) return;

      const utterance = new SpeechSynthesisUtterance(currentText);
      utterance.rate = 1.0;
      utterance.onend = () => setIsNarrating(false);
      utterance.onerror = () => setIsNarrating(false);

      setIsNarrating(true);
      window.speechSynthesis.speak(utterance);
    }
  }, [isNarrating, chapters, currentChapterIdx]);

  const handleNextChapter = () => {
    if (currentChapterIdx < chapters.length - 1) {
      const next = currentChapterIdx + 1;
      setCurrentChapterIdx(next);
      contentContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      onProgressUpdate(item.id, next + 1, ((next + 1) / chapters.length) * 100);
    }
  };

  const handlePrevChapter = () => {
    if (currentChapterIdx > 0) {
      const prev = currentChapterIdx - 1;
      setCurrentChapterIdx(prev);
      contentContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      onProgressUpdate(item.id, prev + 1, ((prev + 1) / chapters.length) * 100);
    }
  };

  const currentChapter = chapters[currentChapterIdx];
  const progressPercent = chapters.length > 0 ? Math.round(((currentChapterIdx + 1) / chapters.length) * 100) : 0;

  // Reading themes
  const themeStyles = {
    dark: 'bg-neutral-950 text-neutral-200 border-white/[0.08]',
    sepia: 'bg-[#f8f1e3] text-[#3d3226] border-[#3d3226]/10',
    light: 'bg-[#fafafa] text-[#1c1d1f] border-black/10',
  };

  const themeNavStyles = {
    dark: 'bg-neutral-900/90 text-neutral-100 border-white/[0.08]',
    sepia: 'bg-[#f0e7d5]/90 text-[#3d3226] border-[#3d3226]/15',
    light: 'bg-white/90 text-neutral-900 border-neutral-200',
  };

  return (
    <div className={`fixed inset-0 z-50 flex flex-col h-screen w-screen transition-colors duration-300 ${themeStyles[theme]}`}>
      {/* Top Navigation Bar: Clear Exit to Library button, Book Title, and Action Controls */}
      <header
        className={`flex items-center justify-between h-12 px-3 border-b select-none backdrop-blur-md z-30 transition-colors ${themeNavStyles[theme]}`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: Prominent EXIT TO LIBRARY button */}
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 active:scale-95 border border-white/15 transition-all shadow-xs cursor-pointer group"
            title="Return to Home Library"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>Library</span>
          </button>

          <AcuityLogo size={22} />
        </div>

        {/* Center: Title & Chapter Navigation */}
        <div className="flex-1 min-w-0 mx-3 text-center">
          <h2 className="text-xs font-semibold truncate leading-tight" title={item.title}>
            {item.title}
          </h2>
          <p className="text-[10px] opacity-70 truncate">
            {currentChapter?.title || `Page ${currentChapterIdx + 1}`}
          </p>
        </div>

        {/* Right: Controls (Listen, Read Aloud, Appearance, Bookmark) */}
        <div
          className="flex items-center gap-1.5 pr-[140px]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Companion Audiobook Switch */}
          {item.companionPath && onSwitchToAudio && (
            <button
              onClick={() => onSwitchToAudio(item.companionPath!)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/25 rounded-md transition-all shadow-2xs"
              title="Switch to Audiobook edition"
            >
              <Headphones className="w-3 h-3" />
              <span>Listen</span>
            </button>
          )}

          {/* Read Aloud (Speech Synthesis) */}
          <button
            onClick={toggleNarration}
            title={isNarrating ? 'Stop reading aloud' : 'Read aloud with speech synthesis'}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              isNarrating
                ? 'bg-amber-400 text-neutral-950 font-semibold shadow-xs'
                : 'hover:bg-white/10 opacity-80 hover:opacity-100'
            }`}
          >
            {isNarrating ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
            <span>{isNarrating ? 'Stop' : 'Read'}</span>
          </button>

          {/* Appearance Menu Toggle */}
          <div className="relative">
            <button
              onClick={() => setIsAppearanceOpen(!isAppearanceOpen)}
              title="Typography & Theme settings"
              className="p-1.5 rounded-md hover:bg-white/10 opacity-80 hover:opacity-100 transition-colors"
            >
              <Type className="w-3.5 h-3.5" />
            </button>

            {/* Appearance Dropdown */}
            {isAppearanceOpen && (
              <div
                className={`absolute right-0 top-full mt-2 w-56 p-3 rounded-xl shadow-2xl border backdrop-blur-xl z-50 space-y-3 ${
                  theme === 'dark' ? 'bg-neutral-900/95 border-white/10 text-white' : 'bg-white/95 border-neutral-300 text-neutral-900'
                }`}
              >
                {/* Theme Selector */}
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    Theme
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      onClick={() => setTheme('dark')}
                      className={`flex-1 py-1 px-2 rounded-md text-[11px] font-medium flex items-center justify-center gap-1 border transition-all ${
                        theme === 'dark' ? 'bg-neutral-800 border-white/30 text-white' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <Moon className="w-3 h-3" />
                      <span>Dark</span>
                    </button>
                    <button
                      onClick={() => setTheme('sepia')}
                      className={`flex-1 py-1 px-2 rounded-md text-[11px] font-medium flex items-center justify-center gap-1 border transition-all ${
                        theme === 'sepia' ? 'bg-[#f0e7d5] text-[#3d3226] border-[#3d3226]/30' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <Coffee className="w-3 h-3" />
                      <span>Sepia</span>
                    </button>
                    <button
                      onClick={() => setTheme('light')}
                      className={`flex-1 py-1 px-2 rounded-md text-[11px] font-medium flex items-center justify-center gap-1 border transition-all ${
                        theme === 'light' ? 'bg-neutral-100 text-neutral-900 border-neutral-300' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <Sun className="w-3 h-3" />
                      <span>Light</span>
                    </button>
                  </div>
                </div>

                {/* Font Size Selector */}
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    Text Size
                  </span>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <button
                      onClick={() => setFontSize((s) => Math.max(13, s - 1))}
                      className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-semibold"
                    >
                      A-
                    </button>
                    <span className="text-xs font-medium tabular-nums">{fontSize}px</span>
                    <button
                      onClick={() => setFontSize((s) => Math.min(26, s + 1))}
                      className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-semibold"
                    >
                      A+
                    </button>
                  </div>
                </div>

                {/* Font Typeface */}
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    Typeface
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      onClick={() => setFontFamily('serif')}
                      className={`flex-1 py-1 rounded text-xs font-serif border ${
                        fontFamily === 'serif' ? 'border-white/30 font-semibold' : 'border-transparent opacity-60'
                      }`}
                    >
                      Serif
                    </button>
                    <button
                      onClick={() => setFontFamily('sans')}
                      className={`flex-1 py-1 rounded text-xs font-sans border ${
                        fontFamily === 'sans' ? 'border-white/30 font-semibold' : 'border-transparent opacity-60'
                      }`}
                    >
                      Sans
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bookmark Button */}
          <button
            onClick={() => onAddBookmark(item.id, currentChapterIdx + 1)}
            title="Bookmark this position"
            className="p-1.5 rounded-md hover:bg-white/10 opacity-80 hover:opacity-100 transition-colors"
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Reader Content Body */}
      <main
        ref={contentContainerRef}
        className="flex-1 overflow-y-auto px-6 py-10 max-w-2xl mx-auto w-full select-text leading-relaxed transition-all"
        style={{
          fontFamily:
            fontFamily === 'serif'
              ? "'Newsreader', 'Playfair Display', 'Georgia', serif"
              : "'Segoe UI Variable Text', -apple-system, sans-serif",
          fontSize: `${fontSize}px`,
        }}
      >
        {isLoading ? (
          <div className="h-64 flex flex-col items-center justify-center space-y-3 opacity-60">
            <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <p className="text-xs">Opening {item.title}...</p>
          </div>
        ) : (
          <article className="space-y-6">
            <header className="border-b pb-4 mb-6 opacity-80 border-current/15">
              <h1 className="text-xl font-bold tracking-tight">
                {currentChapter?.title || item.title}
              </h1>
              {item.author && <p className="text-xs mt-1 opacity-70">By {item.author}</p>}
            </header>

            {currentChapter?.text.split('\n\n').map((paragraph, idx) => (
              <p key={idx} className="leading-relaxed">
                {paragraph}
              </p>
            ))}
          </article>
        )}
      </main>

      {/* Bottom Chapter & Reading Progress Footer */}
      <footer
        className={`flex items-center justify-between h-10 px-4 border-t select-none backdrop-blur-md z-30 transition-colors ${themeNavStyles[theme]}`}
      >
        <button
          onClick={handlePrevChapter}
          disabled={currentChapterIdx === 0}
          className="flex items-center gap-1 text-xs opacity-80 hover:opacity-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Previous</span>
        </button>

        <div className="flex items-center gap-2">
          <div className="w-24 h-1 bg-current/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums opacity-75 font-medium">
            {progressPercent}%
          </span>
        </div>

        <button
          onClick={handleNextChapter}
          disabled={currentChapterIdx >= chapters.length - 1}
          className="flex items-center gap-1 text-xs opacity-80 hover:opacity-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
        >
          <span>Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </footer>
    </div>
  );
};
