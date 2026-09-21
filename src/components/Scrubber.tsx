import React, { useCallback, useRef, useState } from 'react';

interface ScrubberProps {
  value: number;
  max: number;
  onSeek: (value: number) => void;
  onPreview?: (value: number | null) => void;
  ariaLabel: string;
  /** Formats the value for assistive technology, e.g. "3 minutes 20 seconds". */
  formatValue?: (value: number) => string;
  step?: number;
}

/**
 * Composed scrubber: a styled track with a real `<input type="range">` layered
 * invisibly on top.
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
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

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
