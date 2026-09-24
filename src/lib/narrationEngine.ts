import type { EdgeSynthesisResult } from '../types';
import { base64ToBlobUrl, sentenceBoundsAt, splitNarrationChunks } from './narration';

export const LOCAL_VOICE_ID = 'local:system';

export interface NarrationSection {
  text: string;
}

export interface NarrationSource {
  /**
   * Retrieves the section content for a given index (e.g. chapter or page).
   * Return null if the section cannot be read, has no text, or is out of range.
   */
  getSection(index: number): Promise<NarrationSection | null>;

  /**
   * Check whether another section exists after the given index.
   */
  hasNextSection(index: number): boolean;

  /**
   * Optional callback when a section begins playing, allowing host UI to scroll or update views.
   */
  onSectionStart?: (index: number) => void | Promise<void>;
}

export interface NarrationState {
  isNarrating: boolean;
  sectionIndex: number;
  charIndex: number;
  voice: string;
  rate: number;
}

export interface NarrationEngineEvents {
  onStateChange?: (state: NarrationState) => void;
  onBoundary?: (charIndex: number, sectionIndex: number) => void;
  onSectionAdvance?: (sectionIndex: number) => void;
  onError?: (error: unknown) => void;
}

export interface NarrationEngineDependencies {
  createAudio?: () => HTMLAudioElement;
  speechSynthesis?: SpeechSynthesis;
  createSpeechUtterance?: (text: string) => SpeechSynthesisUtterance;
  synthesizeEdge?: (params: { text: string; voice: string; rate: number }) => Promise<EdgeSynthesisResult>;
  revokeBlobUrl?: (url: string) => void;
  base64ToBlobUrl?: (base64: string, mimeType?: string) => string;
}

export interface NarrationStartOptions {
  sectionIndex: number;
  charOffset?: number;
  voice?: string;
  rate?: number;
}

export class NarrationEngine {
  private source: NarrationSource;
  private events: NarrationEngineEvents;
  private deps: NarrationEngineDependencies;

  private isNarratingState = false;
  private currentSectionIndex = 0;
  private currentCharIndex = 0;
  private currentVoice = 'en-US-JennyNeural';
  private currentRate = 1.0;

  private abortController: AbortController | null = null;
  private prefetchPromise: Promise<EdgeSynthesisResult> | null = null;
  private currentBlobUrl: string | null = null;
  private audio: HTMLAudioElement | null = null;

  constructor(
    source: NarrationSource,
    events: NarrationEngineEvents = {},
    deps: NarrationEngineDependencies = {}
  ) {
    this.source = source;
    this.events = events;
    this.deps = deps;
  }

  public setSource(source: NarrationSource): void {
    this.source = source;
  }

  public setEvents(events: NarrationEngineEvents): void {
    this.events = events;
  }

  public getState(): NarrationState {
    return {
      isNarrating: this.isNarratingState,
      sectionIndex: this.currentSectionIndex,
      charIndex: this.currentCharIndex,
      voice: this.currentVoice,
      rate: this.currentRate,
    };
  }

  public async start(options: NarrationStartOptions): Promise<void> {
    this.stop(false);

    if (options.voice !== undefined) this.currentVoice = options.voice;
    if (options.rate !== undefined) this.currentRate = options.rate;
    this.currentSectionIndex = options.sectionIndex;
    this.currentCharIndex = Math.max(0, options.charOffset ?? 0);
    this.isNarratingState = true;

    this.notifyState();

    const abortController = new AbortController();
    this.abortController = abortController;

    await this.playSection(this.currentSectionIndex, this.currentCharIndex, abortController);
  }

  public stop(notify = true): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.prefetchPromise = null;

    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.ontimeupdate = null;
      this.audio.onended = null;
      this.audio.onerror = null;
    }

    if (this.currentBlobUrl) {
      this.revokeUrl(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }

    const synth = this.getSpeechSynthesis();
    synth?.cancel();

    const wasNarrating = this.isNarratingState;
    this.isNarratingState = false;

    if (notify && wasNarrating) {
      this.notifyState();
    }
  }

  public setVoice(newVoice: string): void {
    this.currentVoice = newVoice;
    if (this.isNarratingState) {
      void this.start({
        sectionIndex: this.currentSectionIndex,
        charOffset: this.currentCharIndex,
        voice: newVoice,
        rate: this.currentRate,
      });
    }
  }

  public setRate(newRate: number): void {
    this.currentRate = newRate;
    if (this.audio) {
      this.audio.playbackRate = newRate;
    }
    if (this.isNarratingState) {
      const synth = this.getSpeechSynthesis();
      if (synth?.speaking) {
        void this.start({
          sectionIndex: this.currentSectionIndex,
          charOffset: this.currentCharIndex,
          voice: this.currentVoice,
          rate: newRate,
        });
      }
    }
  }

  public destroy(): void {
    this.stop(false);
    this.audio = null;
    this.events = {};
  }

  private notifyState(): void {
    this.events.onStateChange?.(this.getState());
  }

  private getSpeechSynthesis(): SpeechSynthesis | undefined {
    return (
      this.deps.speechSynthesis ??
      (typeof window !== 'undefined' ? window.speechSynthesis : undefined)
    );
  }

  private revokeUrl(url: string): void {
    if (this.deps.revokeBlobUrl) {
      this.deps.revokeBlobUrl(url);
    } else if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  }

  private convertBlobUrl(base64: string, mimeType?: string): string {
    if (this.deps.base64ToBlobUrl) {
      return this.deps.base64ToBlobUrl(base64, mimeType);
    }
    return base64ToBlobUrl(base64, mimeType);
  }

  private async playSection(
    sectionIndex: number,
    startCharOffset: number,
    abortController: AbortController
  ): Promise<void> {
    if (abortController.signal.aborted) return;

    try {
      await this.source.onSectionStart?.(sectionIndex);
    } catch (err) {
      console.warn('Error in onSectionStart:', err);
    }

    if (abortController.signal.aborted) return;

    const section = await this.source.getSection(sectionIndex);
    if (abortController.signal.aborted) return;

    if (!section || !section.text.trim()) {
      // Empty or non-text section; advance if more sections remain
      if (this.source.hasNextSection(sectionIndex)) {
        this.events.onSectionAdvance?.(sectionIndex + 1);
        return this.playSection(sectionIndex + 1, 0, abortController);
      }
      this.stop();
      return;
    }

    const text = section.text;
    this.currentSectionIndex = sectionIndex;

    const clampedStart = Math.max(0, Math.min(startCharOffset, text.length));
    const sentenceBounds = sentenceBoundsAt(text, clampedStart);
    const startChar = clampedStart > 0 ? sentenceBounds.start : 0;
    this.currentCharIndex = startChar;

    // Immediately emit boundary for the active starting sentence
    this.events.onBoundary?.(startChar, sectionIndex);

    const apiSynthesize =
      this.deps.synthesizeEdge ??
      (typeof window !== 'undefined' ? window.electronAPI?.synthesizeEdge : undefined);

    const useEdge =
      this.currentVoice !== LOCAL_VOICE_ID &&
      apiSynthesize !== undefined &&
      typeof apiSynthesize === 'function';

    if (useEdge && apiSynthesize) {
      const textToNarrate = startChar > 0 ? text.slice(startChar) : text;
      const chunks = splitNarrationChunks(textToNarrate, 800, startChar);

      if (chunks.length === 0) {
        if (this.source.hasNextSection(sectionIndex)) {
          this.events.onSectionAdvance?.(sectionIndex + 1);
          return this.playSection(sectionIndex + 1, 0, abortController);
        }
        this.stop();
        return;
      }

      if (!this.audio) {
        this.audio = this.deps.createAudio?.() ?? new Audio();
      }
      const audio = this.audio;
      audio.playbackRate = this.currentRate;

      const playChunkAt = async (chunkIndex: number) => {
        if (abortController.signal.aborted) return;

        if (chunkIndex >= chunks.length) {
          // Finished all chunks in this section! Advance to next section if available.
          if (this.source.hasNextSection(sectionIndex)) {
            this.events.onSectionAdvance?.(sectionIndex + 1);
            return this.playSection(sectionIndex + 1, 0, abortController);
          }
          this.stop();
          return;
        }

        const chunk = chunks[chunkIndex];

        try {
          const synthesisResult = this.prefetchPromise
            ? await this.prefetchPromise
            : await apiSynthesize({
                text: chunk.text,
                voice: this.currentVoice,
                rate: this.currentRate,
              });
          this.prefetchPromise = null;

          if (abortController.signal.aborted) return;

          // Pre-fetch next chunk concurrently in background
          if (chunkIndex + 1 < chunks.length) {
            const nextPromise = apiSynthesize({
              text: chunks[chunkIndex + 1].text,
              voice: this.currentVoice,
              rate: this.currentRate,
            });
            nextPromise.catch(() => {});
            this.prefetchPromise = nextPromise;
          }

          let searchCursor = 0;
          const mappedBoundaries = synthesisResult.boundaries.map((b) => {
            let charOffset = -1;
            if (b.text) {
              const foundIdx = chunk.text.indexOf(b.text, searchCursor);
              if (foundIdx !== -1) {
                charOffset = foundIdx;
                searchCursor = foundIdx + b.text.length;
              } else {
                charOffset = chunk.text.indexOf(b.text);
              }
            }
            return { ...b, charOffset };
          });

          if (this.currentBlobUrl) {
            this.revokeUrl(this.currentBlobUrl);
            this.currentBlobUrl = null;
          }

          this.currentBlobUrl = this.convertBlobUrl(
            synthesisResult.audioBase64,
            synthesisResult.mimeType
          );
          audio.src = this.currentBlobUrl;
          audio.playbackRate = this.currentRate;

          audio.ontimeupdate = () => {
            if (abortController.signal.aborted) return;
            const timeMs = audio.currentTime * 1000;
            let active = mappedBoundaries.find(
              (b) => timeMs >= b.offsetMs && timeMs < b.offsetMs + b.durationMs
            );
            if (!active) {
              for (let i = mappedBoundaries.length - 1; i >= 0; i--) {
                if (timeMs >= mappedBoundaries[i].offsetMs) {
                  active = mappedBoundaries[i];
                  break;
                }
              }
            }

            if (active && active.charOffset !== -1) {
              const globalCharIdx = chunk.startChar + active.charOffset;
              this.currentCharIndex = globalCharIdx;
              this.events.onBoundary?.(globalCharIdx, sectionIndex);
            }
          };

          audio.onended = () => {
            if (this.currentBlobUrl) {
              this.revokeUrl(this.currentBlobUrl);
              this.currentBlobUrl = null;
            }
            void playChunkAt(chunkIndex + 1);
          };

          audio.onerror = () => {
            if (this.currentBlobUrl) {
              this.revokeUrl(this.currentBlobUrl);
              this.currentBlobUrl = null;
            }
            console.warn('Edge TTS playback failed, falling back to local speech');
            this.playLocalSpeech(text, this.currentCharIndex, sectionIndex, abortController);
          };

          await audio.play();
        } catch (err) {
          if (abortController.signal.aborted) return;
          console.warn('Edge TTS synthesis failed, falling back to local speech:', err);
          this.playLocalSpeech(text, this.currentCharIndex, sectionIndex, abortController);
        }
      };

      void playChunkAt(0);
      return;
    }

    this.playLocalSpeech(text, startChar, sectionIndex, abortController);
  }

  private playLocalSpeech(
    text: string,
    fromChar: number,
    sectionIndex: number,
    abortController: AbortController
  ): void {
    const synth = this.getSpeechSynthesis();
    if (!synth) {
      this.stop();
      return;
    }

    synth.cancel();

    const bounds = sentenceBoundsAt(text, Math.max(0, fromChar));
    const startChar = fromChar > 0 ? bounds.start : 0;
    this.currentCharIndex = startChar;
    this.events.onBoundary?.(startChar, sectionIndex);

    const textToSpeak = startChar > 0 ? text.slice(startChar) : text;
    const createUtterance =
      this.deps.createSpeechUtterance ??
      ((t: string) => new SpeechSynthesisUtterance(t));

    const utterance = createUtterance(textToSpeak);
    utterance.rate = this.currentRate;

    utterance.onboundary = (event) => {
      if (abortController.signal.aborted) return;
      const globalCharIdx = startChar + event.charIndex;
      this.currentCharIndex = globalCharIdx;
      this.events.onBoundary?.(globalCharIdx, sectionIndex);
    };

    utterance.onend = () => {
      if (abortController.signal.aborted) return;
      if (this.source.hasNextSection(sectionIndex)) {
        this.events.onSectionAdvance?.(sectionIndex + 1);
        void this.playSection(sectionIndex + 1, 0, abortController);
      } else {
        this.stop();
      }
    };

    utterance.onerror = () => {
      if (abortController.signal.aborted) return;
      this.stop();
    };

    synth.speak(utterance);
  }
}
