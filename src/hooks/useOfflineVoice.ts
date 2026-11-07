import { useCallback, useEffect, useState } from 'react';
import type { OfflineVoiceStatus } from '../types';

export interface OfflineVoice {
  /** Null until the first status check returns (or when there is no Electron bridge). */
  status: OfflineVoiceStatus | null;
  installed: boolean;
  downloading: boolean;
  /** 0-1 while downloading. */
  progress: number | null;
  error: string | null;
  download: () => Promise<boolean>;
  cancel: () => void;
  remove: () => Promise<void>;
}

/**
 * The offline voice's model: whether it is installed, and downloading or
 * removing it. Nothing is downloaded unless `download` is called, which only
 * a button the user presses does.
 */
export function useOfflineVoice(): OfflineVoice {
  const [status, setStatus] = useState<OfflineVoiceStatus | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await window.electronAPI?.getOfflineVoiceStatus?.();
    if (next) setStatus(next);
    return next ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.getOfflineVoiceStatus?.().then((next) => {
      if (!cancelled && next) {
        setStatus(next);
        if (next.downloading) setProgress(0);
      }
    });
    const unbind = window.electronAPI?.onOfflineVoiceDownloadProgress?.(({ receivedBytes, totalBytes }) => {
      setProgress(totalBytes > 0 ? receivedBytes / totalBytes : 0);
    });
    return () => {
      cancelled = true;
      unbind?.();
    };
  }, []);

  const download = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.downloadOfflineVoice) return false;
    setError(null);
    setProgress(0);
    setStatus((prev) => (prev ? { ...prev, downloading: true } : prev));
    const result = await api.downloadOfflineVoice();
    setProgress(null);
    if (!result.ok && !result.cancelled) setError(result.error ?? 'The download failed.');
    const next = await refresh();
    return Boolean(next?.installed);
  }, [refresh]);

  const cancel = useCallback(() => {
    void window.electronAPI?.cancelOfflineVoiceDownload?.();
  }, []);

  const remove = useCallback(async () => {
    await window.electronAPI?.removeOfflineVoice?.();
    await refresh();
  }, [refresh]);

  return {
    status,
    installed: Boolean(status?.installed),
    downloading: progress !== null || Boolean(status?.downloading),
    progress,
    error,
    download,
    cancel,
    remove,
  };
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}
