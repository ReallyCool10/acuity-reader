import React, { useEffect, useRef } from 'react';
import { FolderPlus, Loader2, RefreshCw, Trash2, X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  folders: string[];
  onAddFolder: () => void;
  onRemoveFolder: (folder: string) => void;
  onRescan: () => void;
  isScanning: boolean;
  totalItems: number;
  booksCount: number;
  audioCount: number;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  folders,
  onAddFolder,
  onRemoveFolder,
  onRescan,
  isScanning,
  totalItems,
  booksCount,
  audioCount,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  /*
   * Minimal focus management: remember what had focus, move into the dialog, and
   * restore on close. Without this, dismissing the dialog drops focus onto the
   * document body and keyboard navigation restarts from the top of the app.
   */
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!nodes || nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="animate-sheet-in w-full max-w-md overflow-hidden rounded-[var(--radius-xl)] border border-[var(--stroke-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-xl)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--stroke-subtle)] px-4 py-3">
          <h2 id="settings-title" className="text-[13px] font-semibold text-[var(--text-primary)]">
            Library folders
          </h2>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close settings">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Titles', value: totalItems },
              { label: 'Books', value: booksCount },
              { label: 'Audio', value: audioCount },
            ].map((stat) => (
              <div
                key={stat.label}
                className="surface-raised rounded-[var(--radius-md)] px-3 py-2.5 text-center"
              >
                <p className="text-[17px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {stat.value}
                </p>
                <p className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {folders.length === 0 ? (
              <p className="py-3 text-center text-[12px] text-[var(--text-tertiary)]">
                No folders are being watched yet.
              </p>
            ) : (
              folders.map((folder) => (
                <div
                  key={folder}
                  className="surface-raised group flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-secondary)]"
                    title={folder}
                    dir="rtl"
                  >
                    {folder}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveFolder(folder)}
                    className="icon-button h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red-400"
                    aria-label={`Stop watching ${folder}`}
                    title="Stop watching this folder"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAddFolder}
              className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--text-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--text-inverse)] transition-transform duration-150 ease-[var(--ease-out)] hover:brightness-105 active:scale-[0.98]"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Add folder
            </button>

            <button
              type="button"
              onClick={onRescan}
              disabled={isScanning || folders.length === 0}
              className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--stroke-default)] px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-raised-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              {isScanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Rescan
            </button>
          </div>

          <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">
            Acuity reads these folders and their subfolders. Covers and metadata come from embedded
            tags where present, or from a matching image beside the file.
          </p>
        </div>
      </div>
    </div>
  );
};
