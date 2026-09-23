import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FolderPlus, Layers, Plus, SearchX } from 'lucide-react';
import { TitleBarControls } from './components/TitleBarControls';
import { LibraryToolbar } from './components/LibraryToolbar';
import { ContinueShelf } from './components/ContinueShelf';
import { BookCard } from './components/BookCard';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { ReaderView } from './components/ReaderView';
import { SettingsModal } from './components/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CollectionCard } from './components/CollectionCard';
import { CollectionDetailView } from './components/CollectionDetailView';
import { CollectionModal } from './components/CollectionModal';
import { AddToCollectionModal } from './components/AddToCollectionModal';
import { SuggestedSeriesBanner } from './components/SuggestedSeriesBanner';
import { usePersistentState, useThrottledCallback } from './hooks/usePersistentState';
import { findSiblingTracks } from './lib/playlist';
import {
  createCollection,
  updateCollection,
  addMemberToCollection,
  removeMemberFromCollection,
  detectSeriesSuggestions,
  resolveCollectionMembers,
  getUnresolvedMemberCount,
  type SeriesSuggestion,
} from './lib/collections';
import { groupMultiFileAudiobooks, resolveAudiobookProgress } from './lib/audiobookGrouping';
import type { AppTheme, Bookmark, Collection, CollectionKind, LibraryState, MediaItem, MediaType, SortKey } from './types';

const EMPTY_LIBRARY: LibraryState = { folders: [], items: [], progress: {}, bookmarks: {}, collections: [] };

/** Titles at least this far in — but not finished — qualify for the Continue shelf. */
const CONTINUE_MIN_PERCENT = 1;
const CONTINUE_MAX_PERCENT = 98;
const CONTINUE_LIMIT = 12;

export default function App() {
  const [library, setLibrary] = useState<LibraryState>(EMPTY_LIBRARY);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | MediaType | 'collections'>('all');
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [addToCollectionItem, setAddToCollectionItem] = useState<MediaItem | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = usePersistentState<SortKey>('acuity.sortKey', 'recent');
  const [appTheme, setAppTheme] = usePersistentState<AppTheme>('acuity.app.theme', 'system');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'theme' | 'folders' | 'mcp'>('folders');
  const [isScanning, setIsScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);

  const handleOpenSettings = (tab: 'theme' | 'folders' | 'mcp' = 'folders') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  const [activeAudioItem, setActiveAudioItem] = useState<MediaItem | null>(null);
  const [isAudioFullScreen, setIsAudioFullScreen] = useState(false);
  const [activeBookItem, setActiveBookItem] = useState<MediaItem | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);

  /*
   * One write path for the whole library.
   *
   * Throttling here plus the debounce in the main process means continuous
   * playback costs about one disk write per second, rather than one per
   * `timeupdate` event — each of which re-serialised the entire library.
   */
  const saveLibrary = useThrottledCallback((state: LibraryState) => {
    void window.electronAPI?.saveLibrary(state);
  }, 1000);

  const updateLibrary = useCallback(
    (updater: (prev: LibraryState) => LibraryState) => {
      setLibrary((prev) => {
        const next = updater(prev);
        saveLibrary(next);
        return next;
      });
    },
    [saveLibrary]
  );

  /* ---------------------------------------------------------- scanning */

  useEffect(() => {
    const unbind = window.electronAPI?.onScanProgress(({ count }) => setScanCount(count));
    return () => unbind?.();
  }, []);

  /* --------------------------------------------------- system theme & mica */

  useEffect(() => {
    function applyTheme(isDark: boolean, accentColor: string | null) {
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }

      if (accentColor) {
        document.documentElement.style.setProperty('--system-accent', accentColor);
        document.documentElement.setAttribute('data-accent-override', 'true');
      } else {
        document.documentElement.removeAttribute('data-accent-override');
      }
    }

    void window.electronAPI?.setThemeSource?.(appTheme).then((info) => {
      if (info) {
        applyTheme(info.isDark, info.accentColor);
      }
    });

    const unbind = window.electronAPI?.onThemeChanged?.((info) => {
      if (appTheme === 'system') {
        applyTheme(info.isDark, info.accentColor);
      }
    });

    if (!window.electronAPI) {
      const isDark =
        appTheme === 'system'
          ? (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) ?? true
          : appTheme === 'dark';
      applyTheme(isDark, null);
    }

    return () => unbind?.();
  }, [appTheme]);

  const scanFolders = useCallback(
    async (foldersToScan: string[]) => {
      if (!window.electronAPI || foldersToScan.length === 0) return;

      setIsScanning(true);
      setScanCount(0);

      try {
        const scanned: MediaItem[] = [];
        for (const folder of foldersToScan) {
          scanned.push(...(await window.electronAPI.scanFolder(folder)));
        }

        const deduped = Array.from(new Map(scanned.map((item) => [item.filePath, item])).values());
        const grouped = groupMultiFileAudiobooks(deduped);

        updateLibrary((prev) => ({ ...prev, folders: foldersToScan, items: grouped }));
      } catch (err) {
        console.error('Library scan failed:', err);
      } finally {
        setIsScanning(false);
        setScanCount(0);
      }
    },
    [updateLibrary]
  );

  useEffect(() => {
    async function init() {
      const saved = await window.electronAPI?.loadLibrary();
      if (!saved || !Array.isArray(saved.items)) return;

      const grouped = groupMultiFileAudiobooks(saved.items);
      setLibrary({ ...EMPTY_LIBRARY, ...saved, items: grouped });

      // Initial scan if folders are configured but library items are empty.
      if (saved.folders?.length && saved.items.length === 0) {
        void scanFolders(saved.folders);
      }
    }
    void init();
  }, [scanFolders]);

  /* ----------------------------------------------------------- folders */

  const handleAddFolder = useCallback(async () => {
    const selected = await window.electronAPI?.pickFolder();
    if (selected && !library.folders.includes(selected)) {
      await scanFolders([...library.folders, selected]);
    }
  }, [library.folders, scanFolders]);

  const handleRemoveFolder = useCallback(
    (folderToRemove: string) => {
      /*
       * Match on a path boundary, not a bare prefix: a plain startsWith would
       * also strip "/Books Archive" when removing "/Books".
       */
      const prefix = folderToRemove.replace(/[/\\]+$/, '');
      const isInside = (filePath: string) => {
        if (filePath === prefix) return true;
        const next = filePath.charAt(prefix.length);
        return filePath.startsWith(prefix) && (next === '/' || next === '\\');
      };

      updateLibrary((prev) => ({
        ...prev,
        folders: prev.folders.filter((folder) => folder !== folderToRemove),
        items: prev.items.filter((item) => !isInside(item.filePath)),
      }));
    },
    [updateLibrary]
  );

  /* ---------------------------------------------------------- progress */

  const handleAudioProgress = useCallback(
    (itemId: string, currentTime: number, duration: number) => {
      updateLibrary((prev) => ({
        ...prev,
        progress: {
          ...prev.progress,
          [itemId]: {
            id: itemId,
            currentTime,
            duration,
            percent: duration > 0 ? (currentTime / duration) * 100 : 0,
            lastPlayed: Date.now(),
          },
        },
      }));
    },
    [updateLibrary]
  );

  const handleBookProgress = useCallback(
    (itemId: string, chapterIndex: number, percent: number, scroll: number) => {
      updateLibrary((prev) => ({
        ...prev,
        progress: {
          ...prev.progress,
          [itemId]: {
            id: itemId,
            chapterIndex,
            chapterScroll: scroll,
            percent,
            lastPlayed: Date.now(),
          },
        },
      }));
    },
    [updateLibrary]
  );

  const handleMetadataUpdate = useCallback(
    (itemId: string, meta: { title?: string; author?: string }) => {
      if (!meta.title) return;
      updateLibrary((prev) => {
        let changed = false;
        const items = prev.items.map((it) => {
          if (it.id === itemId) {
            const nextTitle = meta.title || it.title;
            const nextAuthor = meta.author || it.author;
            if (nextTitle !== it.title || nextAuthor !== it.author) {
              changed = true;
              return { ...it, title: nextTitle, author: nextAuthor };
            }
          }
          return it;
        });
        if (!changed) return prev;
        return { ...prev, items };
      });
      setActiveBookItem((prev) => {
        if (!prev || prev.id !== itemId) return prev;
        return { ...prev, title: meta.title || prev.title, author: meta.author || prev.author };
      });
    },
    [updateLibrary]
  );

  const addBookmark = useCallback(
    (itemId: string, position: number, label: string, excerpt?: string) => {
      const bookmark: Bookmark = {
        id: `${itemId}-${Date.now()}`,
        itemId,
        label,
        createdAt: Date.now(),
        position,
        excerpt,
      };

      updateLibrary((prev) => ({
        ...prev,
        bookmarks: { ...prev.bookmarks, [itemId]: [bookmark, ...(prev.bookmarks[itemId] ?? [])] },
      }));
    },
    [updateLibrary]
  );

  const removeBookmark = useCallback(
    (itemId: string, bookmarkId: string) => {
      updateLibrary((prev) => ({
        ...prev,
        bookmarks: {
          ...prev.bookmarks,
          [itemId]: (prev.bookmarks[itemId] ?? []).filter((b) => b.id !== bookmarkId),
        },
      }));
    },
    [updateLibrary]
  );

  /* ------------------------------------------------------------ opening */

  const openItem = useCallback((item: MediaItem) => {
    if (item.mediaType === 'audio') {
      setActiveAudioItem(item);
      setIsAudioFullScreen(true);
    } else {
      setActiveBookItem(item);
    }
  }, []);

  const findByPath = useCallback(
    (filePath: string) => library.items.find((item) => item.filePath === filePath),
    [library.items]
  );

  const siblingTracks = useMemo(() => {
    if (!activeAudioItem) return { playlist: [], currentIndex: 0, prevItem: null, nextItem: null };
    return findSiblingTracks(activeAudioItem, library.items);
  }, [activeAudioItem, library.items]);

  const handleNextTrack = useCallback(() => {
    if (siblingTracks.nextItem) {
      setActiveAudioItem(siblingTracks.nextItem);
    }
  }, [siblingTracks.nextItem]);

  const handlePrevTrack = useCallback(() => {
    if (siblingTracks.prevItem) {
      setActiveAudioItem(siblingTracks.prevItem);
    }
  }, [siblingTracks.prevItem]);

  /* --------------------------------------------------------- filtering */

  const counts = useMemo(
    () => ({
      all: library.items.length,
      books: library.items.filter((item) => item.mediaType === 'book').length,
      audio: library.items.filter((item) => item.mediaType === 'audio').length,
      collections: (library.collections || []).length,
    }),
    [library.items, library.collections]
  );

  const visibleCollections = useMemo(() => {
    const cols = library.collections || [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return cols;
    return cols.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.description && c.description.toLowerCase().includes(query))
    );
  }, [library.collections, searchQuery]);

  const suggestedSeries = useMemo(() => {
    return detectSeriesSuggestions(library.items, library.collections || []).filter(
      (s) => !dismissedSuggestions.has(s.name)
    );
  }, [library.items, library.collections, dismissedSuggestions]);

  const visibleItems = useMemo(() => {
    if (activeFilter === 'collections') return [];
    const query = searchQuery.trim().toLowerCase();

    const filtered = library.items.filter((item) => {
      if (activeFilter !== 'all' && item.mediaType !== activeFilter) return false;
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.author.toLowerCase().includes(query) ||
        item.format.toLowerCase().includes(query)
      );
    });

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'title':
          return collator.compare(a.title, b.title);
        case 'author':
          return collator.compare(a.author, b.author) || collator.compare(a.title, b.title);
        case 'added':
          return b.dateAdded - a.dateAdded;
        case 'recent':
        default: {
          // Unplayed titles sort after everything that has been opened.
          const aPlayed = (resolveAudiobookProgress(a, library.progress) ?? library.progress[a.id])?.lastPlayed ?? 0;
          const bPlayed = (resolveAudiobookProgress(b, library.progress) ?? library.progress[b.id])?.lastPlayed ?? 0;
          if (aPlayed !== bPlayed) return bPlayed - aPlayed;
          return collator.compare(a.title, b.title);
        }
      }
    });
  }, [library.items, library.progress, activeFilter, searchQuery, sortKey]);

  const continueItems = useMemo(() => {
    if (searchQuery.trim() || activeFilter !== 'all') return [];

    return library.items
      .filter((item) => {
        const progress = resolveAudiobookProgress(item, library.progress) ?? library.progress[item.id];
        return (
          progress &&
          progress.percent > CONTINUE_MIN_PERCENT &&
          progress.percent < CONTINUE_MAX_PERCENT
        );
      })
      .sort((a, b) => {
        const aPlayed = (resolveAudiobookProgress(a, library.progress) ?? library.progress[a.id])?.lastPlayed ?? 0;
        const bPlayed = (resolveAudiobookProgress(b, library.progress) ?? library.progress[b.id])?.lastPlayed ?? 0;
        return bPlayed - aPlayed;
      })
      .slice(0, CONTINUE_LIMIT);
  }, [library.items, library.progress, searchQuery, activeFilter]);

  /* -------------------------------------------------------- collections */

  const handleCreateOrUpdateCollection = useCallback(
    (data: { name: string; kind: CollectionKind; description?: string }) => {
      if (editingCollection) {
        updateLibrary((prev) => ({
          ...prev,
          collections: (prev.collections || []).map((c) =>
            c.id === editingCollection.id ? updateCollection(c, data) : c
          ),
        }));
      } else {
        const newCol = createCollection(data.name, data.kind, [], data.description);
        updateLibrary((prev) => ({
          ...prev,
          collections: [...(prev.collections || []), newCol],
        }));
      }
      setIsCollectionModalOpen(false);
      setEditingCollection(null);
    },
    [editingCollection, updateLibrary]
  );

  const handleDeleteCollection = useCallback(
    (collectionId: string) => {
      updateLibrary((prev) => ({
        ...prev,
        collections: (prev.collections || []).filter((c) => c.id !== collectionId),
      }));
      if (activeCollectionId === collectionId) {
        setActiveCollectionId(null);
      }
    },
    [activeCollectionId, updateLibrary]
  );

  const handleUpdateCollection = useCallback(
    (updated: Collection) => {
      updateLibrary((prev) => ({
        ...prev,
        collections: (prev.collections || []).map((c) => (c.id === updated.id ? updated : c)),
      }));
    },
    [updateLibrary]
  );

  const handleToggleItemCollection = useCallback(
    (collectionId: string, shouldInclude: boolean) => {
      if (!addToCollectionItem) return;
      const itemId = addToCollectionItem.id;
      updateLibrary((prev) => {
        const cols = (prev.collections || []).map((c) => {
          if (c.id !== collectionId) return c;
          if (shouldInclude) {
            return addMemberToCollection(c, itemId);
          } else {
            return removeMemberFromCollection(c, itemId);
          }
        });
        return { ...prev, collections: cols };
      });
    },
    [addToCollectionItem, updateLibrary]
  );

  const handleAcceptSuggestedSeries = useCallback(
    (suggestion: SeriesSuggestion) => {
      const newCol = createCollection(
        suggestion.name,
        'series',
        suggestion.memberIds,
        `Series auto-detected from ${suggestion.name}`
      );
      updateLibrary((prev) => ({
        ...prev,
        collections: [...(prev.collections || []), newCol],
      }));
      setDismissedSuggestions((prev) => new Set([...prev, suggestion.name]));
    },
    [updateLibrary]
  );

  const handleDismissSuggestedSeries = useCallback((name: string) => {
    setDismissedSuggestions((prev) => new Set([...prev, name]));
  }, []);

  /* --------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.isContentEditable;

      // Ctrl/Cmd+F focuses search from anywhere.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (isTyping) {
        if (event.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }

      if (event.key === 'Escape') {
        if (isAudioFullScreen) {
          setIsAudioFullScreen(false);
          return;
        }
        if (activeCollectionId) {
          setActiveCollectionId(null);
          return;
        }
        if (isCollectionModalOpen) {
          setIsCollectionModalOpen(false);
          setEditingCollection(null);
          return;
        }
        if (addToCollectionItem) {
          setAddToCollectionItem(null);
          return;
        }
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
          return;
        }
        if (activeBookItem) {
          setActiveBookItem(null);
          return;
        }
      }

      // Space toggles playback, matching every media player; only when the
      // reader is closed, where the key means "scroll" instead.
      if (event.code === 'Space' && activeAudioItem && !activeBookItem) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('acuity:toggle-play'));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeAudioItem,
    isAudioFullScreen,
    activeBookItem,
    isSettingsOpen,
    activeCollectionId,
    isCollectionModalOpen,
    addToCollectionItem,
  ]);

  const hasLibrary = library.items.length > 0;
  const activeCollection = (library.collections || []).find((c) => c.id === activeCollectionId);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--surface-base)] backdrop-blur-3xl">
      <TitleBarControls
        onOpenSettings={handleOpenSettings}
        onRescan={() => void scanFolders(library.folders)}
        isScanning={isScanning}
        scanCount={scanCount}
      />

      {hasLibrary && (
        <LibraryToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          activeFilter={activeFilter}
          onFilterChange={(filter) => {
            setActiveFilter(filter);
            setActiveCollectionId(null);
          }}
          sortKey={sortKey}
          onSortChange={setSortKey}
          counts={counts}
          searchRef={searchRef}
        />
      )}

      {activeCollection ? (
        <main className="flex-1 overflow-hidden">
          <CollectionDetailView
            collection={activeCollection}
            libraryItems={library.items}
            progress={library.progress}
            activeAudioId={activeAudioItem?.id}
            onBack={() => setActiveCollectionId(null)}
            onOpenItem={openItem}
            onEditCollection={(col) => {
              setEditingCollection(col);
              setIsCollectionModalOpen(true);
            }}
            onDeleteCollection={handleDeleteCollection}
            onUpdateCollection={handleUpdateCollection}
          />
        </main>
      ) : (
        <main className="flex-1 overflow-y-auto px-4 pb-6" style={{ scrollbarGutter: 'stable' }}>
          {!hasLibrary && !isScanning && (
            <EmptyState
              icon={<BookOpen className="h-6 w-6" />}
              title="Welcome to Acuity Reader"
              body="Point Acuity at the folder holding your books and audiobooks. Covers and metadata are read automatically."
              action={{ label: 'Choose a folder', onClick: () => void handleAddFolder() }}
            />
          )}

          {!hasLibrary && isScanning && <LibrarySkeleton />}

          {hasLibrary && activeFilter === 'collections' && (
            <div className="space-y-4 pt-1">
              <div className="flex items-center justify-between">
                <h2 className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]">
                  Collections & Series
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCollection(null);
                    setIsCollectionModalOpen(true);
                  }}
                  className="button-secondary flex items-center gap-1.5 text-[12px]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Collection
                </button>
              </div>

              <SuggestedSeriesBanner
                suggestions={suggestedSeries}
                onAccept={handleAcceptSuggestedSeries}
                onDismiss={handleDismissSuggestedSeries}
              />

              {visibleCollections.length === 0 ? (
                <EmptyState
                  icon={<Layers className="h-6 w-6" />}
                  title={searchQuery.trim() ? 'No collections match' : 'No collections yet'}
                  body={
                    searchQuery.trim()
                      ? 'Try a different search term.'
                      : 'Organize your reading into series and custom thematic collections spanning books and audiobooks.'
                  }
                  action={
                    searchQuery.trim()
                      ? undefined
                      : {
                          label: 'New Collection',
                          onClick: () => {
                            setEditingCollection(null);
                            setIsCollectionModalOpen(true);
                          },
                        }
                  }
                />
              ) : (
                <div className="library-grid">
                  {visibleCollections.map((col) => {
                    const resolvedWorks = resolveCollectionMembers(col, library.items);
                    const unresolvedCount = getUnresolvedMemberCount(col, library.items);
                    return (
                      <CollectionCard
                        key={col.id}
                        collection={col}
                        resolvedWorks={resolvedWorks}
                        unresolvedCount={unresolvedCount}
                        onClick={() => setActiveCollectionId(col.id)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {hasLibrary && activeFilter !== 'collections' && (
            <>
              <ContinueShelf
                items={continueItems}
                progress={library.progress}
                activeAudioId={activeAudioItem?.id}
                onOpen={openItem}
              />

              {visibleItems.length === 0 ? (
                <EmptyState
                  icon={<SearchX className="h-6 w-6" />}
                  title="Nothing matches"
                  body="Try a different search term, or switch the filter back to All."
                />
              ) : (
                <>
                  {continueItems.length > 0 && (
                    <h2 className="mb-2.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]">
                      All titles
                    </h2>
                  )}
                  <div className="library-grid">
                    {visibleItems.map((item) => (
                      <BookCard
                        key={item.id}
                        item={item}
                        progress={resolveAudiobookProgress(item, library.progress) ?? library.progress[item.id]}
                        isPlaying={activeAudioItem?.id === item.id}
                        onOpen={openItem}
                        onAddToCollection={(it) => setAddToCollectionItem(it)}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      )}

      {activeAudioItem && (
        <AudioPlayerBar
          key={activeAudioItem.id}
          item={activeAudioItem}
          isFullScreen={isAudioFullScreen}
          onFullScreenChange={setIsAudioFullScreen}
          initialTime={(resolveAudiobookProgress(activeAudioItem, library.progress) ?? library.progress[activeAudioItem.id])?.currentTime ?? 0}
          bookmarks={library.bookmarks[activeAudioItem.id] ?? []}
          onClose={() => {
            setIsAudioFullScreen(false);
            setActiveAudioItem(null);
          }}
          onProgressUpdate={handleAudioProgress}
          onAddBookmark={(itemId, time) =>
            addBookmark(itemId, time, `Bookmark at ${Math.round(time / 60)} min`)
          }
          onRemoveBookmark={(bookmarkId) => removeBookmark(activeAudioItem.id, bookmarkId)}
          onNextTrack={siblingTracks.nextItem ? handleNextTrack : undefined}
          onPrevTrack={siblingTracks.prevItem ? handlePrevTrack : undefined}
          hasNextTrack={Boolean(siblingTracks.nextItem)}
          hasPrevTrack={Boolean(siblingTracks.prevItem)}
          onSwitchToCompanion={(companionPath) => {
            setIsAudioFullScreen(false);
            const companion = findByPath(companionPath);
            if (companion) setActiveBookItem(companion);
          }}
        />
      )}

      {activeBookItem && (
        <ErrorBoundary
          fallbackTitle="Could not display book"
          fallbackMessage="An unexpected render error occurred while viewing this book."
          onReset={() => setActiveBookItem(null)}
          actionLabel="Return to Library"
        >
          <ReaderView
            key={activeBookItem.id}
            item={activeBookItem}
            initialProgress={library.progress[activeBookItem.id]}
            bookmarks={library.bookmarks[activeBookItem.id] ?? []}
            onClose={() => setActiveBookItem(null)}
            onProgressUpdate={handleBookProgress}
            onMetadataUpdate={handleMetadataUpdate}
            onAddBookmark={(itemId, chapterIndex, excerpt) =>
              addBookmark(itemId, chapterIndex, `Chapter ${chapterIndex + 1}`, excerpt)
            }
            onRemoveBookmark={(bookmarkId) => removeBookmark(activeBookItem.id, bookmarkId)}
            onSwitchToAudio={(companionPath) => {
              const companion = findByPath(companionPath);
              if (companion) {
                setActiveAudioItem(companion);
                setActiveBookItem(null);
              }
            }}
          />
        </ErrorBoundary>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsTab}
        onClose={() => setIsSettingsOpen(false)}
        appTheme={appTheme}
        onThemeChange={setAppTheme}
        folders={library.folders}
        onAddFolder={() => void handleAddFolder()}
        onRemoveFolder={handleRemoveFolder}
        onRescan={() => void scanFolders(library.folders)}
        isScanning={isScanning}
        totalItems={counts.all}
        booksCount={counts.books}
        audioCount={counts.audio}
      />

      <CollectionModal
        isOpen={isCollectionModalOpen}
        collection={editingCollection}
        onClose={() => {
          setIsCollectionModalOpen(false);
          setEditingCollection(null);
        }}
        onSave={handleCreateOrUpdateCollection}
      />

      <AddToCollectionModal
        isOpen={Boolean(addToCollectionItem)}
        item={addToCollectionItem}
        collections={library.collections || []}
        onClose={() => setAddToCollectionItem(null)}
        onToggleCollection={handleToggleItemCollection}
        onCreateNewCollection={() => {
          setIsCollectionModalOpen(true);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- subviews */

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}> = ({ icon, title, body, action }) => (
  <div className="animate-fade-rise flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
    <div className="surface-raised flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] text-[var(--text-tertiary)]">
      {icon}
    </div>
    <div className="space-y-1.5">
      <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h2>
      <p className="max-w-[280px] text-[12px] leading-relaxed text-[var(--text-tertiary)]">{body}</p>
    </div>
    {action && (
      <button
        type="button"
        onClick={action.onClick}
        className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--text-primary)] px-4 py-2 text-[12px] font-semibold text-[var(--text-inverse)] shadow-[var(--shadow-md)] transition-transform duration-150 ease-[var(--ease-out)] hover:brightness-105 active:scale-[0.97]"
      >
        <FolderPlus className="h-3.5 w-3.5" />
        {action.label}
      </button>
    )}
  </div>
);

/** Placeholder grid shown during the very first scan, so the window is never blank. */
const LibrarySkeleton: React.FC = () => (
  <div className="library-grid pt-2" aria-hidden="true">
    {[...Array(12)].map((_, index) => (
      <div key={index}>
        <div className="skeleton aspect-[1/1.5] w-full rounded-[3px_var(--radius-md)_var(--radius-md)_3px]" />
        <div className="skeleton mt-2.5 h-3 w-4/5" />
        <div className="skeleton mt-1.5 h-2.5 w-3/5" />
      </div>
    ))}
  </div>
);
