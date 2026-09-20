import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  X,
  Volume2,
  VolumeX,
  Bookmark,
  BookOpen,
} from 'lucide-react';
import type { MediaItem } from '../types';

interface AudioPlayerBarProps {
  item: MediaItem;
  initialTime?: number;
  onClose: () => void;
  onProgressUpdate: (itemId: string, currentTime: number, duration: number) => void;
  onAddBookmark: (itemId: string, time: number) => void;
  onSwitchToCompanion?: (companionPath: string) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  item,
  initialTime = 0,
  onClose,
  onProgressUpdate,
  onAddBookmark,
  onSwitchToCompanion,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);

  // Sync taskbar thumbnail buttons whenever play state changes
  useEffect(() => {
    window.electronAPI?.updateThumbar(isPlaying);
  }, [isPlaying]);

  // Handle taskbar thumbnail & system tray actions
  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(console.error);
    } else {
      audioRef.current.pause();
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + seconds));
  }, []);

  useEffect(() => {
    const unbind = window.electronAPI?.onPlayerCommand((cmd) => {
      if (cmd === 'toggle-play') togglePlay();
      else if (cmd === 'skip-back') skip(-15);
      else if (cmd === 'skip-forward') skip(15);
    });
    return () => {
      unbind?.();
    };
  }, [togglePlay, skip]);

  // Set audio source safely
  const audioSrc = React.useMemo(() => {
    // Windows path format: convert backslashes to forward slashes for file://
    const normalized = item.filePath.replace(/\\/g, '/');
    return encodeURI(`file:///${normalized}`);
  }, [item.filePath]);

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
    if (initialTime > 0 && initialTime < audioRef.current.duration) {
      audioRef.current.currentTime = initialTime;
    }
    audioRef.current.playbackRate = playbackRate;
    audioRef.current.play().catch(console.error);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    setCurrentTime(cur);
    onProgressUpdate(item.id, cur, audioRef.current.duration || 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    setIsSpeedMenuOpen(false);
  };

  const handleBookmark = () => {
    onAddBookmark(item.id, currentTime);
  };

  return (
    <div className="border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-md p-3 flex flex-col gap-2 select-none">
      <audio
        ref={audioRef}
        src={audioSrc}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Track Info & Quick Actions */}
      <div className="flex items-center justify-between text-xs">
        <div className="min-w-0 pr-2">
          <p className="font-medium text-neutral-100 truncate">{item.title}</p>
          <p className="text-[11px] text-neutral-500 truncate">{item.author}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {item.companionPath && onSwitchToCompanion && (
            <button
              onClick={() => onSwitchToCompanion(item.companionPath!)}
              title="Open Companion Book"
              className="p-1 text-neutral-400 hover:text-amber-400 rounded transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={handleBookmark}
            title="Add bookmark"
            className="p-1 text-neutral-400 hover:text-neutral-100 rounded transition-colors"
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClose}
            title="Close Player"
            className="p-1 text-neutral-500 hover:text-neutral-200 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] tabular-nums text-neutral-500 w-10 text-right">
          {formatTime(currentTime)}
        </span>

        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
        />

        <span className="text-[10px] tabular-nums text-neutral-500 w-10">
          {formatTime(duration)}
        </span>
      </div>

      {/* Main Controls Row */}
      <div className="flex items-center justify-between pt-0.5">
        {/* Speed Selector */}
        <div className="relative">
          <button
            onClick={() => setIsSpeedMenuOpen(!isSpeedMenuOpen)}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          >
            {playbackRate}x
          </button>

          {isSpeedMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 py-1 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl z-50 flex flex-col min-w-16">
              {SPEEDS.map((rate) => (
                <button
                  key={rate}
                  onClick={() => changeSpeed(rate)}
                  className={`px-3 py-1 text-[11px] text-left hover:bg-neutral-800 ${
                    playbackRate === rate ? 'text-amber-400 font-medium' : 'text-neutral-300'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Playback Controls (15s back, play/pause, 15s forward) */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => skip(-15)}
            title="Rewind 15s"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-full hover:bg-neutral-850 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 rounded-full bg-amber-400 hover:bg-amber-300 text-neutral-950 flex items-center justify-center transition-all shadow-md shadow-amber-950/40"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            onClick={() => skip(15)}
            title="Forward 15s"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-full hover:bg-neutral-850 transition-colors"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Volume button */}
        <button
          onClick={() => {
            if (audioRef.current) {
              const muted = !isMuted;
              setIsMuted(muted);
              audioRef.current.muted = muted;
            }
          }}
          className="p-1 text-neutral-400 hover:text-neutral-100 rounded transition-colors"
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
