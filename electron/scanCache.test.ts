import { describe, expect, it } from 'vitest';
import { findCacheHit, isCacheHit, type CacheCandidate, type FileStatLike } from './scanCache';

describe('electron/scanCache - isCacheHit', () => {
  const baseStat: FileStatLike = {
    size: 1048576,
    mtimeMs: 1700000000000,
  };

  const validCandidate: CacheCandidate = {
    title: 'The Great Gatsby',
    coverUrl: 'acuity://covers/valid-hash.jpg',
    fileSize: 1048576,
    fileModifiedAt: 1700000000000,
  };

  it('returns true when size and fileModifiedAt match within 1000ms', () => {
    expect(isCacheHit(validCandidate, baseStat)).toBe(true);

    // Within sub-second tolerance (e.g. filesystem timestamp rounding)
    expect(
      isCacheHit(
        { ...validCandidate, fileModifiedAt: baseStat.mtimeMs + 500 },
        baseStat
      )
    ).toBe(true);
    expect(
      isCacheHit(
        { ...validCandidate, fileModifiedAt: baseStat.mtimeMs - 999 },
        baseStat
      )
    ).toBe(true);
  });

  it('falls back to legacy dateAdded if fileModifiedAt is not set', () => {
    const legacyCandidate: CacheCandidate = {
      title: 'The Great Gatsby',
      coverUrl: 'acuity://covers/valid-hash.jpg',
      fileSize: 1048576,
      dateAdded: 1700000000000,
    };
    expect(isCacheHit(legacyCandidate, baseStat)).toBe(true);
  });

  it('returns false if cached item is null or undefined', () => {
    expect(isCacheHit(null, baseStat)).toBe(false);
    expect(isCacheHit(undefined, baseStat)).toBe(false);
  });

  it('returns false if file size differs', () => {
    expect(
      isCacheHit(
        { ...validCandidate, fileSize: 1048575 },
        baseStat
      )
    ).toBe(false);
  });

  it('returns false if mtime difference is 1000ms or greater', () => {
    expect(
      isCacheHit(
        { ...validCandidate, fileModifiedAt: baseStat.mtimeMs + 1000 },
        baseStat
      )
    ).toBe(false);
    expect(
      isCacheHit(
        { ...validCandidate, fileModifiedAt: baseStat.mtimeMs - 1000 },
        baseStat
      )
    ).toBe(false);
    expect(
      isCacheHit(
        { ...validCandidate, fileModifiedAt: baseStat.mtimeMs + 5000 },
        baseStat
      )
    ).toBe(false);
  });

  it('re-extracts an EPUB cover chosen by the old filename guess, and only that', () => {
    const md5 = '0123456789abcdef0123456789abcdef';
    const guessed = { ...validCandidate, format: 'epub', coverUrl: `C:\\Users\\R\\AppData\\covers\\${md5}.jpg` };
    expect(isCacheHit(guessed, baseStat)).toBe(false);

    // Covers from the book's own declaration, audio covers in the same cache, and EPUBs with
    // no cover or a sidecar image are all kept.
    expect(isCacheHit({ ...guessed, coverUrl: `C:\\covers\\${md5}.epub-v2.png` }, baseStat)).toBe(true);
    expect(isCacheHit({ ...guessed, format: 'm4b' }, baseStat)).toBe(true);
    expect(isCacheHit({ ...guessed, coverUrl: undefined }, baseStat)).toBe(true);
    expect(isCacheHit({ ...guessed, coverUrl: 'D:/Books/Dune.jpg' }, baseStat)).toBe(true);
  });

  it('returns false if title contains corrupted shadow-library artifacts', () => {
    expect(
      isCacheHit(
        { ...validCandidate, title: 'Clean Book (z-lib.org)' },
        baseStat
      )
    ).toBe(false);
    expect(
      isCacheHit(
        { ...validCandidate, title: 'Some Title (libgen.li)' },
        baseStat
      )
    ).toBe(false);
    expect(
      isCacheHit(
        { ...validCandidate, title: 'Downloaded from 1lib.sk' },
        baseStat
      )
    ).toBe(false);
  });

  it('returns false if coverUrl points to a generic folder/cover image', () => {
    expect(
      isCacheHit(
        { ...validCandidate, coverUrl: '/music/album/folder.jpg' },
        baseStat
      )
    ).toBe(false);
    expect(
      isCacheHit(
        { ...validCandidate, coverUrl: '/music/album/cover.png' },
        baseStat
      )
    ).toBe(false);
    expect(
      isCacheHit(
        { ...validCandidate, coverUrl: '/music/album/front.jpeg' },
        baseStat
      )
    ).toBe(false);
    expect(
      isCacheHit(
        { ...validCandidate, coverUrl: '/music/album/albumart.webp' },
        baseStat
      )
    ).toBe(false);
  });

  it('returns false if neither fileModifiedAt nor dateAdded are provided', () => {
    const noDateCandidate: CacheCandidate = {
      title: 'The Great Gatsby',
      coverUrl: 'acuity://covers/valid-hash.jpg',
      fileSize: 1048576,
    };
    expect(isCacheHit(noDateCandidate, baseStat)).toBe(false);
  });
});

describe('electron/scanCache - findCacheHit', () => {
  const trackStat: FileStatLike = { size: 30_000_000, mtimeMs: 1700000000000 };
  const trackRecord: CacheCandidate = { title: 'Part 1', fileSize: 30_000_000, fileModifiedAt: 1700000000000 };

  it("uses a track's own record when the library holds its grouped audiobook", () => {
    // Saved under the first track's path, with the size of all three tracks.
    const groupedBook: CacheCandidate = { title: 'The Long Book', fileSize: 90_000_000, fileModifiedAt: 1700000000000 };
    expect(findCacheHit([groupedBook, trackRecord], trackStat)).toBe(trackRecord);
  });

  it("prefers the library's own item, which carries the user's edits", () => {
    const edited: CacheCandidate = { ...trackRecord, title: 'Edited title' };
    expect(findCacheHit([edited, trackRecord], trackStat)).toBe(edited);
  });

  it('finds nothing when the file has changed', () => {
    expect(findCacheHit([trackRecord], { ...trackStat, size: 1 })).toBeUndefined();
    expect(findCacheHit([undefined, null], trackStat)).toBeUndefined();
  });
});
