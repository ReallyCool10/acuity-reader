import React, { useState, useEffect } from 'react';
import { Pin, PinOff, FolderOpen, RefreshCw } from 'lucide-react';
import { AcuityLogo } from './AcuityLogo';

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
    <header
      className="flex items-center justify-between h-10 px-3 select-none bg-transparent border-b border-white/[0.06] backdrop-blur-md z-30"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Brand logo & title - Elegant lowercase 'a' and refined wordmark */}
      <div className="flex items-center gap-2">
        <AcuityLogo size={20} />
        <span className="text-[12px] font-semibold tracking-wide text-neutral-200">
          Acuity Reader
        </span>
      </div>

      {/* Action buttons positioned to the left of native Windows 11 caption controls */}
      <div
        className="flex items-center gap-1 pr-[140px]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onRescan}
          disabled={isScanning}
          title="Rescan library & covers"
          className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.08] active:bg-white/[0.12] rounded-md transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-amber-400' : ''}`} />
        </button>

        <button
          onClick={onOpenSettings}
          title="Library Folders"
          className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.08] active:bg-white/[0.12] rounded-md transition-all"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={togglePin}
          title={isPinned ? 'Unpin (Window acts normally)' : 'Keep on top'}
          className={`p-1.5 rounded-md transition-all ${
            isPinned
              ? 'text-amber-400 bg-amber-500/20 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.08] active:bg-white/[0.12]'
          }`}
        >
          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
};
