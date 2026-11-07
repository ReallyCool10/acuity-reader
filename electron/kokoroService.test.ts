import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKokoroService, type WorkerLike } from './kokoroService';
import type { KokoroRequest, KokoroResponse } from './kokoroWorker';

class FakeWorker implements WorkerLike {
  sent: KokoroRequest[] = [];
  killed = false;
  private listeners: Record<string, ((arg: never) => void)[]> = {};
  postMessage(message: KokoroRequest) {
    this.sent.push(message);
  }
  on(event: 'message' | 'exit', listener: (arg: never) => void) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  kill() {
    this.killed = true;
    return true;
  }
  reply(message: KokoroResponse) {
    for (const l of this.listeners.message ?? []) (l as (m: KokoroResponse) => void)(message);
  }
  exit(code: number) {
    for (const l of this.listeners.exit ?? []) (l as (c: number) => void)(code);
  }
}

describe('kokoroService', () => {
  afterEach(() => vi.useRealTimers());

  function setup(idleMs = 1000) {
    const workers: FakeWorker[] = [];
    const service = createKokoroService({
      fork: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      idleMs,
    });
    return { service, workers };
  }

  it('starts the worker on first use and returns its audio', async () => {
    const { service, workers } = setup();
    expect(workers).toHaveLength(0);
    const result = service.synthesize({ text: 'Hello.', voice: 'bf_emma', speed: 1.25 });
    expect(workers[0].sent[0]).toMatchObject({ text: 'Hello.', voice: 'bf_emma', speed: 1.25 });
    workers[0].reply({ id: workers[0].sent[0].id, ok: true, audioBase64: 'AA==', mimeType: 'audio/wav', boundaries: [] });
    await expect(result).resolves.toEqual({ audioBase64: 'AA==', mimeType: 'audio/wav', boundaries: [] });
    service.stop();
  });

  it('refuses a voice name that is not a Kokoro voice, without starting anything', async () => {
    const { service, workers } = setup();
    await expect(service.synthesize({ text: 'x', voice: '../../etc', speed: 1 })).rejects.toThrow('Unknown offline voice');
    expect(workers).toHaveLength(0);
  });

  it('passes on a failure from the worker', async () => {
    const { service, workers } = setup();
    const result = service.synthesize({ text: 'x', voice: 'af_heart', speed: 1 });
    workers[0].reply({ id: 1, ok: false, error: 'model missing' });
    await expect(result).rejects.toThrow('model missing');
    service.stop();
  });

  it('fails waiting requests if the worker dies, and starts a fresh one next time', async () => {
    const { service, workers } = setup();
    const result = service.synthesize({ text: 'x', voice: 'af_heart', speed: 1 });
    workers[0].exit(1);
    await expect(result).rejects.toThrow('stopped unexpectedly');
    void service.synthesize({ text: 'y', voice: 'af_heart', speed: 1 }).catch(() => {});
    expect(workers).toHaveLength(2);
    service.stop();
  });

  it('stops the worker after it has been idle, to give its memory back', async () => {
    vi.useFakeTimers();
    const { service, workers } = setup(1000);
    const result = service.synthesize({ text: 'x', voice: 'af_heart', speed: 1 });
    workers[0].reply({ id: 1, ok: true, audioBase64: '', mimeType: 'audio/wav', boundaries: [] });
    await result;
    vi.advanceTimersByTime(999);
    expect(workers[0].killed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(workers[0].killed).toBe(true);
  });

  it('clamps the speed to what the model handles', () => {
    const { service, workers } = setup();
    void service.synthesize({ text: 'x', voice: 'af_heart', speed: 5 }).catch(() => {});
    expect(workers[0].sent[0].speed).toBe(2);
    service.stop();
  });
});
