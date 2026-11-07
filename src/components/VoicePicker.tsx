import React, { useEffect, useState } from 'react';
import { Check, Cloud, Download, HardDrive, Loader2, Trash2, X } from 'lucide-react';
import type { EdgeVoice } from '../types';
import { FALLBACK_VOICE_CHOICES } from '../lib/narration';
import {
  DEFAULT_OFFLINE_VOICE,
  DEFAULT_ONLINE_VOICE,
  engineOf,
  LOCAL_VOICE_ID,
  LOCAL_VOICE_LABEL,
  OFFLINE_PRIVACY_NOTICE,
  OFFLINE_VOICES,
  ONLINE_PRIVACY_NOTICE,
} from '../lib/tts';
import { formatMegabytes, useOfflineVoice, type OfflineVoice } from '../hooks/useOfflineVoice';
import { usePersistentState } from '../hooks/usePersistentState';

interface VoicePickerProps {
  voice: string;
  onVoiceChange: (voice: string) => void;
  offline: OfflineVoice;
}

/** The offline voice the reader last chose, for falling back to it and switching back to it. */
export function useLastOfflineVoice() {
  return usePersistentState<string>('acuity.reader.lastOfflineVoice', DEFAULT_OFFLINE_VOICE);
}

const selectClass =
  'w-full rounded-[var(--radius-sm)] border border-[var(--stroke-default)] bg-[var(--surface-raised)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] transition-colors focus:border-[var(--accent)] focus:outline-none';

/**
 * Read-aloud voice choice, shared by the EPUB and PDF readers.
 *
 * A toggle picks the engine - Online (Microsoft's voices, which send the text
 * to Microsoft) or Offline (Kokoro, on this PC, or the basic Windows voice) -
 * and a list picks the voice within it. Each side remembers its last voice, so
 * switching back and forth is one click. The offline voice is downloaded only
 * when the reader presses Download here or in Settings.
 */
export const VoicePicker: React.FC<VoicePickerProps> = ({ voice, onVoiceChange, offline }) => {
  const engine = engineOf(voice);
  const side: 'online' | 'offline' = engine === 'online' ? 'online' : 'offline';
  const [lastOnline, setLastOnline] = usePersistentState<string>('acuity.reader.lastOnlineVoice', DEFAULT_ONLINE_VOICE);
  const [lastOffline, setLastOffline] = useLastOfflineVoice();
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoice[]>([]);

  // Microsoft's voice list is fetched only while the Online side is chosen:
  // someone reading offline should not have the app contact Microsoft at all.
  useEffect(() => {
    if (side !== 'online' || !window.electronAPI?.getEdgeVoices) return;
    let cancelled = false;
    window.electronAPI
      .getEdgeVoices()
      .then((voices) => {
        if (!cancelled && voices?.length) setEdgeVoices(voices);
      })
      .catch((err) => console.warn('Failed to load online voices:', err));
    return () => {
      cancelled = true;
    };
  }, [side]);

  const choose = (next: string) => {
    if (engineOf(next) === 'online') setLastOnline(next);
    else if (engineOf(next) === 'offline') setLastOffline(next);
    onVoiceChange(next);
  };

  const switchTo = (target: 'online' | 'offline') => {
    if (target === side) return;
    if (target === 'online') return choose(lastOnline);
    choose(offline.installed ? lastOffline : LOCAL_VOICE_ID);
  };

  const handleDownload = async () => {
    // Once it is installed, switch to it: that is what the download was for.
    if ((await offline.download()) && engineOf(voice) !== 'online') choose(lastOffline);
  };

  const onlineChoices = edgeVoices.length
    ? edgeVoices.map((v) => ({
        value: v.name,
        label: v.friendlyName.replace('Microsoft ', '').replace(' Online (Natural)', ''),
      }))
    : FALLBACK_VOICE_CHOICES.map((v) => ({ value: v.name, label: v.label }));

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Voice engine" className="flex gap-1">
        {(
          [
            { key: 'online', label: 'Online', icon: Cloud },
            { key: 'offline', label: 'Offline', icon: HardDrive },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={side === key}
            onClick={() => switchTo(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border py-1.5 text-[11px] font-medium transition-colors ${
              side === key
                ? 'border-[var(--accent-ring)] bg-[var(--accent-muted)] font-semibold text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-raised-hover)]'
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {side === 'online' ? (
        <select
          value={voice}
          onChange={(e) => choose(e.target.value)}
          aria-label="Online voice"
          className={selectClass}
        >
          {onlineChoices.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <select
            value={voice}
            onChange={(e) => choose(e.target.value)}
            aria-label="Offline voice"
            className={selectClass}
          >
            {offline.installed &&
              OFFLINE_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            <option value={LOCAL_VOICE_ID}>{LOCAL_VOICE_LABEL}</option>
          </select>
          {!offline.installed && <OfflineVoiceDownload offline={offline} onDownload={handleDownload} />}
        </>
      )}

      <p className="text-[10px] leading-snug text-[var(--text-tertiary)]">
        {side === 'online' ? ONLINE_PRIVACY_NOTICE : OFFLINE_PRIVACY_NOTICE}
      </p>
    </div>
  );
};

/** The offer to download the natural offline voice, with progress. Also used in Settings. */
export const OfflineVoiceDownload: React.FC<{ offline: OfflineVoice; onDownload?: () => void }> = ({
  offline,
  onDownload,
}) => {
  const size = formatMegabytes(offline.status?.downloadBytes ?? 92_000_000);
  if (!window.electronAPI?.downloadOfflineVoice) return null;
  return (
    <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-[var(--stroke-subtle)] bg-[var(--surface-sunken)] p-2">
      <p className="text-[10.5px] leading-snug text-[var(--text-secondary)]">
        The natural offline voice (Kokoro) is a one-time download of {size}. Until then, the basic system voice is used.
      </p>
      {offline.downloading ? (
        <div className="flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--stroke-subtle)]"
            role="progressbar"
            aria-label="Downloading the offline voice"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((offline.progress ?? 0) * 100)}
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-[var(--ease-out)]"
              style={{ width: `${Math.round((offline.progress ?? 0) * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-[10px] tabular-nums text-[var(--text-tertiary)]">
            {Math.round((offline.progress ?? 0) * 100)}%
          </span>
          <button
            type="button"
            onClick={offline.cancel}
            className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--surface-raised-hover)] hover:text-[var(--text-primary)]"
            aria-label="Cancel the download"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onDownload ?? (() => void offline.download())}
          className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--text-primary)] py-1.5 text-[11px] font-semibold text-[var(--text-inverse)] transition-transform duration-150 ease-[var(--ease-out)] hover:brightness-105 active:scale-[0.98]"
        >
          {offline.status === null ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Download offline voice ({size})
        </button>
      )}
      {offline.error && <p className="text-[10px] leading-snug text-red-400">{offline.error}</p>}
    </div>
  );
};

/** Settings > Read Aloud: what the two kinds of voice are, and the offline voice's download. */
export const OfflineVoiceSettings: React.FC = () => {
  const offline = useOfflineVoice();
  const size = formatMegabytes(offline.status?.downloadBytes ?? 92_000_000);
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-[12.5px] font-semibold text-[var(--text-primary)]">Read aloud voices</h3>
        <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
          Choose between them in any book, from the reader&apos;s appearance menu.
        </p>
      </div>

      <div className="space-y-2">
        <div className="surface-raised space-y-1 rounded-[var(--radius-md)] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)]">
            <Cloud className="h-3.5 w-3.5" /> Online — Microsoft natural voices
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            The most natural voices, and the default. {ONLINE_PRIVACY_NOTICE}
          </p>
        </div>

        <div className="surface-raised space-y-2 rounded-[var(--radius-md)] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)]">
            <HardDrive className="h-3.5 w-3.5" /> Offline — Kokoro natural voices
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            {OFFLINE_PRIVACY_NOTICE} When installed, it also takes over if the online voice is unavailable.
          </p>
          {offline.installed ? (
            <div className="flex items-center gap-2">
              <span className="flex flex-1 items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                <Check className="h-3 w-3 text-[var(--accent-read)]" /> Installed ({size})
              </span>
              <button
                type="button"
                onClick={() => void offline.remove()}
                className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--stroke-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-raised-hover)] hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </div>
          ) : (
            <OfflineVoiceDownload offline={offline} />
          )}
        </div>
      </div>

      <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">
        The basic Windows voice is always available offline, and is used if neither natural voice can speak.
      </p>
    </div>
  );
};
