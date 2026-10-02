import { describe, it, expect } from 'vitest';
import { alignWordBoundaries, findWordIndexAt, sentenceBoundsAt, wordAt } from './narration';

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


describe('word tracking helpers', () => {
  describe('wordAt', () => {
    it('keeps apostrophes and hyphens inside words and leaves punctuation out', () => {
      const text = 'He said, “don’t go” — a well-known line.';
      const words: string[] = [];
      let w = wordAt(text, 0);
      while (w) {
        words.push(text.slice(w.start, w.end));
        w = wordAt(text, w.end);
      }
      expect(words).toEqual(['He', 'said', 'don’t', 'go', 'a', 'well-known', 'line']);
    });

    it('returns null when no word remains', () => {
      expect(wordAt('The end. ', 7)).toBeNull();
    });
  });

  describe('alignWordBoundaries', () => {
    const word = (text: string, offsetMs: number) => ({ type: 'word' as const, offsetMs, text });
    const sentence = (text: string, offsetMs: number) => ({ type: 'sentence' as const, offsetMs, text });

    it('uses word timings and ignores sentence entries when both are sent', () => {
      const text = 'The cat sat. The dog ran.';
      const aligned = alignWordBoundaries(text, [
        sentence('The cat sat.', 0), word('The', 0), word('cat', 300), word('sat', 600),
        sentence('The dog ran.', 1000), word('The', 1000), word('dog', 1300), word('ran', 1600),
      ]);
      expect(aligned.map((w) => text.slice(w.start, w.end))).toEqual(['The', 'cat', 'sat', 'The', 'dog', 'ran']);
      expect(aligned[3].start).toBe(13); // the second "The", not the first
    });

    it('never jumps backwards when a word cannot be matched', () => {
      // The old matcher retried from the start of the text on a miss, so this
      // unmatched word would have moved the highlight back to the first "the".
      const text = 'the start, then much later the end';
      const aligned = alignWordBoundaries(text, [
        word('the', 0), word('start', 200), word('then', 400), word('much', 600), word('later', 800),
        word('THE-UNMATCHED', 900), word('the', 1000), word('end', 1200),
      ]);
      const starts = aligned.map((w) => w.start);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(text.slice(aligned[aligned.length - 2].start, aligned[aligned.length - 2].end)).toBe('the');
      expect(aligned[aligned.length - 2].start).toBe(27);
    });

    it('matches words containing characters escaped for the speech service', () => {
      const text = "Don't stop & go.";
      const aligned = alignWordBoundaries(text, [word('Don&apos;t', 0), word('stop', 300), word('&amp;', 500), word('go', 700)]);
      expect(aligned.map((w) => text.slice(w.start, w.end))).toEqual(["Don't", 'stop', '&', 'go']);
    });

    it('recovers alignment after several unmatched words', () => {
      const text = 'alpha beta gamma delta epsilon zeta eta theta';
      const aligned = alignWordBoundaries(text, [
        word('alpha', 0), word('XX1', 100), word('XX2', 200), word('XX3', 300), word('theta', 400),
      ]);
      expect(aligned.map((w) => text.slice(w.start, w.end))).toEqual(['alpha', 'theta']);
    });

    it('falls back to sentence timings when no word timings are sent', () => {
      const text = 'One two. Three four.';
      const aligned = alignWordBoundaries(text, [sentence('One two.', 0), sentence('Three four.', 900)]);
      expect(aligned.map((w) => w.start)).toEqual([0, 9]);
    });
  });

  describe('findWordIndexAt', () => {
    const words = [0, 300, 600, 900].map((offsetMs, i) => ({ start: i * 4, end: i * 4 + 3, offsetMs }));

    it('returns the last word that has started', () => {
      expect(findWordIndexAt(words, 0)).toBe(0);
      expect(findWordIndexAt(words, 450)).toBe(1);
      expect(findWordIndexAt(words, 5000)).toBe(3);
    });

    it('returns -1 before the first word', () => {
      expect(findWordIndexAt(words, -1)).toBe(-1);
      expect(findWordIndexAt([], 100)).toBe(-1);
    });
  });
});
