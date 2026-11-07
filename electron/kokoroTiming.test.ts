import { describe, expect, it } from 'vitest';
import { encodeWav, estimateWordBoundaries, splitForSynthesis } from './kokoroTiming';
import { alignWordBoundaries } from '../src/lib/narration';

describe('estimateWordBoundaries', () => {
  it('spreads words across the sentence in order, starting at its offset', () => {
    const words = estimateWordBoundaries('It was a bright cold day in April.', 1000, 3000);
    expect(words.map((w) => w.text)).toEqual(['It', 'was', 'a', 'bright', 'cold', 'day', 'in', 'April']);
    expect(words[0].offsetMs).toBe(1000);
    for (let i = 1; i < words.length; i++) expect(words[i].offsetMs).toBeGreaterThan(words[i - 1].offsetMs);
    expect(words.at(-1)!.offsetMs).toBeLessThan(4000);
  });

  it('gives longer words more time, and leaves a pause after punctuation', () => {
    const [short, long] = estimateWordBoundaries('a extraordinarily', 0, 2000);
    expect(long.durationMs).toBeGreaterThan(short.durationMs * 5);
    const [, afterComma] = estimateWordBoundaries('Yes, no', 0, 1000);
    const [, afterSpace] = estimateWordBoundaries('Yes no', 0, 1000);
    expect(afterComma.offsetMs).toBeGreaterThan(afterSpace.offsetMs);
  });

  it('produces boundaries the reader can align to the text, as it does for the online voice', () => {
    const text = 'Hello, world. "Quoted" words!';
    const words = alignWordBoundaries(text, estimateWordBoundaries(text, 0, 2000));
    expect(words.map((w) => text.slice(w.start, w.end))).toEqual(['Hello', 'world', 'Quoted', 'words']);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clamps samples', () => {
    const wav = encodeWav([new Float32Array([0, 1, -1, 2])], 24000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect([0, 1, 2, 3].map((i) => wav.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32768, 32767]);
  });
});

describe('splitForSynthesis', () => {
  it('splits into sentences', () => {
    expect(splitForSynthesis('One. Two? "Three!" Four')).toEqual(['One.', 'Two?', '"Three!"', 'Four']);
  });

  it('treats a heading line as its own piece', () => {
    expect(splitForSynthesis('Chapter One\n\nIt began.')).toEqual(['Chapter One', 'It began.']);
  });

  it('breaks a sentence too long for the model at commas, then spaces, losing nothing', () => {
    const long = Array.from({ length: 40 }, (_, i) => `clause number ${i}`).join(', ') + '.';
    const pieces = splitForSynthesis(long, 120);
    expect(pieces.every((p) => p.length <= 120)).toBe(true);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });
});
