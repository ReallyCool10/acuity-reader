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
