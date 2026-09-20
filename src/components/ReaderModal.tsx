import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Headphones,
  Play,
  Square,
  Type,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { MediaItem, ProgressItem } from '../types';

interface ReaderModalProps {
  item: MediaItem;
  initialProgress?: ProgressItem;
  onClose: () => void;
  onProgressUpdate: (itemId: string, page: number, percent: number) => void;
  onAddBookmark: (itemId: string, page: number) => void;
  onSwitchToAudio?: (companionPath: string) => void;
}

export const ReaderModal: React.FC<ReaderModalProps> = ({
  item,
  initialProgress,
  onClose,
  onProgressUpdate,
  onAddBookmark,
  onSwitchToAudio,
}) => {
  const [currentPage, setCurrentPage] = useState(initialProgress?.pdfPage || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [fontSize, setFontSize] = useState(16);
  const [isNarrating, setIsNarrating] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number | null>(null);
  const [contentLines, setContentLines] = useState<string[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load sample / extracted book text
  useEffect(() => {
    // For local books, read text or provide structured chapter view
    const sampleSentences = [
      `Welcome to Acuity Reader: "${item.title}".`,
      `By ${item.author || 'Unknown Author'}.`,
      'Knowledge and insight are absorbed through multiple modalities.',
      'Whether reading reflowable text or listening to spoken narration, your progress and bookmarks stay synchronized.',
      'Click the Narration button above to have Acuity read this text aloud using neural speech synthesis.',
      'You can switch seamlessly between listening to an audiobook edition and reading the companion text at any time.',
      'Adjust your font size, bookmark key passages, and enjoy distraction-free reading.',
    ];
    setContentLines(sampleSentences);
    setTotalPages(Math.max(1, Math.ceil(sampleSentences.length / 4)));
  }, [item]);

  // Clean up speech synthesis when closing reader
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Text-To-Speech Narration Handler
  const toggleNarration = () => {
    if (isNarrating) {
      window.speechSynthesis.cancel();
      setIsNarrating(false);
      setCurrentSentenceIndex(null);
    } else {
      window.speechSynthesis.cancel();
      const textToRead = contentLines.join(' ');
      const utterance = new SpeechSynthesisUtterance(textToRead);
      utterance.rate = 1.0;

      utterance.onboundary = (e) => {
        if (e.name === 'sentence' || e.name === 'word') {
          // Track approximate progress
        }
      };

      utterance.onend = () => {
        setIsNarrating(false);
        setCurrentSentenceIndex(null);
      };

      utterance.onerror = () => {
        setIsNarrating(false);
        setCurrentSentenceIndex(null);
      };

      utteranceRef.current = utterance;
      setIsNarrating(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      const next = currentPage + 1;
      setCurrentPage(next);
      onProgressUpdate(item.id, next, (next / totalPages) * 100);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prev = currentPage - 1;
      setCurrentPage(prev);
      onProgressUpdate(item.id, prev, (prev / totalPages) * 100);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-neutral-950/95 backdrop-blur-3xl flex flex-col text-neutral-100 select-text">
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08] bg-black/40 backdrop-blur-md select-none">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 pr-2">
            <h4 className="text-xs font-semibold truncate text-neutral-200">{item.title}</h4>
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">{item.format}</span>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1 shrink-0">
          {item.companionPath && onSwitchToAudio && (
            <button
              onClick={() => onSwitchToAudio(item.companionPath!)}
              title="Switch to Audio Edition"
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-md hover:bg-amber-500/20 transition-colors"
            >
              <Headphones className="w-3 h-3" />
              <span>Listen</span>
            </button>
          )}

          {/* Read Aloud Narration Toggle */}
          <button
            onClick={toggleNarration}
            title={isNarrating ? 'Stop Narration' : 'Read Aloud'}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
              isNarrating
                ? 'bg-amber-400 text-neutral-950 font-semibold'
                : 'text-neutral-300 hover:text-white hover:bg-neutral-800'
            }`}
          >
            {isNarrating ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
            <span>{isNarrating ? 'Stop' : 'Read Aloud'}</span>
          </button>

          {/* Font Size Adjust */}
          <button
            onClick={() => setFontSize((s) => (s >= 22 ? 14 : s + 2))}
            title="Adjust font size"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <Type className="w-3.5 h-3.5" />
          </button>

          {/* Bookmark */}
          <button
            onClick={() => onAddBookmark(item.id, currentPage)}
            title="Bookmark this page"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Reader Content Body */}
      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-2xl mx-auto w-full leading-relaxed space-y-4">
        {contentLines.map((sentence, idx) => (
          <p
            key={idx}
            style={{ fontSize: `${fontSize}px` }}
            className={`transition-colors duration-200 ${
              currentSentenceIndex === idx
                ? 'bg-amber-400/20 text-amber-200 px-1 rounded'
                : 'text-neutral-300'
            }`}
          >
            {sentence}
          </p>
        ))}
      </div>

      {/* Bottom Page Navigation */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-900 bg-neutral-950 text-xs text-neutral-500 select-none">
        <button
          onClick={handlePrevPage}
          disabled={currentPage <= 1}
          className="flex items-center gap-1 px-2 py-1 hover:text-neutral-200 disabled:opacity-30 rounded transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Prev</span>
        </button>

        <span className="tabular-nums text-[11px]">
          Page {currentPage} of {totalPages}
        </span>

        <button
          onClick={handleNextPage}
          disabled={currentPage >= totalPages}
          className="flex items-center gap-1 px-2 py-1 hover:text-neutral-200 disabled:opacity-30 rounded transition-colors"
        >
          <span>Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
