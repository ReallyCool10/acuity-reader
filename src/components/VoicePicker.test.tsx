import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePicker } from './VoicePicker';
import type { OfflineVoice } from '../hooks/useOfflineVoice';

function offline(overrides: Partial<OfflineVoice> = {}): OfflineVoice {
  return {
    status: { installed: false, downloading: false, downloadBytes: 92_361_116 },
    installed: false,
    downloading: false,
    progress: null,
    error: null,
    download: vi.fn().mockResolvedValue(true),
    cancel: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

describe('VoicePicker', () => {
  let container: HTMLDivElement;
  let root: Root;
  const getEdgeVoices = vi.fn().mockResolvedValue([]);

  beforeEach(() => {
    localStorage.clear();
    getEdgeVoices.mockClear();
    window.electronAPI = { getEdgeVoices, downloadOfflineVoice: vi.fn() } as unknown as typeof window.electronAPI;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const radio = (name: string) =>
    [...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent === name) as HTMLButtonElement;
  const select = () => container.querySelector('select') as HTMLSelectElement;

  it('switches between engines, remembering the last voice on each side', async () => {
    const onVoiceChange = vi.fn();
    const render = (voice: string, state = offline({ installed: true })) =>
      act(() => root.render(<VoicePicker voice={voice} onVoiceChange={onVoiceChange} offline={state} />));

    render('en-GB-SoniaNeural');
    expect(radio('Online').getAttribute('aria-checked')).toBe('true');

    act(() => radio('Offline').click());
    expect(onVoiceChange).toHaveBeenLastCalledWith('kokoro:af_heart');

    render('kokoro:af_heart');
    act(() => {
      select().value = 'kokoro:bf_emma';
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    render('kokoro:bf_emma');
    act(() => radio('Online').click());
    expect(onVoiceChange).toHaveBeenLastCalledWith('en-US-JennyNeural');

    render('en-US-JennyNeural');
    act(() => radio('Offline').click());
    expect(onVoiceChange).toHaveBeenLastCalledWith('kokoro:bf_emma');
  });

  it('offers the download, and the basic voice meanwhile, when the offline voice is not installed', () => {
    const onVoiceChange = vi.fn();
    const state = offline();
    act(() => root.render(<VoicePicker voice="en-US-JennyNeural" onVoiceChange={onVoiceChange} offline={state} />));
    act(() => radio('Offline').click());
    expect(onVoiceChange).toHaveBeenLastCalledWith('system-local');

    act(() => root.render(<VoicePicker voice="system-local" onVoiceChange={onVoiceChange} offline={state} />));
    expect([...select().options].map((o) => o.value)).toEqual(['system-local']);
    const download = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Download'))!;
    expect(download.textContent).toContain('92 MB');
    act(() => download.click());
    expect(state.download).toHaveBeenCalled();
  });

  it('asks Microsoft for its voice list only while the Online side is chosen', async () => {
    await act(async () =>
      root.render(<VoicePicker voice="kokoro:af_heart" onVoiceChange={vi.fn()} offline={offline({ installed: true })} />)
    );
    expect(getEdgeVoices).not.toHaveBeenCalled();
    expect(container.textContent).toContain('nothing is sent anywhere');

    await act(async () =>
      root.render(<VoicePicker voice="en-US-JennyNeural" onVoiceChange={vi.fn()} offline={offline({ installed: true })} />)
    );
    expect(getEdgeVoices).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('send the text being read aloud to Microsoft');
  });

  it('shows download progress with a way to cancel', () => {
    const state = offline({ downloading: true, progress: 0.42 });
    act(() => root.render(<VoicePicker voice="system-local" onVoiceChange={vi.fn()} offline={state} />));
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    act(() => (container.querySelector('button[aria-label="Cancel the download"]') as HTMLButtonElement).click());
    expect(state.cancel).toHaveBeenCalled();
  });
});
