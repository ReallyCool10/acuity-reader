import { describe, expect, it } from 'vitest';
import { isCacheHit, type CacheCandidate, type FileStatLike } from './scanCache';

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
