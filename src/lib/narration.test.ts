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

  it('respects character offset when slicing from a mid-point', async () => {
    const { splitNarrationChunks } = await import('./narration');
    const text = 'Sentence one. Sentence two.';
    const chunks = splitNarrationChunks(text, 100, 50);
    expect(chunks[0].startChar).toBe(50);
    expect(chunks[0].endChar).toBe(50 + text.length);
  });
});

describe('src/lib/narration - buildNarrationMap & rangeFor', () => {
  it('inserts terminal punctuation and double newlines after headings without periods', async () => {
    const { buildNarrationMap, sentenceBoundsAt, rangeFor } = await import('./narration');
    const container = document.createElement('div');
    container.innerHTML = '<h1>Chapter 1 Introduction</h1><p>It was a dark and stormy night.</p>';
    document.body.appendChild(container);

    const map = buildNarrationMap(container);
    expect(map.text).toContain('Chapter 1 Introduction.\n\nIt was a dark and stormy night.');

    // Heading should be isolated as sentence 1
    const bounds1 = sentenceBoundsAt(map.text, 5);
    expect(map.text.slice(bounds1.start, bounds1.end).trim()).toBe('Chapter 1 Introduction.');

    // Paragraph should be isolated as sentence 2
    const bounds2 = sentenceBoundsAt(map.text, map.text.indexOf('dark'));
    expect(map.text.slice(bounds2.start, bounds2.end).trim()).toBe('It was a dark and stormy night.');

    // Range for sentence 1 should successfully map to the H1 text node
    const range1 = rangeFor(map, bounds1.start, bounds1.end);
    expect(range1).not.toBeNull();
    expect(range1?.toString()).toBe('Chapter 1 Introduction');

    // Range for sentence 2 should map to the P text node
    const range2 = rangeFor(map, bounds2.start, bounds2.end);
    expect(range2).not.toBeNull();
    expect(range2?.toString()).toBe('It was a dark and stormy night.');

    document.body.removeChild(container);
  });

  it('preserves existing terminal punctuation on headings', async () => {
    const { buildNarrationMap } = await import('./narration');
    const container = document.createElement('div');
    container.innerHTML = '<h2>Where to Go Next?</h2><p>The road forks.</p>';
    document.body.appendChild(container);

    const map = buildNarrationMap(container);
    // Should NOT have 'Next?.'
    expect(map.text).toContain('Where to Go Next?\n\nThe road forks.');

    document.body.removeChild(container);
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

