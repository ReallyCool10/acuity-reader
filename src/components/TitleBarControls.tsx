import React, { useEffect, useState } from 'react';
import { FolderOpen, Loader2, Pin, PinOff, RefreshCw } from 'lucide-react';
import { AcuityLogo } from './AcuityLogo';

interface TitleBarControlsProps {
  onOpenSettings: () => void;
  onRescan: () => void;
  isScanning: boolean;
  scanCount: number;
}

export const TitleBarControls: React.FC<TitleBarControlsProps> = ({
  onOpenSettings,
  onRescan,
  isScanning,
  scanCount,
}) => {
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    void window.electronAPI?.isPinned().then(setIsPinned);
    const unbind = window.electronAPI?.onPinChanged(setIsPinned);
    return () => unbind?.();
  }, []);

  const togglePin = async () => {
    const pinned = await window.electronAPI?.togglePin();
    if (typeof pinned === 'boolean') setIsPinned(pinned);
  };

  return (
    <header
      className="acu-drag flex shrink-0 items-center justify-between border-b border-[var(--stroke-subtle)] px-3"
      style={{ height: 'var(--titlebar-height)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AcuityLogo size={22} />
        <span className="truncate text-[12px] font-semibold tracking-wide text-[var(--text-secondary)]">
          Acuity Reader
        </span>

        {isScanning && (
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
            <Loader2 className="h-3 w-3 animate-spin text-[var(--accent)]" />
            <span className="tabular-nums">{scanCount > 0 ? `${scanCount} found` : 'Scanning'}</span>
          </span>
        )}
      </div>

      {/*
        Keep the action buttons clear of the native caption controls. The Window
        Controls Overlay exposes the usable title-bar rect; the fallback covers
        runtimes that do not, replacing the magic constant this used to hardcode.
      */}
      <div
        className="acu-no-drag flex items-center gap-0.5"
        style={{
          paddingRight:
            'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) - env(titlebar-area-x, 0px))',
        }}
      >
        <button
          type="button"
          onClick={onRescan}
          disabled={isScanning}
          className="icon-button"
          aria-label="Rescan library"
          title="Rescan library"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin text-[var(--accent)]' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="icon-button"
          aria-label="Library folders"
          title="Library folders"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={togglePin}
          data-active={isPinned}
          className="icon-button"
          aria-pressed={isPinned}
          aria-label={isPinned ? 'Unpin window' : 'Keep window on top'}
          title={isPinned ? 'Unpin window' : 'Keep window on top'}
        >
          {isPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
        </button>
      </div>
    </header>
  );
};
