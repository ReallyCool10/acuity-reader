import { describe, it, expect } from 'vitest';
import { sentenceBoundsAt } from './narration';

describe('src/lib/narration - sentenceBoundsAt', () => {
  const text =
    'First sentence is short. The second sentence is much longer and interesting! Finally, the third sentence.';

  it('isolates the first sentence when offset is within the first sentence', () => {
    const bounds = sentenceBoundsAt(text, 5);
    expect(text.slice(bounds.start, bounds.end).trim()).toBe('First sentence is short.');
  });

  it('isolates the correct sentence at a mid-string offset', () => {
    const midOffset = text.indexOf('longer');
    const bounds = sentenceBoundsAt(text, midOffset);
    expect(bounds.start).toBe('First sentence is short. '.length);
    expect(text.slice(bounds.start, bounds.end).trim()).toBe(
      'The second sentence is much longer and interesting!'
    );
  });

  it('isolates the third sentence near the end of string', () => {
    const endOffset = text.indexOf('third');
    const bounds = sentenceBoundsAt(text, endOffset);
    expect(text.slice(bounds.start, bounds.end).trim()).toBe('Finally, the third sentence.');
  });

  it('handles paragraph breaks as sentence terminators', () => {
    const multiPara = 'First paragraph content.\n\nSecond paragraph content begins right here.';
    const bounds = sentenceBoundsAt(multiPara, multiPara.indexOf('begins'));
    expect(multiPara.slice(bounds.start, bounds.end).trim()).toBe(
      'Second paragraph content begins right here.'
    );
  });
});

describe('src/lib/narration - splitNarrationChunks', () => {
  it('returns empty array for empty text', async () => {
    const { splitNarrationChunks } = await import('./narration');
    expect(splitNarrationChunks('')).toEqual([]);
    expect(splitNarrationChunks('   ')).toEqual([]);
  });

  it('keeps short text in a single chunk', async () => {
    const { splitNarrationChunks } = await import('./narration');
    const text = 'This is a short chapter with two sentences. Everything fits.';
    const chunks = splitNarrationChunks(text, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[0].endChar).toBe(text.length);
  });

  it('splits longer text on sentence boundaries when exceeding maxLen', async () => {
    const { splitNarrationChunks } = await import('./narration');
    const text = 'First sentence goes here. Second sentence follows immediately. Third sentence concludes the story.';
    const chunks = splitNarrationChunks(text, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Verifying text reconstruction coverage
    for (const chunk of chunks) {
      expect(text.slice(chunk.startChar, chunk.endChar).trim()).toBe(chunk.text);
    }
  });
});

describe('src/lib/narration - base64ToBlobUrl', () => {
  it('creates an object URL from base64 audio bytes', async () => {
    const { base64ToBlobUrl } = await import('./narration');
    const sampleBase64 = btoa('RIFF....WAVEfmt ');
    const url = base64ToBlobUrl(sampleBase64, 'audio/wav');
    expect(url).toMatch(/^blob:/);
  });
});

