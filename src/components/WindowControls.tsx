import React, { useEffect, useState } from 'react';

export interface WindowControlsProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Windows caption buttons (Minimize, Maximize / Restore, Close).
 * Designed for custom titlebars / header overlays where native Window Controls Overlay
 * cannot show through (e.g. reader views with fixed positioning and dedicated surface themes).
 */
export const WindowControls: React.FC<WindowControlsProps> = ({ className = '', style }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (typeof window !== 'undefined' && window.electronAPI) {
      if (typeof window.electronAPI.isMaximized === 'function') {
        void window.electronAPI.isMaximized().then((max) => {
          setIsMaximized(Boolean(max));
        });
      }
      if (typeof window.electronAPI.onMaximizedChanged === 'function') {
        unsubscribe = window.electronAPI.onMaximizedChanged((max) => {
          setIsMaximized(Boolean(max));
        });
      }
    }
    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    void window.electronAPI?.minimize();
  };

  const handleMaximize = (e: React.MouseEvent) => {
    e.stopPropagation();
    void window.electronAPI?.maximize();
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    void window.electronAPI?.close();
  };

  return (
    <div
      className={`acu-no-drag flex h-full items-center select-none ${className}`}
      style={style}
      role="group"
      aria-label="Window controls"
    >
      {/* Minimize */}
      <button
        type="button"
        onClick={handleMinimize}
        className="flex h-full w-[46px] items-center justify-center transition-colors duration-150 hover:bg-black/10 dark:hover:bg-white/10 focus-visible:outline-none"
        style={{ color: 'inherit' }}
        title="Minimize"
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor" aria-hidden="true">
          <rect width="10" height="1" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        onClick={handleMaximize}
        className="flex h-full w-[46px] items-center justify-center transition-colors duration-150 hover:bg-black/10 dark:hover:bg-white/10 focus-visible:outline-none"
        style={{ color: 'inherit' }}
        title={isMaximized ? 'Restore' : 'Maximize'}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            aria-hidden="true"
          >
            <path d="M2.5 7.5V2.5H7.5" />
            <rect x="0.5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            aria-hidden="true"
          >
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={handleClose}
        className="flex h-full w-[46px] items-center justify-center transition-colors duration-150 hover:bg-[#c42b1c] hover:text-white focus-visible:outline-none"
        style={{ color: 'inherit' }}
        title="Close"
        aria-label="Close"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="1" y1="1" x2="9" y2="9" />
          <line x1="9" y1="1" x2="1" y2="9" />
        </svg>
      </button>
    </div>
  );
};
