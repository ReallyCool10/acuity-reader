import { useState, useEffect, useMemo, useCallback } from 'react';
import { TitleBarControls } from './components/TitleBarControls';
import { SearchBar } from './components/SearchBar';
import { BookCard } from './components/BookCard';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { ReaderView } from './components/ReaderView';
import { SettingsModal } from './components/SettingsModal';
import { FolderPlus, BookOpen } from 'lucide-react';
import type { MediaItem, LibraryState, MediaType } from './types';

export default function App() {
  const [library, setLibrary] = useState<LibraryState>({
    folders: [],
    items: [],
    progress: {},
    bookmarks: {},
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | MediaType>('all');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // Active reading & audio state
  const [activeAudioItem, setActiveAudioItem] = useState<MediaItem | null>(null);
  const [activeBookItem, setActiveBookItem] = useState<MediaItem | null>(null);

  // Persist library state
  const persistLibrary = useCallback((nextState: LibraryState) => {
    setLibrary(nextState);
    window.electronAPI?.saveLibrary(nextState);
  }, []);

  // Automated scanning for a given list of folders
  const scanFolders = useCallback(
    async (foldersToScan: string[]) => {
      if (!window.electronAPI || foldersToScan.length === 0) return;
      setIsScanning(true);

      try {
        const allScannedItems: MediaItem[] = [];
        for (const folder of foldersToScan) {
          const items = await window.electronAPI.scanFolder(folder);
          allScannedItems.push(...items);
        }

        // Deduplicate items by path
        const map = new Map<string, MediaItem>();
        for (const item of allScannedItems) {
          map.set(item.filePath, item);
        }

        const dedupedItems = Array.from(map.values());

        setLibrary((prev) => {
          const updated = {
            ...prev,
            folders: foldersToScan,
            items: dedupedItems,
          };
          window.electronAPI?.saveLibrary(updated);
          return updated;
        });
      } catch (err) {
        console.error('Scan error:', err);
      } finally {
        setIsScanning(false);
      }
    },
    []
  );

  // Initial load from persistent storage
  useEffect(() => {
    async function init() {
      if (window.electronAPI) {
        const saved = await window.electronAPI.loadLibrary();
        if (saved && Array.isArray(saved.items)) {
          setLibrary(saved);
          // If library has folders and items lack covers, refresh in background
          if (saved.folders && saved.folders.length > 0 && saved.items.some((i: MediaItem) => !i.coverUrl)) {
            scanFolders(saved.folders);
          }
        }
      }
    }
    init();
  }, [scanFolders]);

  // Add a new parent directory
  const handleAddFolder = async () => {
    if (!window.electronAPI) return;
    const selected = await window.electronAPI.pickFolder();
    if (selected && !library.folders.includes(selected)) {
      const nextFolders = [...library.folders, selected];
      await scanFolders(nextFolders);
    }
  };

  // Remove a monitored directory
  const handleRemoveFolder = (folderToRemove: string) => {
    const nextFolders = library.folders.filter((f) => f !== folderToRemove);
    const nextItems = library.items.filter((item) => !item.filePath.startsWith(folderToRemove));
    persistLibrary({
      ...library,
      folders: nextFolders,
      items: nextItems,
    });
  };

  // Rescan all monitored folders
  const handleRescan = () => {
    scanFolders(library.folders);
  };

  // Update progress for audio
  const handleAudioProgressUpdate = (itemId: string, currentTime: number, duration: number) => {
    const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
    setLibrary((prev) => {
      const nextProgress = {
        ...prev.progress,
        [itemId]: {
          id: itemId,
          currentTime,
          duration,
          percent,
          lastPlayed: Date.now(),
        },
      };
      const updated = { ...prev, progress: nextProgress };
      window.electronAPI?.saveLibrary(updated);
      return updated;
    });
  };

  // Update progress for book
  const handleBookProgressUpdate = (itemId: string, page: number, percent: number) => {
    setLibrary((prev) => {
      const nextProgress = {
        ...prev.progress,
        [itemId]: {
          id: itemId,
          pdfPage: page,
          percent,
          lastPlayed: Date.now(),
        },
      };
      const updated = { ...prev, progress: nextProgress };
      window.electronAPI?.saveLibrary(updated);
      return updated;
    });
  };

  // Bookmarking
  const handleAddBookmark = (itemId: string, position: number | string) => {
    const newBookmark = {
      id: Math.random().toString(36).substring(2, 9),
      itemId,
      label: `Bookmark at ${typeof position === 'number' ? Math.round(position) + 's' : position}`,
      createdAt: Date.now(),
      position,
    };

    setLibrary((prev) => {
      const existing = prev.bookmarks[itemId] || [];
      const updated = {
        ...prev,
        bookmarks: {
          ...prev.bookmarks,
          [itemId]: [newBookmark, ...existing],
        },
      };
      window.electronAPI?.saveLibrary(updated);
      return updated;
    });
  };

  // Filter & Search
  const filteredItems = useMemo(() => {
    return library.items.filter((item) => {
      // Type filter
      if (activeFilter !== 'all' && item.mediaType !== activeFilter) {
        return false;
      }
      // Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchAuthor = item.author.toLowerCase().includes(q);
        const matchFormat = item.format.toLowerCase().includes(q);
        return matchTitle || matchAuthor || matchFormat;
      }
      return true;
    });
  }, [library.items, activeFilter, searchQuery]);

  const counts = useMemo(() => {
    const books = library.items.filter((i) => i.mediaType === 'book').length;
    const audio = library.items.filter((i) => i.mediaType === 'audio').length;
    return { all: library.items.length, books, audio };
  }, [library.items]);

  return (
    <div className="flex flex-col h-screen w-screen bg-black/40 backdrop-blur-3xl text-neutral-100 overflow-hidden font-sans select-none">
      {/* Windows Media Player style transparent header */}
      <TitleBarControls
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRescan={handleRescan}
        isScanning={isScanning}
      />

      {/* Integrated Search & Filter Controls */}
      <SearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        counts={counts}
      />

      {/* Main Apple Bookshelf Area */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-neutral-400 shadow-md">
              <BookOpen className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-neutral-200">
                {library.folders.length === 0 ? 'Welcome to Acuity Reader' : 'No titles found'}
              </h3>
              <p className="text-xs text-neutral-400 max-w-[260px] leading-relaxed">
                {library.folders.length === 0
                  ? 'Add your audiobooks and e-books folder. Covers and metadata are discovered automatically.'
                  : 'Try adjusting your search query or filter pills above.'}
              </p>
            </div>

            {library.folders.length === 0 && (
              <button
                onClick={handleAddFolder}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white text-neutral-900 rounded-lg hover:bg-neutral-100 active:scale-95 transition-all shadow-md cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
                <span>Select Library Folder</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-6 pt-2 pb-4">
            {filteredItems.map((item) => (
              <BookCard
                key={item.id}
                item={item}
                progress={library.progress[item.id]}
                isPlaying={activeAudioItem?.id === item.id}
                onPlayAudio={(audio) => setActiveAudioItem(audio)}
                onOpenBook={(book) => setActiveBookItem(book)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom Audio Player Bar */}
      {activeAudioItem && (
        <AudioPlayerBar
          item={activeAudioItem}
          initialTime={library.progress[activeAudioItem.id]?.currentTime || 0}
          onClose={() => setActiveAudioItem(null)}
          onProgressUpdate={handleAudioProgressUpdate}
          onAddBookmark={handleAddBookmark}
          onSwitchToCompanion={(companionPath) => {
            const companion = library.items.find((i) => i.filePath === companionPath);
            if (companion) setActiveBookItem(companion);
          }}
        />
      )}

      {/* Dedicated Reader View with prominent Return to Library navigation */}
      {activeBookItem && (
        <ReaderView
          item={activeBookItem}
          initialProgress={library.progress[activeBookItem.id]}
          onClose={() => setActiveBookItem(null)}
          onProgressUpdate={handleBookProgressUpdate}
          onAddBookmark={handleAddBookmark}
          onSwitchToAudio={(companionPath) => {
            const companion = library.items.find((i) => i.filePath === companionPath);
            if (companion) {
              setActiveAudioItem(companion);
              setActiveBookItem(null);
            }
          }}
        />
      )}

      {/* Library Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        folders={library.folders}
        onAddFolder={handleAddFolder}
        onRemoveFolder={handleRemoveFolder}
        onRescan={handleRescan}
        isScanning={isScanning}
        totalItems={library.items.length}
        booksCount={counts.books}
        audioCount={counts.audio}
      />
    </div>
  );
}
