import { describe, it, expect } from 'vitest';
import type { EpubChapter } from './epub';
import { findChapterIndex, findFragment, parseBookTarget } from './epubLinks';

const chapter = (href: string): EpubChapter => ({ id: href, href, title: href, html: '', text: '', words: 0 });

describe('src/lib/epubLinks', () => {
  it('splits a target into its chapter path and decoded fragment', () => {
    expect(parseBookTarget('OEBPS/two.xhtml#caf%C3%A9')).toEqual({ path: 'OEBPS/two.xhtml', fragment: 'café' });
    expect(parseBookTarget('OEBPS/two.xhtml')).toEqual({ path: 'OEBPS/two.xhtml', fragment: '' });
  });

  it('finds a chapter despite differences in percent-encoding and case', () => {
    const chapters = [chapter('OEBPS/one.xhtml'), chapter('OEBPS/Chapter%202.xhtml')];
    expect(findChapterIndex(chapters, 'OEBPS/Chapter 2.xhtml')).toBe(1);
    expect(findChapterIndex(chapters, 'oebps/ONE.xhtml')).toBe(0);
    expect(findChapterIndex(chapters, 'OEBPS/skipped.xhtml')).toBe(-1);
  });

  it('finds the element a fragment names, by id or by an old-style named anchor', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p id="by-id">a</p><a name="by-name">b</a>';
    expect(findFragment(host, 'by-id')?.textContent).toBe('a');
    expect(findFragment(host, 'by-name')?.textContent).toBe('b');
    expect(findFragment(host, 'missing')).toBeNull();
    expect(findFragment(host, '')).toBeNull();
  });
});
