import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, ListOrdered, X } from 'lucide-react';
import type { Collection, CollectionKind } from '../types';
import { useDismissable } from '../hooks/useDismissable';

interface CollectionModalProps {
  isOpen: boolean;
  collection?: Collection | null;
  onClose: () => void;
  onSave: (data: { name: string; kind: CollectionKind; description?: string }) => void;
}

export const CollectionModal: React.FC<CollectionModalProps> = ({
  isOpen,
  collection,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CollectionKind>('series');
  const [description, setDescription] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (collection) {
        setName(collection.name);
        setKind(collection.kind);
        setDescription(collection.description || '');
      } else {
        setName('');
        setKind('series');
        setDescription('');
      }
    }
  }, [isOpen, collection]);

  useDismissable(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      kind,
      description: description.trim() || undefined,
    });
    onClose();
  };

  const isEditing = Boolean(collection);

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-modal-title"
        className="animate-sheet-in flex w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--stroke-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-xl)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--stroke-subtle)] px-5 py-3.5">
          <h2 id="collection-modal-title" className="text-[13.5px] font-semibold text-[var(--text-primary)]">
            {isEditing ? 'Edit Collection' : 'New Collection'}
          </h2>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close dialog">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Name Field */}
          <div className="space-y-1.5">
            <label htmlFor="collection-name" className="text-[12px] font-medium text-[var(--text-primary)]">
              Collection Name
            </label>
            <input
              id="collection-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Expanse or High Fantasy"
              autoFocus
              required
              className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--stroke-default)] bg-[var(--surface-raised)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors focus:border-[var(--accent-ring)] focus:outline-none"
            />
          </div>

          {/* Kind Selector */}
          <div className="space-y-1.5">
            <span className="text-[12px] font-medium text-[var(--text-primary)]">
              Collection Type
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setKind('series')}
                aria-pressed={kind === 'series'}
                className={`flex flex-col items-start gap-1 rounded-[var(--radius-lg)] border p-3 text-left transition-all ${
                  kind === 'series'
                    ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                    : 'border-[var(--stroke-subtle)] bg-[var(--surface-raised)] hover:border-[var(--stroke-default)]'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium text-[12.5px] text-[var(--text-primary)]">
                  <ListOrdered className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Series
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                  Sequential books with visible reading order (#1, #2...).
                </p>
              </button>

              <button
                type="button"
                onClick={() => setKind('theme')}
                aria-pressed={kind === 'theme'}
                className={`flex flex-col items-start gap-1 rounded-[var(--radius-lg)] border p-3 text-left transition-all ${
                  kind === 'theme'
                    ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                    : 'border-[var(--stroke-subtle)] bg-[var(--surface-raised)] hover:border-[var(--stroke-default)]'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium text-[12.5px] text-[var(--text-primary)]">
                  <BookMarked className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Thematic
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                  General groupings like favorites, genres, or topics.
                </p>
              </button>
            </div>
          </div>

          {/* Description Field */}
          <div className="space-y-1.5">
            <label htmlFor="collection-description" className="text-[12px] font-medium text-[var(--text-primary)]">
              Description <span className="text-[11px] text-[var(--text-tertiary)]">(optional)</span>
            </label>
            <textarea
              id="collection-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes or summary for this grouping"
              className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--stroke-default)] bg-[var(--surface-raised)] p-2.5 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors focus:border-[var(--accent-ring)] focus:outline-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="button-secondary text-[12px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="button-primary text-[12px] disabled:opacity-50"
            >
              {isEditing ? 'Save Changes' : 'Create Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
