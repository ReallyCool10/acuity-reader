import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bookmark,
  ChevronDown,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { MediaItem } from '../types';
import { coverUrl, mediaUrl } from '../lib/media';
import { formatRemaining, formatTime } from '../lib/format';
import { usePersistentState } from '../hooks/usePersistentState';
import { useDismissable } from '../hooks/useDismissable';
import { Scrubber } from './Scrubber';

interface AudioPlayerBarProps {
  item: MediaItem;
  initialTime?: number;
  onClose: () => void;
  onProgressUpdate: (itemId: string, currentTime: number, duration: number) => void;
  onAddBookmark: (itemId: string, time: number) => void;
  onSwitchToCompanion?: (companionPath: string) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SKIP_SECONDS = 15;

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  item,
  initialTime = 0,
  onClose,
  onProgressUpdate,
  onAddBookmark,
  onSwitchToCompanion,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [duration, setDuration] = useState(item.durationSeconds ?? 0);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Playback preferences outlive any single title.
  const [playbackRate, setPlaybackRate] = usePersistentState('acuity.playbackRate', 1);
  const [volume, setVolume] = usePersistentState('acuity.volume', 1);
  const [isMuted, setIsMuted] = usePersistentState('acuity.muted', false);

  useDismissable(speedRef, isSpeedOpen, () => setIsSpeedOpen(false));

  const src = useMemo(() => mediaUrl(item.filePath), [item.filePath]);
  const cover = coverUrl(item);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setError('This file could not be played.'));
    else audio.pause();
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const limit = audio.duration || 0;
    audio.currentTime = Math.max(0, Math.min(limit, audio.currentTime + seconds));
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  /* Apply persisted preferences to the element whenever they change. */
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    window.electronAPI?.updateThumbar(isPlaying);
  }, [isPlaying]);

  /*
   * The space bar is handled globally in App so it works wherever focus sits,
   * then relayed here as an event — the transport owns the audio element, and
   * lifting playback state up just to serve one shortcut is not worth it.
   */
  useEffect(() => {
    const onToggle = () => togglePlay();
    window.addEventListener('acuity:toggle-play', onToggle);
    return () => window.removeEventListener('acuity:toggle-play', onToggle);
  }, [togglePlay]);

  /* Taskbar thumbnail buttons and the tray menu drive the same transport. */
  useEffect(() => {
    const unbind = window.electronAPI?.onPlayerCommand((command) => {
      if (command === 'toggle-play') togglePlay();
      else if (command === 'skip-back') skip(-SKIP_SECONDS);
      else if (command === 'skip-forward') skip(SKIP_SECONDS);
    });
    return () => unbind?.();
  }, [togglePlay, skip]);

  /*
   * Media Session wires the transport into the OS: hardware media keys, the
   * Windows volume flyout and the lock screen all drive playback through it.
   */
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.author || 'Unknown author',
      album: 'Acuity Reader',
      artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : [],
    });

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => togglePlay()],
      ['pause', () => togglePlay()],
      ['seekbackward', () => skip(-SKIP_SECONDS)],
      ['seekforward', () => skip(SKIP_SECONDS)],
      ['seekto', (details) => details.seekTime !== undefined && seekTo(details.seekTime)],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Not every action is supported on every platform.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore.
        }
      }
    };
  }, [item.title, item.author, cover, togglePlay, skip, seekTo]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;

    setDuration(audio.duration || item.durationSeconds || 0);
    audio.playbackRate = playbackRate;
    audio.volume = volume;
    audio.muted = isMuted;

    if (initialTime > 0 && initialTime < audio.duration) audio.currentTime = initialTime;
    void audio.play().catch(() => {
      // Autoplay refusal is not an error worth surfacing; the user can press play.
    });
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    onProgressUpdate(item.id, audio.currentTime, audio.duration || 0);
  };

  const displayTime = previewTime ?? currentTime;
  const remaining = duration > 0 ? (duration - currentTime) / (playbackRate || 1) : 0;

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className="acu-no-drag relative z-40 shrink-0 border-t border-[var(--stroke-subtle)] bg-[var(--surface-base)] backdrop-blur-2xl"
      style={{ boxShadow: '0 -8px 28px -12px rgba(0,0,0,0.6)' }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={() => setDuration(audioRef.current?.duration || 0)}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => setError('This file could not be played.')}
      />

      {/* Expanded "now playing" panel, mirroring Media Player's full-screen view. */}
      {isExpanded && (
        <div className="animate-fade-rise flex flex-col items-center gap-3 border-b border-[var(--stroke-subtle)] px-6 pb-5 pt-6">
          {cover ? (
            <img
              src={cover}
              alt=""
              className="h-40 w-auto rounded-[var(--radius-md)] shadow-[var(--shadow-xl)]"
            />
          ) : (
            <div className="flex h-40 w-28 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]">
              <Headphones className="h-8 w-8 text-[var(--accent)]" />
            </div>
          )}
          <div className="text-center">
            <p className="font-serif text-[15px] font-semibold text-[var(--text-primary)]">{item.title}</p>
            <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{item.author}</p>
            {remaining > 0 && (
              <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">{formatRemaining(remaining)}</p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-2">
        {error && (
          <p role="alert" className="px-1 text-[11px] text-red-400">
            {error}
          </p>
        )}

        {/* Track identity */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsExpanded((open) => !open)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse now playing' : 'Expand now playing'}
            className="group relative shrink-0 rounded-[var(--radius-sm)]"
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                className="h-10 w-[30px] rounded-[3px] object-cover shadow-[var(--shadow-sm)]"
              />
            ) : (
              <span className="flex h-10 w-[30px] items-center justify-center rounded-[3px] bg-[var(--surface-raised)]">
                <Headphones className="h-3.5 w-3.5 text-[var(--accent)]" />
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center rounded-[3px] bg-black/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <ChevronDown
                className={`h-3.5 w-3.5 text-white transition-transform duration-200 ease-[var(--ease-out)] ${
                  isExpanded ? '' : 'rotate-180'
                }`}
              />
            </span>
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{item.title}</p>
            <p className="truncate text-[11px] text-[var(--text-tertiary)]">{item.author}</p>
          </div>

          <div className="flex shrink-0 items-center">
            {item.companionPath && onSwitchToCompanion && (
              <button
                type="button"
                onClick={() => onSwitchToCompanion(item.companionPath!)}
                className="icon-button"
                aria-label="Open the text edition"
                title="Open the text edition"
              >
                <BookOpen className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onAddBookmark(item.id, currentTime)}
              className="icon-button"
              aria-label="Bookmark this moment"
              title="Bookmark this moment"
            >
              <Bookmark className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="icon-button"
              aria-label="Close player"
              title="Close player"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex items-center gap-2.5">
          <span className="w-11 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
            {formatTime(displayTime)}
          </span>
          <Scrubber
            value={currentTime}
            max={duration}
            onSeek={seekTo}
            onPreview={setPreviewTime}
            ariaLabel="Seek through the audiobook"
            formatValue={(v) => `${formatTime(v)} of ${formatTime(duration)}`}
          />
          <span className="w-11 shrink-0 text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
            {formatTime(duration)}
          </span>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-between">
          <div className="relative flex w-20 justify-start" ref={speedRef}>
            <button
              type="button"
              onClick={() => setIsSpeedOpen((open) => !open)}
              className="rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] font-semibold tabular-nums text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-raised-hover)] hover:text-[var(--text-primary)]"
              aria-haspopup="menu"
              aria-expanded={isSpeedOpen}
              aria-label={`Playback speed, currently ${playbackRate} times`}
            >
              {playbackRate}×
            </button>

            {isSpeedOpen && (
              <div className="menu bottom-full left-0 mb-1.5" role="menu">
                {SPEEDS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    role="menuitemradio"
                    aria-checked={playbackRate === rate}
                    className="menu-item"
                    onClick={() => {
                      setPlaybackRate(rate);
                      setIsSpeedOpen(false);
                    }}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => skip(-SKIP_SECONDS)}
              className="icon-button"
              aria-label="Back 15 seconds"
              title="Back 15 seconds"
            >
              <RotateCcw className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-inverse)] shadow-[var(--shadow-md)] transition-all duration-150 ease-[var(--ease-out)] hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="ml-0.5 h-4 w-4 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={() => skip(SKIP_SECONDS)}
              className="icon-button"
              aria-label="Forward 15 seconds"
              title="Forward 15 seconds"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          </div>

          {/* Volume: the slider reveals on hover, so the bar stays uncluttered. */}
          <div className="group flex w-20 items-center justify-end gap-1">
            <div className="w-0 overflow-hidden transition-[width] duration-200 ease-[var(--ease-out)] group-hover:w-14 group-focus-within:w-14">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : volume}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setVolume(next);
                  setIsMuted(next === 0);
                }}
                aria-label="Volume"
                className="h-1 w-14 cursor-pointer accent-[var(--accent)]"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className="icon-button"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
