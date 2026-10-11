export interface CacheCandidate {
  title?: string;
  format?: string;
  coverUrl?: string;
  fileSize: number;
  fileModifiedAt?: number;
  dateAdded?: number;
}

export interface FileStatLike {
  size: number;
  mtimeMs: number;
}

/**
 * Pure function determining whether a cached file metadata item can be reused
 * without re-reading the file tags or cover art from disk.
 *
 * Cache invalidation rules:
 * 1. Missing cached item -> invalid (cache miss)
 * 2. Corrupted shadow-library title -> invalid (force re-extraction)
 * 3. Generic cover art (e.g. folder.jpg, cover.jpg) -> invalid (force re-extraction)
 * 4. EPUB cover from the old filename guess (covers/<md5>.jpg) -> invalid, so it is
 *    extracted again from the book's own cover declaration (epubCover.ts)
 * 5. File size differs -> invalid
 * 6. Modification time differs by 1000ms or more -> invalid
 */
export function isCacheHit(
  cached: CacheCandidate | undefined | null,
  stat: FileStatLike
): boolean {
  if (!cached) return false;

  const hasCorruptedTitle =
    Boolean(cached.title && /(?:zblibrary|z-lib|1lib|libgen|\.sk\b|etc\.\))/i.test(cached.title));
  if (hasCorruptedTitle) return false;

  const hasGenericCover =
    Boolean(cached.coverUrl && /(?:cover|folder|front|albumart)\.(?:jpe?g|png|webp)$/i.test(cached.coverUrl));
  if (hasGenericCover) return false;

  const hasGuessedEpubCover =
    cached.format === 'epub' && Boolean(cached.coverUrl && /[\\/][0-9a-f]{32}\.jpg$/i.test(cached.coverUrl));
  if (hasGuessedEpubCover) return false;

  if (cached.fileSize !== stat.size) return false;

  // Prefer fileModifiedAt; fall back to legacy dateAdded for libraries loaded before migration
  const cachedMtime = cached.fileModifiedAt ?? cached.dateAdded;
  if (typeof cachedMtime !== 'number' || Number.isNaN(cachedMtime)) return false;

  return Math.abs(cachedMtime - stat.mtimeMs) < 1000;
}
