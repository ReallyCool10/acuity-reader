import type { EdgeBoundary } from './edgeTts';

/*
 * Audio and word timings for the offline voice.
 *
 * Kokoro returns audio but no word boundaries, so timings are estimated. The
 * text is synthesised a sentence at a time, which makes each sentence's start
 * exact; within a sentence, words are spread across its audio in proportion
 * to their length, with extra weight where punctuation makes the voice pause.
 * Any drift is confined to one sentence and corrected at the next.
 */

export const KOKORO_SAMPLE_RATE = 24000;

/** Extra weight (in characters) for the pause after a word ending in this punctuation. */
function pauseWeight(word: string): number {
  if (/[.!?…]["'”’)\]]*$/.test(word)) return 6;
  if (/[;:—–]["'”’)\]]*$/.test(word)) return 4;
  if (/[,]["'”’)\]]*$/.test(word)) return 3;
  return 0;
}

/** Estimated word boundaries for one sentence's audio, which starts at `startMs`. */
export function estimateWordBoundaries(sentence: string, startMs: number, durationMs: number): EdgeBoundary[] {
  const words = [...sentence.matchAll(/\S+/g)].map((m) => m[0]);
  if (words.length === 0 || durationMs <= 0) return [];
  // +1 per word stands in for the gap between words.
  const weights = words.map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').length + 1 + pauseWeight(word));
  const total = weights.reduce((a, b) => a + b, 0);

  const boundaries: EdgeBoundary[] = [];
  let elapsed = 0;
  words.forEach((word, i) => {
    const span = (weights[i] / total) * durationMs;
    // The spoken word, without its trailing pause, is what gets highlighted.
    const spoken = span * ((weights[i] - pauseWeight(word)) / weights[i]);
    boundaries.push({
      type: 'word',
      offsetMs: Math.round(startMs + elapsed),
      durationMs: Math.max(1, Math.round(spoken)),
      text: word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || word,
      length: word.length,
    });
    elapsed += span;
  });
  return boundaries;
}

/** 16-bit mono PCM WAV from float samples in [-1, 1]. */
export function encodeWav(chunks: Float32Array[], sampleRate: number = KOKORO_SAMPLE_RATE): Buffer {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(samples * 2, 40);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), offset);
      offset += 2;
    }
  }
  return out;
}

/**
 * Split text into the pieces synthesised one at a time: sentences, with a
 * long sentence broken at commas and finally at spaces, because the model
 * reads at most about 500 phonemes per call and truncates anything longer.
 */
export function splitForSynthesis(text: string, maxChars = 300): string[] {
  const sentences = text.match(/[^.!?…\n]+(?:[.!?…]+["'”’)\]]*|\n+|$)/g) ?? [];
  const pieces: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' — '));
      const at = cut > maxChars / 3 ? cut + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : maxChars;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  return pieces;
}
