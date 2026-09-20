import React, { useState, useEffect } from 'react';
import { Pin, PinOff, Minus, X, FolderOpen, RefreshCw } from 'lucide-react';

interface TitleBarControlsProps {
  onOpenSettings: () => void;
  onRescan: () => void;
  isScanning: boolean;
}

export const TitleBarControls: React.FC<TitleBarControlsProps> = ({
  onOpenSettings,
  onRescan,
  isScanning,
}) => {
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    window.electronAPI?.isPinned().then(setIsPinned);
    const unbind = window.electronAPI?.onPinChanged(setIsPinned);
    return () => {
      unbind?.();
    };
  }, []);

  const togglePin = async () => {
    if (window.electronAPI) {
      const pinned = await window.electronAPI.togglePin();
      setIsPinned(pinned);
    }
  };

  return (
    <div
      className="flex items-center justify-between px-3.5 py-2 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Subtle brand mark */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium tracking-wider uppercase text-neutral-400">
          Acuity
        </span>
      </div>

      {/* Action buttons (non-draggable) */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onRescan}
          disabled={isScanning}
          title="Rescan library"
          className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60 rounded-md transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-neutral-300' : ''}`} />
        </button>

        <button
          onClick={onOpenSettings}
          title="Library Folders"
          className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60 rounded-md transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={togglePin}
          title={isPinned ? 'Unpin from top' : 'Always on top'}
          className={`p-1.5 rounded-md transition-colors ${
            isPinned
              ? 'text-amber-400 bg-amber-400/10'
              : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60'
          }`}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => window.electronAPI?.minimize()}
          title="Minimize"
          className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/60 rounded-md transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => window.electronAPI?.close()}
          title="Close"
          className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
