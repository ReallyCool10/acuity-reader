import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NarrationEngine,
  LOCAL_VOICE_ID,
  type NarrationSource,
  type NarrationSection,
  type NarrationState,
  type NarrationEngineDependencies,
} from './narrationEngine';
import type { EdgeSynthesisResult } from '../types';

describe('NarrationEngine', () => {
  let mockSource: NarrationSource;
  let sections: Record<number, string>;
  let mockAudio: {
    src: string;
    playbackRate: number;
    currentTime: number;
    paused: boolean;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    ontimeupdate: (() => void) | null;
    onended: (() => void) | null;
    onerror: (() => void) | null;
  };
  let mockSpeechSynthesis: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    speaking: boolean;
  };
  let mockSynthesizeEdge: ReturnType<typeof vi.fn>;
  let revokedUrls: string[];

  beforeEach(() => {
    sections = {
      0: 'First chapter opening. The sun was rising.',
      1: 'Second chapter begins here. A gentle breeze blew.',
    };

    mockSource = {
      getSection: vi.fn(async (idx: number): Promise<NarrationSection | null> => {
        if (sections[idx] !== undefined) {
          return { text: sections[idx] };
        }
        return null;
      }),
      hasNextSection: vi.fn((idx: number) => idx < Object.keys(sections).length - 1),
      onSectionStart: vi.fn(async () => {}),
    };

    mockAudio = {
      src: '',
      playbackRate: 1.0,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockImplementation(async () => {
        mockAudio.paused = false;
      }),
      pause: vi.fn().mockImplementation(() => {
        mockAudio.paused = true;
      }),
      ontimeupdate: null,
      onended: null,
      onerror: null,
    };

    mockSpeechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      speaking: false,
    };

    mockSynthesizeEdge = vi.fn(async ({ text }: { text: string }): Promise<EdgeSynthesisResult> => {
      return {
        audioBase64: 'bW9ja2F1ZGlv',
        mimeType: 'audio/mp3',
        boundaries: [
          { offsetMs: 0, durationMs: 500, text: text.slice(0, 5), length: 5, type: 'word' },
          { offsetMs: 500, durationMs: 1000, text: text.slice(6, 13), length: 7, type: 'word' },
        ],
      };
    });

    revokedUrls = [];
  });

  function createTestEngine(events = {}) {
    return new NarrationEngine(mockSource, events, {
      createAudio: () => mockAudio as unknown as HTMLAudioElement,
      speechSynthesis: mockSpeechSynthesis as unknown as SpeechSynthesis,
      synthesizeEdge: mockSynthesizeEdge as NarrationEngineDependencies['synthesizeEdge'],
      createSpeechUtterance: (text: string) =>
        ({
          text,
          rate: 1,
          onboundary: null,
          onend: null,
          onerror: null,
        } as unknown as SpeechSynthesisUtterance),
      revokeBlobUrl: (url: string) => revokedUrls.push(url),
      base64ToBlobUrl: (base64: string) => `blob:mock-${base64}`,
    });
  }

  it('starts narration with Edge TTS, updates state, and plays audio', async () => {
    const states: NarrationState[] = [];
    const boundaries: { char: number; section: number }[] = [];

    const engine = createTestEngine({
      onStateChange: (s: NarrationState) => states.push(s),
      onBoundary: (char: number, section: number) => boundaries.push({ char, section }),
    });

    await engine.start({ sectionIndex: 0, voice: 'en-US-JennyNeural', rate: 1.2 });

    expect(engine.getState().isNarrating).toBe(true);
    expect(engine.getState().sectionIndex).toBe(0);
    expect(engine.getState().rate).toBe(1.2);
    expect(mockSource.onSectionStart).toHaveBeenCalledWith(0);
    expect(mockSource.getSection).toHaveBeenCalledWith(0);
    expect(mockSynthesizeEdge).toHaveBeenCalled();
    expect(mockAudio.play).toHaveBeenCalled();
    expect(mockAudio.src).toBe('blob:mock-bW9ja2F1ZGlv');
    expect(mockAudio.playbackRate).toBe(1.2);

    // Initial boundary emitted for starting sentence
    expect(boundaries.length).toBeGreaterThanOrEqual(1);
    expect(boundaries[0]).toEqual({ char: 0, section: 0 });
  });

  it('emits onBoundary when audio timeupdate matches boundary marks', async () => {
    const boundaries: { char: number; section: number }[] = [];
    const engine = createTestEngine({
      onBoundary: (char: number, section: number) => boundaries.push({ char, section }),
    });

    await engine.start({ sectionIndex: 0 });

    expect(mockAudio.ontimeupdate).toBeDefined();

    // Trigger timeupdate at 600ms (matches second boundary in mock data)
    mockAudio.currentTime = 0.6;
    mockAudio.ontimeupdate!();

    expect(boundaries.some((b) => b.char > 0)).toBe(true);
  });

  it('advances continuously across sections when chunk ends', async () => {
    const sectionAdvances: number[] = [];
    const engine = createTestEngine({
      onSectionAdvance: (sec: number) => sectionAdvances.push(sec),
    });

    await engine.start({ sectionIndex: 0 });

    expect(mockAudio.onended).toBeDefined();

    // Trigger audio ended for section 0
    mockAudio.onended!();
    // Allow async chain to process
    await new Promise((r) => setTimeout(r, 10));

    expect(sectionAdvances).toContain(1);
    expect(mockSource.onSectionStart).toHaveBeenCalledWith(1);
    expect(mockSource.getSection).toHaveBeenCalledWith(1);
    expect(engine.getState().sectionIndex).toBe(1);
    expect(engine.getState().isNarrating).toBe(true);
  });

  it('stops narration when the last section finishes', async () => {
    const engine = createTestEngine();

    // Start directly on the last section (1)
    await engine.start({ sectionIndex: 1 });
    expect(engine.getState().isNarrating).toBe(true);

    // Trigger audio ended on last section
    mockAudio.onended!();
    await new Promise((r) => setTimeout(r, 10));

    expect(engine.getState().isNarrating).toBe(false);
    expect(mockAudio.pause).toHaveBeenCalled();
  });

  it('automatically skips empty or image-only sections to the next section', async () => {
    sections = {
      0: '', // empty page
      1: 'Content on page 2.',
    };

    const sectionAdvances: number[] = [];
    const engine = createTestEngine({
      onSectionAdvance: (sec: number) => sectionAdvances.push(sec),
    });

    await engine.start({ sectionIndex: 0 });

    expect(sectionAdvances).toContain(1);
    expect(mockSource.getSection).toHaveBeenCalledWith(0);
    expect(mockSource.getSection).toHaveBeenCalledWith(1);
    expect(engine.getState().sectionIndex).toBe(1);
    expect(engine.getState().isNarrating).toBe(true);
  });

  it('falls back to local speech when local voice is selected', async () => {
    const engine = createTestEngine();

    await engine.start({ sectionIndex: 0, voice: LOCAL_VOICE_ID });

    expect(mockSynthesizeEdge).not.toHaveBeenCalled();
    expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
  });

  it('falls back to local speech if Edge synthesis rejects', async () => {
    mockSynthesizeEdge.mockRejectedValueOnce(new Error('Network error'));
    const engine = createTestEngine();

    await engine.start({ sectionIndex: 0 });

    expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
  });

  it('hot-swaps voice and rate while narrating', async () => {
    const engine = createTestEngine();
    await engine.start({ sectionIndex: 0 });

    engine.setVoice('en-US-GuyNeural');
    expect(engine.getState().voice).toBe('en-US-GuyNeural');

    engine.setRate(1.5);
    expect(engine.getState().rate).toBe(1.5);
    expect(mockAudio.playbackRate).toBe(1.5);
  });

  it('stops and cleans up blob URLs and aborts on stop()', async () => {
    const engine = createTestEngine();
    await engine.start({ sectionIndex: 0 });

    expect(engine.getState().isNarrating).toBe(true);

    engine.stop();

    expect(engine.getState().isNarrating).toBe(false);
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(revokedUrls.length).toBeGreaterThan(0);
  });
});
