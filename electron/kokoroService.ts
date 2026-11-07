import type { EdgeSynthesisResult } from './edgeTts';
import type { KokoroRequest, KokoroResponse } from './kokoroWorker';

/*
 * Owns the offline voice's worker process (kokoroWorker.ts): starts it on the
 * first request, sends requests and matches replies, and stops it after a few
 * idle minutes so its memory goes back to the system.
 *
 * Takes a `fork` function rather than importing Electron, so it can be tested
 * without the Electron binary (see rule 9 in CLAUDE.md).
 */

export interface WorkerLike {
  postMessage(message: KokoroRequest): void;
  on(event: 'message', listener: (message: KokoroResponse) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface KokoroSynthesisRequest {
  text: string;
  voice: string;
  speed: number;
}

export interface KokoroService {
  synthesize(request: KokoroSynthesisRequest): Promise<EdgeSynthesisResult>;
  /** Stop the worker now (before the model is removed, or on quit). */
  stop(): void;
}

/** Kokoro voice names: a/b (US/UK English), f/m, then the name. */
export const KOKORO_VOICE_PATTERN = /^[ab][fm]_[a-z]+$/;

export function createKokoroService({
  fork,
  idleMs = 3 * 60 * 1000,
}: {
  fork: () => WorkerLike;
  idleMs?: number;
}): KokoroService {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<number, { resolve: (r: EdgeSynthesisResult) => void; reject: (e: Error) => void }>();

  const stop = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = worker;
    worker = null;
    current?.kill();
    for (const { reject } of pending.values()) reject(new Error('The offline voice was stopped.'));
    pending.clear();
  };

  const scheduleIdleStop = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = pending.size === 0 ? setTimeout(stop, idleMs) : null;
  };

  const start = (): WorkerLike => {
    const started = fork();
    started.on('message', (message) => {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.ok) {
        waiting.resolve({ audioBase64: message.audioBase64, mimeType: message.mimeType, boundaries: message.boundaries });
      } else {
        waiting.reject(new Error(`The offline voice could not read this passage (${message.error}).`));
      }
      scheduleIdleStop();
    });
    started.on('exit', (code) => {
      if (worker !== started) return;
      worker = null;
      for (const { reject } of pending.values()) {
        reject(new Error(`The offline voice stopped unexpectedly (exit code ${code}).`));
      }
      pending.clear();
    });
    return started;
  };

  return {
    synthesize({ text, voice, speed }) {
      if (!KOKORO_VOICE_PATTERN.test(voice)) return Promise.reject(new Error(`Unknown offline voice "${voice}".`));
      worker ??= start();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      const id = nextId++;
      const request: KokoroRequest = { id, text, voice, speed: Math.min(2, Math.max(0.5, speed || 1)) };
      return new Promise<EdgeSynthesisResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage(request);
      });
    },
    stop,
  };
}
