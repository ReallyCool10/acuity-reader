import { describe, it, expect } from 'vitest';
import { searchInText, escapeRegExp } from './search';

describe('search module', () => {
  it('escapes regex characters properly', () => {
    expect(escapeRegExp('hello (world) [test] * ? +')).toBe('hello \\(world\\) \\[test\\] \\* \\? \\+');
  });

  it('returns empty array when query is empty or only whitespace', () => {
    expect(searchInText('Some text', '', 0, 'Chapter 1')).toEqual([]);
    expect(searchInText('Some text', '   ', 0, 'Chapter 1')).toEqual([]);
  });

  it('finds exact matches and extracts contextual snippets', () => {
    const text = 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.';
    const results = searchInText(text, 'fortune', 1, 'Chapter 1');

    expect(results).toHaveLength(1);
    expect(results[0].locationIndex).toBe(1);
    expect(results[0].locationLabel).toBe('Chapter 1');
    expect(results[0].matchedText).toBe('fortune');
    expect(results[0].snippetBefore).toContain('possession of a good');
    expect(results[0].snippetAfter).toContain('must be in want');
    expect(results[0].id).toBe('match-1-82');
  });

  it('performs case-insensitive searches', () => {
    const text = 'Truth truth TRUTH';
    const results = searchInText(text, 'truth', 0, 'Ch 1');

    expect(results).toHaveLength(3);
    expect(results[0].matchedText).toBe('Truth');
    expect(results[1].matchedText).toBe('truth');
    expect(results[2].matchedText).toBe('TRUTH');
  });

  it('respects maxMatches limit', () => {
    const text = 'test test test test test';
    const results = searchInText(text, 'test', 0, 'Ch 1', 2);

    expect(results).toHaveLength(2);
  });
});
