import React, { useRef } from 'react';
import { Check, Layers, Plus, X } from 'lucide-react';
import type { Collection, MediaItem } from '../types';
import { useDismissable } from '../hooks/useDismissable';
import { getCollectionsForItem } from '../lib/collections';

interface AddToCollectionModalProps {
  isOpen: boolean;
  item: MediaItem | null;
  collections: Collection[];
  onClose: () => void;
  onToggleCollection: (collectionId: string, shouldInclude: boolean) => void;
  onCreateNewCollection: () => void;
}

export const AddToCollectionModal: React.FC<AddToCollectionModalProps> = ({
  isOpen,
  item,
  collections,
  onClose,
  onToggleCollection,
  onCreateNewCollection,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDismissable(dialogRef, isOpen, onClose);

  if (!isOpen || !item) return null;

  const containingCollections = getCollectionsForItem(collections, item.id);
  const containingIds = new Set(containingCollections.map((c) => c.id));

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-collection-title"
        className="animate-sheet-in flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--stroke-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-xl)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--stroke-subtle)] px-4 py-3">
          <div className="min-w-0 pr-2">
            <h2 id="add-to-collection-title" className="text-[13px] font-semibold text-[var(--text-primary)]">
              Add to Collection
            </h2>
            <p className="truncate text-[11px] text-[var(--text-tertiary)]" title={item.title}>
              {item.title}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close dialog">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {collections.length === 0 ? (
            <div className="py-6 text-center">
              <Layers className="mx-auto h-8 w-8 text-[var(--text-tertiary)] opacity-50" />
              <p className="mt-2 text-[12px] font-medium text-[var(--text-secondary)]">
                No collections yet
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                Create a series or thematic collection to organize your library.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {collections.map((col) => {
                const isMember = containingIds.has(col.id);
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => onToggleCollection(col.id, !isMember)}
                    className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-raised)]"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
                          {col.name}
                        </span>
                        <span className="rounded-[3px] border border-[var(--stroke-subtle)] bg-[var(--surface-sunken)] px-1 py-0.2 text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">
                          {col.kind}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        {col.memberIds.length} {col.memberIds.length === 1 ? 'member' : 'members'}
                      </span>
                    </div>

                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                        isMember
                          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                          : 'border-[var(--stroke-default)] bg-[var(--surface-base)]'
                      }`}
                    >
                      {isMember && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="border-t border-[var(--stroke-subtle)] bg-[var(--surface-sunken)]/40 p-2.5">
          <button
            type="button"
            onClick={() => {
              onClose();
              onCreateNewCollection();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--stroke-default)] py-2 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Plus className="h-3.5 w-3.5" />
            New Collection
          </button>
        </footer>
      </div>
    </div>
  );
};
