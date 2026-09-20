import React from 'react';
import { X, FolderPlus, Trash2, RefreshCw, CheckCircle2 } from 'lucide-react';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-neutral-900/90 backdrop-blur-2xl border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
          <h3 className="text-sm font-semibold text-neutral-100">Library Settings</h3>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-neutral-100 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 space-y-4 text-xs">
          {/* Note explaining automated scanning */}
          <div className="p-3 bg-neutral-950/70 border border-neutral-800/80 rounded-xl space-y-1">
            <div className="flex items-center gap-1.5 text-neutral-200 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Automated Organization</span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Add any parent directory. Acuity recursively scans for .m4b, .mp3, .epub, and .pdf files without requiring separate folders.
            </p>
          </div>

          {/* Watched Folders List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-300">Monitored Folders ({folders.length})</span>
              <button
                onClick={onAddFolder}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-neutral-100 text-neutral-900 rounded-md hover:bg-white transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Add Folder</span>
              </button>
            </div>

            {folders.length === 0 ? (
              <div className="py-6 text-center text-neutral-500 border border-dashed border-neutral-800 rounded-xl">
                No folders added yet. Click &quot;Add Folder&quot; to index your library.
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {folders.map((folder) => (
                  <div
                    key={folder}
                    className="flex items-center justify-between p-2 rounded-lg bg-neutral-950 border border-neutral-800/70 group"
                  >
                    <span className="truncate text-neutral-300 pr-2 font-mono text-[10px]" title={folder}>
                      {folder}
                    </span>
                    <button
                      onClick={() => onRemoveFolder(folder)}
                      title="Remove folder"
                      className="p-1 text-neutral-500 hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stats & Rescan */}
          <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between">
            <div className="text-[11px] text-neutral-400">
              <span className="text-neutral-200 font-medium">{totalItems}</span> items ({booksCount} books, {audioCount} audio)
            </div>

            <button
              onClick={onRescan}
              disabled={isScanning || folders.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Rescan Library'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
