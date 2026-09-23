import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Headphones,
  ListMusic,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Bookmark as BookmarkType, MediaItem } from '../types';
import { coverUrl, mediaUrl } from '../lib/media';
import { formatRemaining, formatTime } from '../lib/format';
import { cleanTitleString } from '../lib/metadata';
import { usePersistentState } from '../hooks/usePersistentState';
import { useDismissable } from '../hooks/useDismissable';
import { Scrubber } from './Scrubber';
import { themeForTitle } from './BookCard';
import { getTrackForTime } from '../lib/audiobookGrouping';

export interface AudioPlayerBarProps {
  item: MediaItem;
  initialTime?: number;
  initialFullScreen?: boolean;
  isFullScreen?: boolean;
  onFullScreenChange?: (fullScreen: boolean) => void;
  bookmarks?: BookmarkType[];
  onClose: () => void;
  onProgressUpdate: (itemId: string, currentTime: number, duration: number) => void;
  onAddBookmark: (itemId: string, time: number) => void;
  onRemoveBookmark?: (bookmarkId: string) => void;
  onSwitchToCompanion?: (companionPath: string) => void;
  onNextTrack?: () => void;
  onPrevTrack?: () => void;
  hasNextTrack?: boolean;
  hasPrevTrack?: boolean;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SKIP_SECONDS = 15;
const SLEEP_PRESETS: { label: string; minutes: number | null }[] = [
  { label: 'Off', minutes: null },
  { label: '5 minutes', minutes: 5 },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '45 minutes', minutes: 45 },
  { label: '60 minutes', minutes: 60 },
];

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  item,
  initialTime = 0,
  initialFullScreen = false,
  isFullScreen: controlledFullScreen,
  onFullScreenChange,
  bookmarks = [],
  onClose,
  onProgressUpdate,
  onAddBookmark,
  onRemoveBookmark,
  onSwitchToCompanion,
  onNextTrack,
  onPrevTrack,
  hasNextTrack = false,
  hasPrevTrack = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedRef = useRef<HTMLDivElement | null>(null);
  const sleepRef = useRef<HTMLDivElement | null>(null);
  const bookmarksRef = useRef<HTMLDivElement | null>(null);
  const chaptersRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [duration, setDuration] = useState(item.durationSeconds ?? 0);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);
  const [isSleepOpen, setIsSleepOpen] = useState(false);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(false);
  const [isChaptersOpen, setIsChaptersOpen] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [sleepSecondsLeft, setSleepSecondsLeft] = useState<number | null>(null);
  const [internalFullScreen, setInternalFullScreen] = useState(initialFullScreen);
  const [failedCoverId, setFailedCoverId] = useState<string | null>(null);
  const coverFailed = failedCoverId === item.id;
  const [error, setError] = useState<string | null>(null);

  const isFullScreen = controlledFullScreen !== undefined ? controlledFullScreen : internalFullScreen;
  const setIsFullScreen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setIsSpeedOpen(false);
      setIsSleepOpen(false);
      setIsChaptersOpen(false);
      setIsBookmarksOpen(false);
      const resolved = typeof next === 'function' ? next(isFullScreen) : next;
      if (controlledFullScreen === undefined) {
        setInternalFullScreen(resolved);
      }
      onFullScreenChange?.(resolved);
    },
    [controlledFullScreen, isFullScreen, onFullScreenChange]
  );

  useEffect(() => {
    if (!isFullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isFullScreen, setIsFullScreen]);

  // Playback preferences outlive any single title.
  const [playbackRate, setPlaybackRate] = usePersistentState('acuity.playbackRate', 1);
  const [volume, setVolume] = usePersistentState('acuity.volume', 1);
  const [isMuted, setIsMuted] = usePersistentState('acuity.muted', false);

  useDismissable(speedRef, isSpeedOpen, () => setIsSpeedOpen(false));
  useDismissable(sleepRef, isSleepOpen, () => setIsSleepOpen(false));
  useDismissable(bookmarksRef, isBookmarksOpen, () => setIsBookmarksOpen(false));
  useDismissable(chaptersRef, isChaptersOpen, () => setIsChaptersOpen(false));

  /* Sleep timer countdown */
  useEffect(() => {
    if (sleepSecondsLeft === null || !isPlaying) return;
    const interval = setInterval(() => {
      setSleepSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          if (audioRef.current && !audioRef.current.paused) {
            audioRef.current.pause();
          }
          setIsPlaying(false);
          setSleepMinutes(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [sleepSecondsLeft, isPlaying]);

  const selectSleepPreset = useCallback((minutes: number | null) => {
    setSleepMinutes(minutes);
    setSleepSecondsLeft(minutes ? minutes * 60 : null);
    setIsSleepOpen(false);
  }, []);

  const hasMultipleTracks = Boolean(item.tracks && item.tracks.length > 1);
  const tracks = useMemo(() => item.tracks ?? [], [item.tracks]);

  // Determine starting track and local position
  const initialTrackInfo = useMemo(() => {
    if (hasMultipleTracks && tracks.length > 0) {
      return getTrackForTime(tracks, initialTime);
    }
    return { track: null, trackIndex: 0, localTime: initialTime };
  }, [hasMultipleTracks, tracks, initialTime]);

  const [currentTrackIndex, setCurrentTrackIndex] = useState(initialTrackInfo.trackIndex);
  const pendingLocalSeek = useRef<number | null>(null);

  const activeTrack = hasMultipleTracks ? tracks[currentTrackIndex] || tracks[0] : null;
  const activeFilePath = activeTrack ? activeTrack.filePath : item.filePath;
  const src = useMemo(() => mediaUrl(activeFilePath), [activeFilePath]);

  const totalBookDuration = useMemo(() => {
    if (item.durationSeconds && item.durationSeconds > 0) {
      return item.durationSeconds;
    }
    if (hasMultipleTracks) {
      return tracks.reduce((sum, t) => sum + (t.durationSeconds || 0), 0);
    }
    return 0;
  }, [item.durationSeconds, hasMultipleTracks, tracks]);

  const cover = coverUrl(item);
  const displayTitle = useMemo(() => cleanTitleString(item.title) || item.title, [item.title]);
  const jacketTheme = useMemo(() => themeForTitle(displayTitle), [displayTitle]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setError('This file could not be played.'));
    else audio.pause();
  }, []);

  const seekTo = useCallback(
    (globalSeconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (!hasMultipleTracks) {
        audio.currentTime = globalSeconds;
        setCurrentTime(globalSeconds);
        return;
      }

      const target = getTrackForTime(tracks, globalSeconds);
      if (target.trackIndex !== currentTrackIndex) {
        pendingLocalSeek.current = target.localTime;
        setCurrentTrackIndex(target.trackIndex);
      } else {
        audio.currentTime = target.localTime;
      }
      setCurrentTime(globalSeconds);
    },
    [hasMultipleTracks, tracks, currentTrackIndex]
  );

  const skip = useCallback(
    (seconds: number) => {
      const limit = totalBookDuration || (audioRef.current?.duration || 0);
      const target = Math.max(0, Math.min(limit, currentTime + seconds));
      seekTo(target);
    },
    [totalBookDuration, currentTime, seekTo]
  );

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
    window.electronAPI?.updateThumbar?.(isPlaying);
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

  const chapters = useMemo(() => item.chapters ?? [], [item.chapters]);

  const activeChapter = useMemo(() => {
    if (chapters.length === 0) return null;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].startTime) {
        return chapters[i];
      }
    }
    return chapters[0];
  }, [chapters, currentTime]);

  const canGoPrev = hasPrevTrack || (hasMultipleTracks && currentTrackIndex > 0) || chapters.length > 0 || currentTime > 3;
  const canGoNext =
    hasNextTrack ||
    (hasMultipleTracks && currentTrackIndex < tracks.length - 1) ||
    (chapters.length > 0 &&
      Boolean(activeChapter && chapters.findIndex((c) => c.id === activeChapter.id) < chapters.length - 1));

  const handlePrev = useCallback(() => {
    if (chapters.length > 0) {
      if (activeChapter && currentTime - activeChapter.startTime > 3) {
        seekTo(activeChapter.startTime);
        return;
      }
      const curIdx = chapters.findIndex((c) => c.id === activeChapter?.id);
      if (curIdx > 0) {
        seekTo(chapters[curIdx - 1].startTime);
        return;
      }
    }

    if (hasMultipleTracks && currentTrackIndex > 0) {
      seekTo(tracks[currentTrackIndex - 1].offsetSeconds);
      return;
    }

    if (onPrevTrack && hasPrevTrack) {
      onPrevTrack();
    } else {
      seekTo(0);
    }
  }, [chapters, activeChapter, currentTime, seekTo, hasMultipleTracks, currentTrackIndex, tracks, onPrevTrack, hasPrevTrack]);

  const handleNext = useCallback(() => {
    if (chapters.length > 0) {
      const curIdx = chapters.findIndex((c) => c.id === activeChapter?.id);
      if (curIdx >= 0 && curIdx < chapters.length - 1) {
        seekTo(chapters[curIdx + 1].startTime);
        return;
      }
    }

    if (hasMultipleTracks && currentTrackIndex < tracks.length - 1) {
      seekTo(tracks[currentTrackIndex + 1].offsetSeconds);
      return;
    }

    if (onNextTrack && hasNextTrack) {
      onNextTrack();
    }
  }, [chapters, activeChapter, seekTo, hasMultipleTracks, currentTrackIndex, tracks, onNextTrack, hasNextTrack]);

  /* Taskbar thumbnail buttons and the tray menu drive the same transport. */
  useEffect(() => {
    const unbind = window.electronAPI?.onPlayerCommand?.((command) => {
      if (command === 'toggle-play') togglePlay();
      else if (command === 'skip-back') skip(-SKIP_SECONDS);
      else if (command === 'skip-forward') skip(SKIP_SECONDS);
    });
    return () => unbind?.();
  }, [togglePlay, skip]);

  /*
   * Media Session wires the transport into Windows 11 System Media Transport Controls:
   * hardware media keys, the Windows volume flyout, action center, and lock screen.
   */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle,
        artist: item.author || 'Unknown author',
        album: activeChapter?.title || item.album || item.dirName || 'Acuity Reader',
        artwork: cover
          ? [
              { src: cover, sizes: '96x96', type: 'image/jpeg' },
              { src: cover, sizes: '128x128', type: 'image/jpeg' },
              { src: cover, sizes: '256x256', type: 'image/jpeg' },
              { src: cover, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [],
      });
    } catch {
      // Best-effort metadata setting
    }

    const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => togglePlay()],
      ['pause', () => togglePlay()],
      ['seekbackward', (details) => skip(-(details.seekOffset || SKIP_SECONDS))],
      ['seekforward', (details) => skip(details.seekOffset || SKIP_SECONDS)],
      ['seekto', (details) => details.seekTime !== undefined && seekTo(details.seekTime)],
      ['previoustrack', canGoPrev ? () => handlePrev() : null],
      ['nexttrack', canGoNext ? () => handleNext() : null],
    ];

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Not every action is supported on every platform.
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore.
        }
      }
    };
  }, [
    displayTitle,
    item.author,
    item.album,
    item.dirName,
    activeChapter?.title,
    cover,
    togglePlay,
    skip,
    seekTo,
    canGoPrev,
    canGoNext,
    handlePrev,
    handleNext,
  ]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // Ignore
    }
  }, [isPlaying]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      if (duration > 0 && Number.isFinite(duration) && Number.isFinite(currentTime)) {
        navigator.mediaSession.setPositionState?.({
          duration: Math.max(0, duration),
          playbackRate: playbackRate || 1,
          position: Math.max(0, Math.min(currentTime, duration)),
        });
      }
    } catch {
      // Ignore
    }
  }, [currentTime, duration, playbackRate]);

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (hasMultipleTracks) {
      setDuration(totalBookDuration || audio.duration || 0);
    } else {
      setDuration(audio.duration || item.durationSeconds || 0);
    }
    audio.playbackRate = playbackRate;
    audio.volume = volume;
    audio.muted = isMuted;

    if (pendingLocalSeek.current !== null) {
      audio.currentTime = pendingLocalSeek.current;
      pendingLocalSeek.current = null;
    } else if (hasMultipleTracks) {
      if (initialTime > 0 && currentTrackIndex === initialTrackInfo.trackIndex) {
        audio.currentTime = initialTrackInfo.localTime;
      }
    } else if (initialTime > 0 && initialTime < audio.duration) {
      audio.currentTime = initialTime;
    }

    void audio.play().catch(() => {
      // Autoplay refusal is not an error worth surfacing; the user can press play.
    });
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const localTime = audio.currentTime;
    const globalTime = hasMultipleTracks && activeTrack
      ? activeTrack.offsetSeconds + localTime
      : localTime;
    setCurrentTime(globalTime);
    onProgressUpdate(item.id, globalTime, totalBookDuration || audio.duration || 0);
  };

  const displayTime = previewTime ?? currentTime;
  const remaining = duration > 0 ? (duration - currentTime) / (playbackRate || 1) : 0;

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const renderSpeedControl = () => (
    <div className="relative" ref={speedRef}>
      <button
        type="button"
        onClick={() => setIsSpeedOpen((open) => !open)}
        className="rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] font-semibold tabular-nums text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-raised-hover)] hover:text-[var(--text-primary)]"
        aria-haspopup="menu"
        aria-expanded={isSpeedOpen}
        aria-label={`Playback speed, currently ${playbackRate} times`}
        title={`Playback speed: ${playbackRate}×`}
      >
        {playbackRate}×
      </button>

      {isSpeedOpen && (
        <div className="menu bottom-full left-0 mb-1.5 z-50" role="menu">
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
  );

  const renderSleepControl = () => (
    <div className="relative" ref={sleepRef}>
      <button
        type="button"
        onClick={() => setIsSleepOpen((open) => !open)}
        className={`flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] font-semibold tabular-nums transition-colors duration-150 ${
          sleepSecondsLeft !== null
            ? 'bg-[var(--accent)] text-[var(--text-inverse)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-raised-hover)] hover:text-[var(--text-primary)]'
        }`}
        aria-haspopup="menu"
        aria-expanded={isSleepOpen}
        aria-label={
          sleepSecondsLeft !== null
            ? `Sleep timer active, ${Math.ceil(sleepSecondsLeft / 60)} minutes remaining`
            : 'Set sleep timer'
        }
        title={
          sleepSecondsLeft !== null
            ? `Sleep timer: ${Math.ceil(sleepSecondsLeft / 60)}m left`
            : 'Sleep timer'
        }
      >
        <Moon className="h-3.5 w-3.5" />
        {sleepSecondsLeft !== null && (
          <span>{Math.ceil(sleepSecondsLeft / 60)}m</span>
        )}
      </button>

      {isSleepOpen && (
        <div className="menu bottom-full left-0 mb-1.5 min-w-[130px] z-50" role="menu">
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            Sleep timer
          </div>
          {SLEEP_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              role="menuitemradio"
              aria-checked={sleepMinutes === preset.minutes}
              className={`menu-item ${sleepMinutes === preset.minutes ? 'font-semibold text-[var(--accent)]' : ''}`}
              onClick={() => selectSleepPreset(preset.minutes)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderChaptersControl = (alignRight = true) => {
    if (chapters.length === 0) return null;
    return (
      <div className="relative" ref={chaptersRef}>
        <button
          type="button"
          onClick={() => setIsChaptersOpen((open) => !open)}
          className={`icon-button ${isChaptersOpen ? 'text-[var(--accent)] bg-[var(--surface-raised)]' : ''}`}
          aria-label="Chapters"
          title="Chapters"
        >
          <ListMusic className="h-3.5 w-3.5" />
        </button>

        {isChaptersOpen && (
          <div
            className={`menu bottom-full ${alignRight ? 'right-0' : 'left-0'} mb-2 max-h-64 w-72 overflow-y-auto p-2 z-50`}
            role="dialog"
            aria-label="Chapters"
          >
            <div className="mb-2 flex items-center justify-between border-b border-[var(--stroke-subtle)] pb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Chapters ({chapters.length})
              </span>
            </div>

            <div className="flex flex-col gap-1">
              {chapters.map((chap, idx) => {
                const isCurrent = activeChapter?.id === chap.id;
                return (
                  <button
                    key={chap.id}
                    type="button"
                    onClick={() => {
                      seekTo(chap.startTime);
                      setIsChaptersOpen(false);
                    }}
                    className={`flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12px] transition-colors ${
                      isCurrent
                        ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="truncate pr-2">
                      {idx + 1}. {chap.title}
                    </span>
                    <span className="shrink-0 text-[10.5px] tabular-nums opacity-60">
                      {formatTime(chap.startTime)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderBookmarksControl = (alignRight = true) => (
    <div className="relative" ref={bookmarksRef}>
      <button
        type="button"
        onClick={() => setIsBookmarksOpen((open) => !open)}
        className="icon-button relative"
        aria-label="Bookmarks"
        title="Bookmarks"
      >
        <Bookmark className="h-3.5 w-3.5" />
        {bookmarks.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-bold text-[var(--text-inverse)]">
            {bookmarks.length}
          </span>
        )}
      </button>

      {isBookmarksOpen && (
        <div
          className={`menu bottom-full ${alignRight ? 'right-0' : 'left-0'} mb-2 max-h-64 w-72 overflow-y-auto p-2 z-50`}
          role="dialog"
          aria-label="Bookmarks"
        >
          <div className="mb-2 flex items-center justify-between border-b border-[var(--stroke-subtle)] pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Bookmarks ({bookmarks.length})
            </span>
            <button
              type="button"
              onClick={() => {
                onAddBookmark(item.id, currentTime);
              }}
              className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-raised-hover)]"
            >
              + Add here
            </button>
          </div>

          {bookmarks.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-[var(--text-tertiary)]">
              No bookmarks yet. Click "+ Add here" to save your spot.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="group flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--surface-raised-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      seekTo(bm.position);
                      setIsBookmarksOpen(false);
                    }}
                    className="flex flex-1 flex-col truncate"
                  >
                    <span className="text-[11.5px] font-medium text-[var(--text-primary)]">
                      {formatTime(bm.position)}
                    </span>
                    <span className="truncate text-[10.5px] text-[var(--text-tertiary)]">
                      {bm.label}
                    </span>
                  </button>
                  {onRemoveBookmark && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveBookmark(bm.id);
                      }}
                      className="icon-button opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                      aria-label="Delete bookmark"
                      title="Delete bookmark"
                    >
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderVolumeControl = (isCompact = true) => {
    if (isCompact) {
      return (
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
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsMuted(!isMuted)}
          className="icon-button"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          <VolumeIcon className="h-4 w-4" />
        </button>
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
          className="h-1.5 w-20 sm:w-24 cursor-pointer accent-[var(--accent)]"
        />
      </div>
    );
  };

  return (
    <>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={() => {
          if (!hasMultipleTracks) {
            setDuration(audioRef.current?.duration || 0);
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          if (hasMultipleTracks && currentTrackIndex < tracks.length - 1) {
            const nextIndex = currentTrackIndex + 1;
            pendingLocalSeek.current = 0;
            setCurrentTrackIndex(nextIndex);
          } else {
            setIsPlaying(false);
            if (onNextTrack && hasNextTrack) {
              onNextTrack();
            }
          }
        }}
        onError={() => setError('This file could not be played.')}
      />

      {isFullScreen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--surface-player)] animate-reader-in select-none text-[var(--text-primary)]">
          {/* Header Bar */}
          <header
            className="acu-drag relative z-40 flex shrink-0 items-center justify-between border-b border-[var(--stroke-subtle)] px-3 bg-[var(--surface-player)]"
            style={{ height: 'var(--titlebar-height, 40px)' }}
          >
            {/* Left spacer for window drag */}
            <div className="flex-1" />

            {/* Right: Companion eBook switch, Minimize & Close buttons */}
            <div
              className="acu-no-drag flex items-center gap-1.5"
              style={{
                paddingRight:
                  'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) - env(titlebar-area-x, 0px))',
              }}
            >
              {item.companionPath && onSwitchToCompanion && (
                <button
                  type="button"
                  onClick={() => {
                    setIsFullScreen(false);
                    onSwitchToCompanion(item.companionPath!);
                  }}
                  className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--accent-ring)] bg-[var(--accent-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors duration-150 hover:bg-[rgba(240,178,50,0.24)]"
                  title="Open the companion text edition"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>Read eBook</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsFullScreen(false)}
                className="icon-button"
                aria-label="Minimize player to bar (Esc)"
                title="Minimize player to bar (Esc)"
              >
                <Minimize2 className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onClose}
                className="icon-button"
                aria-label="Close player"
                title="Close player"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* Main Stage */}
          <div className="flex flex-1 flex-col items-center justify-between overflow-y-auto px-6 py-6 sm:py-8 acu-no-drag">
            <div className="my-auto flex w-full max-w-lg flex-col items-center justify-center">
              {error && (
                <p role="alert" className="mb-4 px-3 py-1 rounded bg-red-500/10 text-xs text-red-400 border border-red-500/20">
                  {error}
                </p>
              )}

              {/* Cover Artwork / Fallback Jacket */}
              <div className="relative mb-6">
                <div className="absolute -inset-4 rounded-3xl bg-[var(--accent)]/15 blur-2xl opacity-60 pointer-events-none" />
                {cover && !coverFailed ? (
                  <img
                    src={cover}
                    alt={displayTitle}
                    onError={() => setFailedCoverId(item.id)}
                    className="relative z-10 max-h-[280px] sm:max-h-[340px] max-w-[280px] sm:max-w-[340px] w-auto h-auto rounded-[var(--radius-lg)] shadow-[0_20px_50px_rgba(0,0,0,0.6)] object-contain border border-white/10"
                  />
                ) : (
                  <div
                    className="relative z-10 flex h-[280px] sm:h-[340px] w-[200px] sm:w-[240px] flex-col justify-between rounded-[var(--radius-lg)] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)] border border-white/10"
                    style={{
                      background: `linear-gradient(145deg, ${jacketTheme.from}, ${jacketTheme.to})`,
                      color: jacketTheme.ink,
                    }}
                  >
                    {/* Inner debossed foil frame */}
                    <div
                      className="pointer-events-none absolute inset-2.5 rounded-[var(--radius-md)] border opacity-70"
                      style={{ borderColor: `${jacketTheme.accent}33` }}
                    />
                    <div className="relative flex items-center justify-between">
                      <span
                        className="text-[9px] font-semibold uppercase tracking-[0.16em]"
                        style={{ color: jacketTheme.accent }}
                      >
                        Audiobook
                      </span>
                      <Headphones className="h-3.5 w-3.5" style={{ color: jacketTheme.accent }} />
                    </div>

                    <div className="relative my-auto px-1 text-center">
                      <h2
                        className="line-clamp-5 font-serif text-[17px] sm:text-[19px] font-bold leading-snug"
                        style={{ color: jacketTheme.ink }}
                      >
                        {displayTitle}
                      </h2>
                      {item.author && (
                        <p
                          className="mt-3 truncate text-[10.5px] font-semibold uppercase tracking-[0.18em]"
                          style={{ color: jacketTheme.accent }}
                        >
                          {item.author}
                        </p>
                      )}
                    </div>

                    <div className="relative flex justify-center">
                      <div
                        className="h-[2px] w-8 rounded-full opacity-60"
                        style={{ background: jacketTheme.accent }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Title & Author */}
              <div className="text-center max-w-md w-full px-2">
                <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)] line-clamp-2">
                  {displayTitle}
                </h1>
                {item.author && (
                  <p className="mt-1.5 text-sm sm:text-base font-medium text-[var(--text-secondary)]">
                    {item.author}
                  </p>
                )}
                {activeChapter && (
                  <p className="mt-1 text-xs font-medium text-[var(--accent)] truncate">
                    {activeChapter.title}
                  </p>
                )}
              </div>

              {/* Timeline Scrubber */}
              <div className="mt-6 w-full max-w-md">
                <Scrubber
                  value={currentTime}
                  max={duration}
                  onSeek={seekTo}
                  onPreview={setPreviewTime}
                  ariaLabel="Seek through the audiobook"
                  formatValue={(v) => `${formatTime(v)} of ${formatTime(duration)}`}
                  chapters={chapters}
                />
                <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums text-[var(--text-tertiary)]">
                  <span>{formatTime(displayTime)}</span>
                  <span>{remaining > 0 ? `-${formatRemaining(remaining)}` : formatTime(duration)}</span>
                </div>
              </div>

              {/* Primary Transport Controls */}
              <div className="mt-6 flex items-center justify-center gap-4 sm:gap-6">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={!canGoPrev}
                  className={`icon-button h-11 w-11 ${!canGoPrev ? 'cursor-not-allowed opacity-30 hover:bg-transparent' : ''}`}
                  aria-label={chapters.length > 0 ? 'Previous chapter or track' : 'Previous track'}
                  title={chapters.length > 0 ? 'Previous chapter or track' : 'Previous track'}
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>

                <button
                  type="button"
                  onClick={() => skip(-SKIP_SECONDS)}
                  className="icon-button h-12 w-12"
                  aria-label="Back 15 seconds"
                  title="Back 15 seconds"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-inverse)] shadow-[var(--shadow-xl)] transition-all duration-150 ease-[var(--ease-out)] hover:scale-105 hover:bg-[var(--accent-hover)] active:scale-95"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="h-7 w-7 fill-current" />
                  ) : (
                    <Play className="ml-1 h-7 w-7 fill-current" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => skip(SKIP_SECONDS)}
                  className="icon-button h-12 w-12"
                  aria-label="Forward 15 seconds"
                  title="Forward 15 seconds"
                >
                  <RotateCw className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canGoNext}
                  className={`icon-button h-11 w-11 ${!canGoNext ? 'cursor-not-allowed opacity-30 hover:bg-transparent' : ''}`}
                  aria-label={chapters.length > 0 ? 'Next chapter or track' : 'Next track'}
                  title={chapters.length > 0 ? 'Next chapter or track' : 'Next track'}
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </div>
            </div>

            {/* Bottom Utilities Toolbar */}
            <div className="mt-8 flex w-full max-w-md items-center justify-between border-t border-[var(--stroke-subtle)] pt-4">
              <div className="flex items-center gap-1.5">
                {renderSpeedControl()}
                {renderSleepControl()}
              </div>

              <div className="flex items-center gap-1.5">
                {renderChaptersControl(false)}
                {renderBookmarksControl(false)}
              </div>

              <div className="flex items-center gap-1.5">
                {renderVolumeControl(false)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="acu-no-drag relative z-40 shrink-0 border-t border-[var(--stroke-subtle)] bg-[var(--surface-player-docked)]"
          style={{ boxShadow: '0 -8px 28px -12px rgba(0,0,0,0.6)' }}
        >

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
            onClick={() => setIsFullScreen(true)}
            aria-label="Expand to full screen"
            title="Expand to full screen"
            className="group relative shrink-0 rounded-[var(--radius-sm)]"
          >
            {cover && !coverFailed ? (
              <img
                src={cover}
                alt=""
                onError={() => setFailedCoverId(item.id)}
                className="h-10 w-[30px] rounded-[3px] object-cover shadow-[var(--shadow-sm)]"
              />
            ) : (
              <span
                className="flex h-10 w-[30px] items-center justify-center rounded-[3px]"
                style={{
                  background: `linear-gradient(145deg, ${jacketTheme.from}, ${jacketTheme.to})`,
                }}
              >
                <Headphones className="h-3.5 w-3.5" style={{ color: jacketTheme.accent }} />
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center rounded-[3px] bg-black/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5 text-white" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsFullScreen(true)}
            className="min-w-0 flex-1 text-left"
            title="Expand to full screen"
          >
            <p className="truncate text-[12.5px] font-medium text-[var(--text-primary)] hover:underline">
              {displayTitle}
            </p>
            <p className="truncate text-[11px] text-[var(--text-tertiary)]">
              {item.author}
              {activeChapter ? (
                <span className="text-[var(--text-secondary)] font-medium"> • {activeChapter.title}</span>
              ) : null}
            </p>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            {item.companionPath && onSwitchToCompanion && (
              <button
                type="button"
                onClick={() => onSwitchToCompanion(item.companionPath!)}
                className="icon-button"
                aria-label="Open the companion text edition"
                title="Open the companion text edition"
              >
                <BookOpen className="h-3.5 w-3.5" />
              </button>
            )}
            {renderChaptersControl(true)}
            {renderBookmarksControl(true)}
            <button
              type="button"
              onClick={() => setIsFullScreen(true)}
              className="icon-button"
              aria-label="Expand to full screen"
              title="Expand to full screen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
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
            chapters={chapters}
          />
          <span className="w-11 shrink-0 text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
            {formatTime(duration)}
          </span>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-between">
          <div className="flex w-24 items-center justify-start gap-1">
            {renderSpeedControl()}
            {renderSleepControl()}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrev}
              disabled={!canGoPrev}
              className={`icon-button ${!canGoPrev ? 'cursor-not-allowed opacity-30 hover:bg-transparent' : ''}`}
              aria-label={chapters.length > 0 ? 'Previous chapter or track' : 'Previous track'}
              title={chapters.length > 0 ? 'Previous chapter or track' : 'Previous track'}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

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
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-inverse)] shadow-[var(--shadow-md)] transition-all duration-150 ease-[var(--ease-out)] hover:scale-105 hover:bg-[var(--accent-hover)] active:scale-95"
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

            <button
              type="button"
              onClick={handleNext}
              disabled={!canGoNext}
              className={`icon-button ${!canGoNext ? 'cursor-not-allowed opacity-30 hover:bg-transparent' : ''}`}
              aria-label={chapters.length > 0 ? 'Next chapter or track' : 'Next track'}
              title={chapters.length > 0 ? 'Next chapter or track' : 'Next track'}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {renderVolumeControl(true)}
        </div>
      </div>
    </div>
  )}
</>
);
};