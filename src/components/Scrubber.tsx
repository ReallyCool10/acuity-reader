import React, { useCallback, useRef, useState } from 'react';

export interface ScrubberChapter {
  id: string;
  title: string;
  startTime: number;
  endTime?: number;
}

interface ScrubberProps {
  value: number;
  max: number;
  onSeek: (value: number) => void;
  onPreview?: (value: number | null) => void;
  ariaLabel: string;
  /** Formats the value for assistive technology, e.g. "3 minutes 20 seconds". */
  formatValue?: (value: number) => string;
  step?: number;
  chapters?: ScrubberChapter[];
}

function formatChapterTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  const remS = s % 60;
  if (h > 0) {
    return `${h}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
  }
  return `${remM}:${remS.toString().padStart(2, '0')}`;
}

/**
 * Composed scrubber: a styled track with a real `<input type="range">` layered
 * invisibly on top, with optional chapter markers along the timeline.
 *
 * A bare range input cannot show a hover preview or a buffered region, but
 * reimplementing one from pointer events loses keyboard support, repeat-on-hold
 * and screen-reader semantics. Layering keeps both.
 */
export const Scrubber: React.FC<ScrubberProps> = ({
  value,
  max,
  onSeek,
  onPreview,
  ariaLabel,
  formatValue,
  step = 1,
  chapters,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [hoveredChapterId, setHoveredChapterId] = useState<string | null>(null);

  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));

  const ratioFromEvent = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const next = ratioFromEvent(event.clientX);
      setHoverRatio(next);
      if (next !== null) onPreview?.(next * safeMax);
    },
    [ratioFromEvent, onPreview, safeMax]
  );

  const handlePointerLeave = useCallback(() => {
    setHoverRatio(null);
    setHoveredChapterId(null);
    onPreview?.(null);
  }, [onPreview]);

  return (
    <div
      className="scrubber"
      ref={trackRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="scrubber-track">
        {hoverRatio !== null && (
          <div className="scrubber-hover" style={{ width: `${hoverRatio * 100}%` }} />
        )}
        <div className="scrubber-fill" style={{ width: `${ratio * 100}%` }} />
      </div>

      {/* Chapter notch markers along the timeline */}
      {chapters && chapters.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center">
          {chapters.map((chap) => {
            const chapRatio = Math.min(1, Math.max(0, chap.startTime / safeMax));
            const isPassed = value >= chap.startTime;
            const isHovered = hoveredChapterId === chap.id;

            return (
              <div
                key={chap.id}
                className="pointer-events-auto absolute -translate-x-1/2 flex items-center justify-center"
                style={{
                  left: `${chapRatio * 100}%`,
                  top: '50%',
                  width: '16px',
                  height: '18px',
                }}
                onMouseEnter={() => setHoveredChapterId(chap.id)}
                onMouseLeave={() =>
                  setHoveredChapterId((prev) => (prev === chap.id ? null : prev))
                }
                onPointerEnter={() => setHoveredChapterId(chap.id)}
                onPointerLeave={() =>
                  setHoveredChapterId((prev) => (prev === chap.id ? null : prev))
                }
              >
                <button
                  type="button"
                  tabIndex={0}
                  onFocus={() => setHoveredChapterId(chap.id)}
                  onBlur={() =>
                    setHoveredChapterId((prev) => (prev === chap.id ? null : prev))
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onSeek(chap.startTime);
                  }}
                  className={`h-1.5 w-1.5 rounded-full transition-all duration-150 ease-out cursor-pointer ${
                    isHovered
                      ? 'scale-150 bg-[var(--accent)] ring-2 ring-[var(--accent-ring)]'
                      : isPassed
                      ? 'bg-[var(--surface-raised-active)] border border-[var(--accent)]/60'
                      : 'bg-[var(--text-tertiary)]/70 hover:bg-[var(--accent)]'
                  }`}
                  aria-label={`Skip to chapter: ${chap.title} (${formatChapterTime(chap.startTime)})`}
                  title={`${chap.title} (${formatChapterTime(chap.startTime)})`}
                />

                {/* Chapter Tooltip */}
                {isHovered && (
                  <div
                    className="pointer-events-none absolute bottom-[calc(100%+6px)] z-30 flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--stroke-default)] bg-[var(--surface-overlay)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] shadow-[var(--shadow-xl)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 whitespace-nowrap"
                    style={{
                      left: chapRatio < 0.12 ? '0%' : chapRatio > 0.88 ? '100%' : '50%',
                      transform:
                        chapRatio < 0.12
                          ? 'none'
                          : chapRatio > 0.88
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)',
                    }}
                  >
                    <span className="max-w-[200px] truncate text-[var(--text-primary)]">
                      {chap.title}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono tabular-nums text-[var(--accent)]">
                      {formatChapterTime(chap.startTime)}
                    </span>
                    <div
                      className="absolute -bottom-1 h-2 w-2 rotate-45 border-b border-r border-[var(--stroke-default)] bg-[var(--surface-overlay)]"
                      style={{
                        left:
                          chapRatio < 0.12
                            ? '8px'
                            : chapRatio > 0.88
                            ? 'calc(100% - 12px)'
                            : '50%',
                        transform: 'translateX(-50%) rotate(45deg)',
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="scrubber-thumb" style={{ left: `${ratio * 100}%` }} />
      <input
        type="range"
        min={0}
        max={safeMax}
        step={step}
        value={Math.min(value, safeMax)}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={ariaLabel}
        aria-valuetext={formatValue?.(value)}
      />
    </div>
  );
};
