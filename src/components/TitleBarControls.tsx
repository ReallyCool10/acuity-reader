import React, { useEffect, useRef, useState } from 'react';
import { Bot, Check, FolderOpen, Loader2, Palette, Pin, PinOff, RefreshCw, Settings } from 'lucide-react';
import { AcuityLogo } from './AcuityLogo';
import { useDismissable } from '../hooks/useDismissable';

interface TitleBarControlsProps {
  onOpenSettings: (tab?: 'theme' | 'folders' | 'mcp') => void;
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useDismissable(menuRef, isMenuOpen, () => setIsMenuOpen(false));

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
      className="acu-drag relative z-30 flex shrink-0 items-center justify-between border-b border-[var(--stroke-subtle)] px-3"
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
        Keep the settings menu clear of the native caption controls. The Window
        Controls Overlay exposes the usable title-bar rect; the fallback covers
        runtimes that do not, replacing the magic constant this used to hardcode.
      */}
      <div
        ref={menuRef}
        className="acu-no-drag relative flex items-center"
        style={{
          paddingRight:
            'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) - env(titlebar-area-x, 0px))',
        }}
      >
        <button
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          className={`icon-button ${isMenuOpen ? 'active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label="Settings and options"
          title="Settings"
        >
          <Settings className={`h-3.5 w-3.5 transition-transform duration-200 ${isMenuOpen ? 'rotate-45' : ''}`} />
        </button>

        {isMenuOpen && (
          <div
            className="menu right-0 top-full mt-1.5 w-56 p-1.5 z-50 shadow-2xl"
            style={{ '--menu-origin': 'top right' } as React.CSSProperties}
            role="menu"
            aria-label="Settings"
          >
            <button
              type="button"
              role="menuitem"
              disabled={isScanning}
              onClick={() => {
                onRescan();
                setIsMenuOpen(false);
              }}
              className="menu-item disabled:opacity-50"
            >
              <div className="flex items-center gap-2.5">
                <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin text-[var(--accent)]' : ''}`} />
                <span>{isScanning ? 'Rescanning library…' : 'Rescan library'}</span>
              </div>
            </button>

            <div className="my-1 border-t border-[var(--stroke-subtle)]" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenSettings('theme');
                setIsMenuOpen(false);
              }}
              className="menu-item"
            >
              <div className="flex items-center gap-2.5">
                <Palette className="h-3.5 w-3.5" />
                <span>Theme & appearance</span>
              </div>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenSettings('folders');
                setIsMenuOpen(false);
              }}
              className="menu-item"
            >
              <div className="flex items-center gap-2.5">
                <FolderOpen className="h-3.5 w-3.5" />
                <span>Library folders</span>
              </div>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenSettings('mcp');
                setIsMenuOpen(false);
              }}
              className="menu-item"
            >
              <div className="flex items-center gap-2.5">
                <Bot className="h-3.5 w-3.5" />
                <span>AI & MCP integration</span>
              </div>
            </button>

            <div className="my-1 border-t border-[var(--stroke-subtle)]" />

            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={isPinned}
              onClick={() => {
                void togglePin();
                setIsMenuOpen(false);
              }}
              className="menu-item"
            >
              <div className="flex items-center gap-2.5">
                {isPinned ? (
                  <Pin className="h-3.5 w-3.5 text-[var(--accent)]" />
                ) : (
                  <PinOff className="h-3.5 w-3.5" />
                )}
                <span>Keep window on top</span>
              </div>
              {isPinned && <Check className="h-3.5 w-3.5 text-[var(--accent)]" />}
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
