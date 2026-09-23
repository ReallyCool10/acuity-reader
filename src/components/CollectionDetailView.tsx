import React, { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Headphones,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Collection, MediaItem, ProgressItem } from '../types';
import { cleanTitleString } from '../lib/metadata';
import {
  moveMemberInCollection,
  removeMemberFromCollection,
  resolveCollectionMembers,
  getUnresolvedMemberCount,
  type CollectionWorkItem,
} from '../lib/collections';
import { coverUrl } from '../lib/media';
import { resolveAudiobookProgress } from '../lib/audiobookGrouping';
import { CollectionMemberPickerModal } from './CollectionMemberPickerModal';

interface CollectionDetailViewProps {
  collection: Collection;
  libraryItems: MediaItem[];
  progress: Record<string, ProgressItem>;
  activeAudioId?: string;
  onBack: () => void;
  onOpenItem: (item: MediaItem) => void;
  onEditCollection: (collection: Collection) => void;
  onDeleteCollection: (collectionId: string) => void;
  onUpdateCollection: (updated: Collection) => void;
}

export const CollectionDetailView: React.FC<CollectionDetailViewProps> = ({
  collection,
  libraryItems,
  progress,
  activeAudioId,
  onBack,
  onOpenItem,
  onEditCollection,
  onDeleteCollection,
  onUpdateCollection,
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolvedWorks = resolveCollectionMembers(collection, libraryItems);
  const unresolvedCount = getUnresolvedMemberCount(collection, libraryItems);
  const isSeries = collection.kind === 'series';

  const handleToggleMember = (itemId: string, shouldInclude: boolean) => {
    let updated: Collection;
    if (shouldInclude) {
      if (collection.memberIds.includes(itemId)) return;
      updated = {
        ...collection,
        memberIds: [...collection.memberIds, itemId],
        updatedAt: Date.now(),
      };
    } else {
      updated = removeMemberFromCollection(collection, itemId);
    }
    onUpdateCollection(updated);
  };

  const handleRemoveWork = (work: CollectionWorkItem, event: React.MouseEvent) => {
    event.stopPropagation();
    // Remove all member IDs associated with this work (both book and audio if paired)
    let updated = collection;
    for (const mid of work.memberIds) {
      updated = removeMemberFromCollection(updated, mid);
    }
    onUpdateCollection(updated);
  };

  const handleMoveWork = (
    work: CollectionWorkItem,
    direction: 'up' | 'down',
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    // Move the primary member ID within collection.memberIds
    const primaryId = work.primaryItem.id;
    const updated = moveMemberInCollection(collection, primaryId, direction);
    onUpdateCollection(updated);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Detail Header */}
      <div className="border-b border-[var(--stroke-subtle)] bg-[var(--surface-sunken)]/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="icon-button"
              aria-label="Back to library"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-semibold text-[var(--text-primary)]">
                  {collection.name}
                </h1>
                <span className="rounded-[4px] border border-[var(--stroke-subtle)] bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                  {isSeries ? 'Series' : 'Theme'}
                </span>
              </div>
              {collection.description && (
                <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                  {collection.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              className="button-secondary flex items-center gap-1.5 text-[12px]"
            >
              <Plus className="h-3.5 w-3.5" />
              Manage Books
            </button>
            <button
              type="button"
              onClick={() => onEditCollection(collection)}
              className="icon-button"
              title="Edit collection"
              aria-label="Edit collection"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-red-500/30 bg-red-950/20 px-2 py-1">
                <span className="text-[11px] text-red-300">Delete collection?</span>
                <button
                  type="button"
                  onClick={() => onDeleteCollection(collection.id)}
                  className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-red-400 hover:bg-red-500/20"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="icon-button text-red-400/80 hover:text-red-400"
                title="Delete collection"
                aria-label="Delete collection"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Offline items warning */}
        {unresolvedCount > 0 && (
          <div className="mt-2.5 rounded-[var(--radius-md)] border border-[var(--stroke-subtle)] bg-[var(--surface-raised)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--accent)]">Notice:</span> {unresolvedCount}{' '}
            {unresolvedCount === 1 ? 'item is' : 'items are'} currently offline (e.g. unplugged drive).
            They remain saved in your collection and will reappear automatically when connected.
          </div>
        )}
      </div>

      {/* Detail Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5" style={{ scrollbarGutter: 'stable' }}>
        {resolvedWorks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[var(--text-tertiary)]">
              <Layers className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">
              No books in this collection yet
            </h3>
            <p className="mt-1 max-w-sm text-[12px] text-[var(--text-tertiary)]">
              Add books or audiobooks from your library to start curating this collection.
            </p>
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              className="button-primary mt-4 flex items-center gap-1.5 text-[12.5px]"
            >
              <Plus className="h-4 w-4" />
              Add Books to Collection
            </button>
          </div>
        ) : (
          <div className="library-grid">
            {resolvedWorks.map((work, index) => {
              const item = work.primaryItem;
              const url = coverUrl(item);
              const itemProgress =
                (resolveAudiobookProgress(item, progress) ?? progress[item.id])?.percent ?? 0;
              const isPlaying =
                Boolean(activeAudioId) &&
                (activeAudioId === item.id ||
                  (work.audioItem !== undefined && activeAudioId === work.audioItem.id));

              return (
                <div key={work.orderIndex} className="book-card group relative">
                  <div
                    className="book-cover cursor-pointer"
                    data-media-type={item.mediaType}
                    onClick={() => {
                      if (work.bookItem) onOpenItem(work.bookItem);
                      else onOpenItem(item);
                    }}
                  >
                    {url ? (
                      <>
                        <img
                          src={url}
                          alt=""
                          aria-hidden="true"
                          className="cover-backdrop"
                        />
                        <img
                          src={url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="cover-image"
                          data-loaded="true"
                        />
                      </>
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-[var(--surface-raised)] p-3 text-center">
                        <BookOpen className="h-8 w-8 text-[var(--text-tertiary)] opacity-40" />
                        <span className="mt-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                          {item.format}
                        </span>
                      </div>
                    )}

                    {/* Order Badge (surfaced only for series) */}
                    {isSeries && (
                      <span className="absolute left-2 top-2 z-[3] flex h-5 min-w-[20px] items-center justify-center rounded-[4px] border border-white/20 bg-black/75 px-1.5 text-[10px] font-bold text-white shadow-md backdrop-blur-md">
                        #{work.orderIndex}
                      </span>
                    )}

                    {/* Dual format badge */}
                    {work.isDual && (
                      <span
                        className="absolute right-2 top-2 z-[3] rounded-[4px] border border-white/15 bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-md"
                        title="Both text and audio editions available"
                      >
                        Dual
                      </span>
                    )}

                    {/* Progress Bar */}
                    {itemProgress > 0 && (
                      <div className="absolute inset-x-0 bottom-0 z-[3] h-[3px] bg-black/55">
                        <div
                          className="h-full rounded-r-full"
                          style={{
                            width: `${Math.min(100, Math.max(2, itemProgress))}%`,
                            background:
                              item.mediaType === 'audio'
                                ? 'var(--accent)'
                                : 'var(--accent-read)',
                          }}
                        />
                      </div>
                    )}

                    {/* Series Reordering Controls overlay */}
                    {isSeries && (
                      <div className="absolute right-2 top-8 z-[4] flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {index > 0 && (
                          <button
                            type="button"
                            onClick={(e) => handleMoveWork(work, 'up', e)}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-md hover:bg-black"
                            title="Move up in series"
                            aria-label="Move up in series"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {index < resolvedWorks.length - 1 && (
                          <button
                            type="button"
                            onClick={(e) => handleMoveWork(work, 'down', e)}
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-md hover:bg-black"
                            title="Move down in series"
                            aria-label="Move down in series"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Quick remove button */}
                    <button
                      type="button"
                      onClick={(e) => handleRemoveWork(work, e)}
                      className="absolute left-2 bottom-2 z-[4] flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur-md transition-opacity hover:bg-red-600 hover:text-white group-hover:opacity-100"
                      title="Remove from collection"
                      aria-label="Remove from collection"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Metadata and Format Action Buttons */}
                  <div className="mt-2.5 min-w-0">
                    <h4
                      className="line-clamp-2 text-[12.5px] font-medium leading-snug text-[var(--text-primary)]"
                      title={cleanTitleString(item.title) || item.title}
                    >
                      {cleanTitleString(item.title) || item.title}
                    </h4>
                    {item.author && (
                      <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]" title={item.author}>
                        {item.author}
                      </p>
                    )}

                    {/* Read & Listen buttons for dual works or single works */}
                    <div className="mt-2 flex items-center gap-1.5">
                      {work.bookItem && (
                        <button
                          type="button"
                          onClick={() => onOpenItem(work.bookItem!)}
                          className="flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-md)] border border-[var(--stroke-subtle)] bg-[var(--surface-raised)] py-1 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          <BookOpen className="h-3 w-3" />
                          Read
                        </button>
                      )}
                      {work.audioItem && (
                        <button
                          type="button"
                          onClick={() => onOpenItem(work.audioItem!)}
                          className={`flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-md)] border py-1 text-[11px] font-medium transition-colors ${
                            isPlaying
                              ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
                              : 'border-[var(--stroke-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                          }`}
                        >
                          <Headphones className="h-3 w-3" />
                          {isPlaying ? 'Playing' : 'Listen'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Member picker modal */}
      {isPickerOpen && (
        <CollectionMemberPickerModal
          isOpen={isPickerOpen}
          collection={collection}
          libraryItems={libraryItems}
          onClose={() => setIsPickerOpen(false)}
          onToggleMember={handleToggleMember}
        />
      )}
    </div>
  );
};
