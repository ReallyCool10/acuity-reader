import type { EdgeSynthesisResult } from '../types';
import {
  alignWordBoundaries,
  base64ToBlobUrl,
  findWordIndexAt,
  sentenceBoundsAt,
  splitNarrationChunks,
  wordAt,
} from './narration';
import { isOnlineVoice } from './tts';

/*
 * The engine deliberately has no voice-ID constant of its own. It once defined
 * a second LOCAL_VOICE_ID ('local:system') that did not match the picker's
 * ('system-local' in ./tts), so choosing the offline system voice was treated
 * as an online voice and the narrated text was sent to Microsoft. Re-exported
 * so existing imports keep resolving to the single source of truth.
 */
export { LOCAL_VOICE_ID } from './tts';

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
  /**
   * The word being spoken: its start offset in the section text and its length.
   * Fires once per word (not on every audio tick), so handlers can do real work.
   */
  onBoundary?: (charIndex: number, sectionIndex: number, length: number) => void;
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
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
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
  private frameHandle: number | null = null;
  /** Start offset of the last word reported, so each word is reported once. */
  private lastReportedChar = -1;
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
    this.stopFrameLoop();

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
    /*
     * Restart from the current word rather than speeding up the clip in place.
     * Online audio is already synthesised at the chosen speed, so changing
     * playbackRate as well applied the speed twice (1.5x played at 2.25x).
     */
    if (this.isNarratingState) {
      void this.start({
        sectionIndex: this.currentSectionIndex,
        charOffset: this.currentCharIndex,
        voice: this.currentVoice,
        rate: newRate,
      });
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

  /** Report the word at `charIndex`, once; repeated reports of the same word are ignored. */
  private reportWord(charIndex: number, length: number, sectionIndex: number): void {
    this.currentCharIndex = charIndex;
    if (charIndex === this.lastReportedChar) return;
    this.lastReportedChar = charIndex;
    this.events.onBoundary?.(charIndex, sectionIndex, Math.max(1, length));
  }

  /** Report the first word starting at or after `charIndex` in `text`. */
  private reportWordAt(text: string, charIndex: number, sectionIndex: number): void {
    const word = wordAt(text, charIndex);
    if (word) this.reportWord(word.start, word.end - word.start, sectionIndex);
  }

  private startFrameLoop(tick: () => void): void {
    this.stopFrameLoop();
    const request =
      this.deps.requestFrame ??
      (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined);
    if (!request) return;
    const loop = () => {
      tick();
      this.frameHandle = request(loop);
    };
    this.frameHandle = request(loop);
  }

  private stopFrameLoop(): void {
    if (this.frameHandle === null) return;
    const cancel =
      this.deps.cancelFrame ??
      (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : undefined);
    cancel?.(this.frameHandle);
    this.frameHandle = null;
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

    // Show the first word straight away, before any audio has arrived.
    this.lastReportedChar = -1;
    this.reportWordAt(text, startChar, sectionIndex);

    const apiSynthesize =
      this.deps.synthesizeEdge ??
      (typeof window !== 'undefined' ? window.electronAPI?.synthesizeEdge : undefined);

    // Privacy boundary: only an online voice may send text off the machine.
    const useEdge =
      isOnlineVoice(this.currentVoice) &&
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
      // The speech service has already applied the speed; see setRate().
      audio.playbackRate = 1;

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

          const words = alignWordBoundaries(chunk.text, synthesisResult.boundaries);

          if (this.currentBlobUrl) {
            this.revokeUrl(this.currentBlobUrl);
            this.currentBlobUrl = null;
          }

          this.currentBlobUrl = this.convertBlobUrl(
            synthesisResult.audioBase64,
            synthesisResult.mimeType
          );
          audio.src = this.currentBlobUrl;
          audio.playbackRate = 1;

          /*
           * Follow the audio word by word. Checked on every animation frame:
           * timeupdate alone fires only ~4 times a second, which is too coarse
           * for words. timeupdate stays as a fallback for when frames are
           * throttled (a hidden window). Each word is reported once.
           */
          const syncToAudio = () => {
            if (abortController.signal.aborted) return;
            const index = findWordIndexAt(words, audio.currentTime * 1000);
            if (index < 0) return;
            const word = words[index];
            this.reportWord(chunk.startChar + word.start, word.end - word.start, sectionIndex);
          };
          audio.ontimeupdate = syncToAudio;
          this.startFrameLoop(syncToAudio);

          audio.onended = () => {
            this.stopFrameLoop();
            if (this.currentBlobUrl) {
              this.revokeUrl(this.currentBlobUrl);
              this.currentBlobUrl = null;
            }
            void playChunkAt(chunkIndex + 1);
          };

          audio.onerror = () => {
            this.stopFrameLoop();
            if (this.currentBlobUrl) {
              this.revokeUrl(this.currentBlobUrl);
              this.currentBlobUrl = null;
            }
            console.warn('Edge TTS playback failed, falling back to local speech');
            this.playLocalSpeech(text, this.currentCharIndex, sectionIndex, abortController);
          };

          await audio.play();
        } catch (err) {
          // play() can reject after the frame loop started; left running, it
          // would keep pulling the highlight back to this clip's first word
          // while the system voice reads on.
          this.stopFrameLoop();
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
    this.lastReportedChar = -1;
    this.reportWordAt(text, startChar, sectionIndex);

    const textToSpeak = startChar > 0 ? text.slice(startChar) : text;
    const createUtterance =
      this.deps.createSpeechUtterance ??
      ((t: string) => new SpeechSynthesisUtterance(t));

    const utterance = createUtterance(textToSpeak);
    utterance.rate = this.currentRate;

    utterance.onboundary = (event) => {
      if (abortController.signal.aborted) return;
      // Sentence events would move the highlight back to the sentence start.
      if (event.name && event.name !== 'word') return;
      const globalCharIdx = startChar + event.charIndex;
      // charLength is not reported by every voice; measure the word instead.
      if (event.charLength && event.charLength > 0) {
        this.reportWord(globalCharIdx, event.charLength, sectionIndex);
      } else {
        this.reportWordAt(text, globalCharIdx, sectionIndex);
      }
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
