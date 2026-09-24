import type { AudioChapter, AudioTrack, LibraryState, MediaItem, ProgressItem } from '../types';
import { cleanTitle, cleanTitleString } from './metadata';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function getFilename(filePath: string): string {
  const forward = filePath.lastIndexOf('/');
  const back = filePath.lastIndexOf('\\');
  const idx = Math.max(forward, back);
  return idx !== -1 ? filePath.substring(idx + 1) : filePath;
}

export function getDirectory(filePath: string): string {
  if (!filePath) return '';
  const forward = filePath.lastIndexOf('/');
  const back = filePath.lastIndexOf('\\');
  const idx = Math.max(forward, back);
  return idx !== -1 ? filePath.substring(0, idx) : '';
}

/**
 * Deterministic, collision-resistant 64-bit hex hash (16 characters) for composite IDs.
 * Pure TypeScript, zero Node / Electron imports.
 */
export function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

function normalizeIdentityPart(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The last two segments of a directory path, e.g. "Author/Book" or "Book/CD1". */
function trailingDirectory(dirPath: string): string {
  return dirPath.split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
}

/**
 * Stable ID for a multi-file audiobook.
 *
 * Derived only from what identifies the *book* - its embedded album tag, or
 * failing that the folder holding it - plus the author. It deliberately
 * excludes the track list and the cleaned display title. Hashing the track IDs
 * meant that adding, removing or retagging one file gave the book a new ID and
 * orphaned its progress, bookmarks and collection memberships; hashing the
 * cleaned title meant any change to the title heuristics re-identified every
 * grouped audiobook at once.
 *
 * The raw album tag is used rather than the cleaned one for the same reason.
 * Two folder segments are kept so per-disc folders like "CD1" stay distinct
 * across different books without tying the ID to the full, movable path.
 */
export function computeAudiobookGroupId(parts: {
  album?: string;
  dirPath: string;
  author?: string;
}): string {
  const author = normalizeIdentityPart(parts.author);
  const album = normalizeIdentityPart(parts.album);
  const identity = album
    ? `audiobook:album:${album}|a:${author}`
    : `audiobook:dir:${normalizeIdentityPart(trailingDirectory(parts.dirPath))}|a:${author}`;
  return hashString(identity);
}

/** The pre-fix ID formula, kept only so existing references can be migrated. */
function legacyAudiobookGroupId(bookTitle: string, author: string, trackIds: string[]): string {
  return hashString(`audiobook:${bookTitle.toLowerCase()}|${author.toLowerCase()}|${trackIds.join(',')}`);
}

/**
 * Given a global playback timestamp in seconds, finds the constituent track,
 * its index in the tracks array, and the local track offset in seconds.
 */
export function getTrackForTime(
  tracks: AudioTrack[],
  globalTime: number
): { track: AudioTrack; trackIndex: number; localTime: number } {
  if (!tracks || tracks.length === 0) {
    throw new Error('tracks array must not be empty');
  }

  const clampedGlobal = Math.max(0, globalTime);

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const trackEnd = track.offsetSeconds + track.durationSeconds;

    // Last track handles any overflow beyond total duration
    if (i === tracks.length - 1 || clampedGlobal < trackEnd) {
      const localTime = Math.max(0, Math.min(track.durationSeconds, clampedGlobal - track.offsetSeconds));
      return {
        track,
        trackIndex: i,
        localTime,
      };
    }
  }

  const lastTrack = tracks[tracks.length - 1];
  return {
    track: lastTrack,
    trackIndex: tracks.length - 1,
    localTime: lastTrack.durationSeconds,
  };
}

/**
 * Given a track index and local track time, returns the global book timestamp.
 */
export function getGlobalTime(tracks: AudioTrack[], trackIndex: number, localTime: number): number {
  if (!tracks || tracks.length === 0) return 0;
  const safeIdx = Math.max(0, Math.min(tracks.length - 1, trackIndex));
  return tracks[safeIdx].offsetSeconds + Math.max(0, localTime);
}

/**
 * Resolves reading/listening progress for a book.
 * If progress is not yet recorded for the composite book ID, checks if progress exists
 * for any of its constituent tracks and translates it to a global timestamp.
 */
export function resolveAudiobookProgress(
  item: MediaItem,
  progressMap: Record<string, ProgressItem>
): ProgressItem | undefined {
  if (!progressMap) return undefined;

  // 1. Exact match on composite item ID
  if (progressMap[item.id]) {
    return progressMap[item.id];
  }

  // 2. Check constituent tracks for migration/seamless resume
  if (item.tracks && item.tracks.length > 0) {
    let bestProgress: ProgressItem | undefined;
    let bestTrack: AudioTrack | undefined;

    for (const track of item.tracks) {
      const p = progressMap[track.id];
      if (p && (!bestProgress || (p.lastPlayed ?? 0) > (bestProgress.lastPlayed ?? 0))) {
        bestProgress = p;
        bestTrack = track;
      }
    }

    if (bestProgress && bestTrack) {
      const localCurrentTime = bestProgress.currentTime ?? 0;
      const globalCurrentTime = bestTrack.offsetSeconds + localCurrentTime;
      const totalDuration = item.durationSeconds && item.durationSeconds > 0 ? item.durationSeconds : 1;
      return {
        id: item.id,
        currentTime: globalCurrentTime,
        duration: totalDuration,
        // 0-100, the scale every other writer and reader of ProgressItem uses.
        // Returning 0-1 here hid half-read books from the Continue shelf, which
        // only shows items above 1 percent.
        percent: Math.min(100, Math.max(0, (globalCurrentTime / totalDuration) * 100)),
        lastPlayed: bestProgress.lastPlayed,
      };
    }
  }

  return undefined;
}

/**
 * Detects whether a filename indicates a numbered track or chapter in a series.
 */
function isNumberedTrack(name: string): boolean {
  return /^(?:track\s*|cd\s*\d+[-_\s]*|part\s*|chapter\s*|\d+[-_.\s]+)/i.test(name.trim());
}

/**
 * Groups multiple audio files that belong to the same multi-part audiobook into
 * a single composite MediaItem with constituent tracks and unified chapter markers.
 */
export function groupMultiFileAudiobooks(items: MediaItem[]): MediaItem[] {
  if (!items || items.length === 0) return [];

  const nonAudioItems: MediaItem[] = [];
  const audioItems: MediaItem[] = [];

  for (const item of items) {
    if (item.mediaType === 'audio') {
      audioItems.push(item);
    } else {
      nonAudioItems.push(item);
    }
  }

  // Cluster audio items by directory + album or directory
  const clusters = new Map<string, MediaItem[]>();

  for (const item of audioItems) {
    const dir = getDirectory(item.filePath);
    const normAlbum = item.album?.trim().toLowerCase();

    let clusterKey: string;
    if (normAlbum) {
      // Items sharing an album in the same directory (or parent tree) cluster together
      clusterKey = `album:${dir}::${normAlbum}`;
    } else {
      clusterKey = `dir:${dir}`;
    }

    const existing = clusters.get(clusterKey);
    if (existing) {
      existing.push(item);
    } else {
      clusters.set(clusterKey, [item]);
    }
  }

  const result: MediaItem[] = [...nonAudioItems];

  for (const [key, cluster] of clusters.entries()) {
    if (cluster.length === 1) {
      result.push(cluster[0]);
      continue;
    }

    // Verify whether this cluster truly represents a single multi-part work
    const isAlbumCluster = key.startsWith('album:');
    let shouldGroup = false;

    if (isAlbumCluster) {
      shouldGroup = true;
    } else {
      // Directory cluster: verify if files share common title or numbered tracks
      const baseTitles = new Set<string>();
      let numberedCount = 0;

      for (const item of cluster) {
        const { title } = cleanTitle(getFilename(item.filePath));
        baseTitles.add(title.toLowerCase());
        if (item.trackNumber != null || isNumberedTrack(getFilename(item.filePath))) {
          numberedCount++;
        }
      }

      // Group if all share the same base title or >= 70% are numbered tracks/chapters
      if (baseTitles.size === 1 || numberedCount / cluster.length >= 0.7) {
        shouldGroup = true;
      }
    }

    if (!shouldGroup) {
      // Disparate audio files in the same directory (e.g. general downloads folder)
      for (const item of cluster) {
        result.push(item);
      }
      continue;
    }

    // Sort tracks in natural order (disc, track number, filename)
    const sortedTracks = [...cluster].sort((a, b) => {
      const discA = a.discNumber ?? 1;
      const discB = b.discNumber ?? 1;
      if (discA !== discB) return discA - discB;

      const trackA = a.trackNumber ?? null;
      const trackB = b.trackNumber ?? null;
      if (trackA !== null && trackB !== null && trackA !== trackB) {
        return trackA - trackB;
      }

      const nameA = getFilename(a.filePath);
      const nameB = getFilename(b.filePath);
      return collator.compare(nameA, nameB);
    });

    // Build constituent tracks with cumulative timeline offsets
    let cumulativeOffset = 0;
    const constituentTracks: AudioTrack[] = [];
    let totalFileSize = 0;
    let latestModified = sortedTracks[0].fileModifiedAt ?? sortedTracks[0].dateAdded ?? 0;
    let earliestFirstSeen = sortedTracks[0].firstSeenAt ?? sortedTracks[0].dateAdded ?? Date.now();

    for (let i = 0; i < sortedTracks.length; i++) {
      const item = sortedTracks[i];
      const duration = item.durationSeconds && item.durationSeconds > 0 ? item.durationSeconds : 0;
      const offset = cumulativeOffset;
      cumulativeOffset += duration;
      totalFileSize += item.fileSize || 0;

      const itemMod = item.fileModifiedAt ?? item.dateAdded ?? 0;
      if (itemMod > latestModified) {
        latestModified = itemMod;
      }
      const itemSeen = item.firstSeenAt ?? item.dateAdded;
      if (typeof itemSeen === 'number' && !Number.isNaN(itemSeen) && itemSeen < earliestFirstSeen) {
        earliestFirstSeen = itemSeen;
      }

      constituentTracks.push({
        id: item.id,
        title: cleanTitleString(item.title) || item.title || `Track ${i + 1}`,
        filePath: item.filePath,
        durationSeconds: duration,
        offsetSeconds: offset,
        trackNumber: item.trackNumber ?? (i + 1),
        discNumber: item.discNumber,
        chapters: item.chapters,
      });
    }

    // Build timeline chapters spanning the entire audiobook
    const chapters: AudioChapter[] = [];
    for (let i = 0; i < constituentTracks.length; i++) {
      const track = constituentTracks[i];
      if (track.chapters && track.chapters.length > 0) {
        for (const ch of track.chapters) {
          chapters.push({
            id: `${track.id}-${ch.id}`,
            title: ch.title,
            startTime: Math.round((track.offsetSeconds + ch.startTime) * 100) / 100,
            endTime: ch.endTime ? Math.round((track.offsetSeconds + ch.endTime) * 100) / 100 : undefined,
          });
        }
      } else {
        chapters.push({
          id: `track-${i + 1}-${track.id}`,
          title: track.title,
          startTime: Math.round(track.offsetSeconds * 100) / 100,
          endTime: Math.round((track.offsetSeconds + track.durationSeconds) * 100) / 100,
        });
      }
    }

    // Choose representative metadata
    const firstItem = sortedTracks[0];
    const albumTitle = firstItem.album?.trim();
    const commonAuthor =
      sortedTracks.find((t) => t.author && t.author.toLowerCase() !== 'unknown')?.author ||
      firstItem.author;
    const representativeCover =
      sortedTracks.find((t) => Boolean(t.coverUrl))?.coverUrl || firstItem.coverUrl;

    let bookTitle: string;
    if (albumTitle) {
      bookTitle = cleanTitleString(albumTitle) || albumTitle;
    } else {
      const allBaseTitles = new Set(
        sortedTracks.map((t) => {
          const { title } = cleanTitle(getFilename(t.filePath));
          return title.toLowerCase();
        })
      );
      if (allBaseTitles.size === 1) {
        const { title: sharedTitle } = cleanTitle(getFilename(firstItem.filePath));
        bookTitle = sharedTitle;
      } else if (firstItem.dirName && firstItem.dirName.toLowerCase() !== 'unknown') {
        bookTitle = cleanTitleString(firstItem.dirName) || firstItem.dirName;
      } else {
        const { title: cleanBase } = cleanTitle(getFilename(firstItem.filePath));
        bookTitle = cleanBase || firstItem.title;
      }
    }

    const compositeId = computeAudiobookGroupId({
      album: firstItem.album,
      dirPath: getDirectory(firstItem.filePath),
      author: commonAuthor,
    });
    const legacyId = legacyAudiobookGroupId(
      bookTitle,
      commonAuthor,
      constituentTracks.map((t) => t.id)
    );

    const compositeBook: MediaItem = {
      id: compositeId,
      title: bookTitle,
      author: commonAuthor,
      filePath: firstItem.filePath,
      mediaType: 'audio',
      format: firstItem.format,
      fileSize: totalFileSize,
      fileModifiedAt: latestModified,
      firstSeenAt: earliestFirstSeen,
      dateAdded: earliestFirstSeen,
      dirName: firstItem.dirName,
      durationSeconds: cumulativeOffset,
      coverUrl: representativeCover,
      album: albumTitle,
      chapters,
      tracks: constituentTracks,
      legacyIds: legacyId !== compositeId ? [legacyId] : undefined,
    };

    result.push(compositeBook);
  }

  return assignUniqueGroupIds(result);
}

/**
 * Bring previously persisted composites onto the stable scheme and make IDs
 * unique within the library.
 *
 * Grouped books are persisted, and on load each arrives alone in its cluster
 * and passes through untouched - so without this step a composite saved under
 * the old scheme would keep its fragile ID until the next rescan re-identified
 * it without warning.
 *
 * Two copies of the same book in different folders would otherwise share an ID;
 * the second gets one salted with its directory, which is deterministic for a
 * given library.
 */
function assignUniqueGroupIds(items: MediaItem[]): MediaItem[] {
  const used = new Set<string>();

  return items.map((item) => {
    if (!item.tracks || item.tracks.length === 0) {
      used.add(item.id);
      return item;
    }

    const dirPath = getDirectory(item.filePath);
    const baseId = computeAudiobookGroupId({ album: item.album, dirPath, author: item.author });
    const id = used.has(baseId) ? hashString(`${baseId}|${dirPath.toLowerCase()}`) : baseId;
    used.add(id);

    if (id === item.id) return item;

    // Only a genuinely old ID is recorded as legacy. When the base ID was taken
    // by another copy, it belongs to that sibling - listing it here would let the
    // migration move the sibling's progress onto this book.
    const superseded = item.id === baseId ? [] : [item.id];
    const legacyIds = Array.from(new Set([...(item.legacyIds ?? []), ...superseded])).filter(
      (legacy) => legacy !== id
    );
    return { ...item, id, legacyIds: legacyIds.length > 0 ? legacyIds : undefined };
  });
}

/**
 * Move everything keyed by a superseded ID onto the item's current ID.
 *
 * Progress, bookmarks and collection members all reference items by ID, so when
 * an item is re-identified (see `legacyIds`) they must follow it or they are
 * silently orphaned. Where both IDs already hold data, nothing is discarded:
 * the more recently played progress wins, and bookmarks and members are merged.
 */
export function migrateLegacyItemIds(state: LibraryState): { state: LibraryState; changed: boolean } {
  const toCurrent = new Map<string, string>();
  for (const item of state.items) {
    for (const legacy of item.legacyIds ?? []) {
      if (legacy !== item.id) toCurrent.set(legacy, item.id);
    }
  }
  if (toCurrent.size === 0) return { state, changed: false };

  let changed = false;

  const progress = { ...state.progress };
  for (const [legacy, current] of toCurrent) {
    const old = progress[legacy];
    if (!old) continue;
    const existing = progress[current];
    if (!existing || (old.lastPlayed ?? 0) > (existing.lastPlayed ?? 0)) {
      progress[current] = { ...old, id: current };
    }
    delete progress[legacy];
    changed = true;
  }

  const bookmarks = { ...state.bookmarks };
  for (const [legacy, current] of toCurrent) {
    const old = bookmarks[legacy];
    if (!old) continue;
    const merged = [...(bookmarks[current] ?? [])];
    const seen = new Set(merged.map((b) => b.id));
    for (const bookmark of old) {
      if (!seen.has(bookmark.id)) merged.push({ ...bookmark, itemId: current });
    }
    bookmarks[current] = merged;
    delete bookmarks[legacy];
    changed = true;
  }

  const collections = (state.collections ?? []).map((collection) => {
    if (!collection.memberIds.some((id) => toCurrent.has(id))) return collection;
    changed = true;
    const memberIds: string[] = [];
    for (const id of collection.memberIds) {
      const mapped = toCurrent.get(id) ?? id;
      if (!memberIds.includes(mapped)) memberIds.push(mapped);
    }
    return { ...collection, memberIds, updatedAt: Date.now() };
  });

  return changed ? { state: { ...state, progress, bookmarks, collections }, changed } : { state, changed };
}

/**
 * Carry `legacyIds` from the previous item list onto a freshly scanned one.
 *
 * A rescan rebuilds every composite from raw tracks, which would drop legacy
 * IDs recorded on an earlier load. Keeping them means data still filed under
 * an old ID can be migrated even if files changed in between.
 */
export function carryForwardLegacyIds(previous: MediaItem[], next: MediaItem[]): MediaItem[] {
  const legacyById = new Map<string, string[]>();
  for (const item of previous) {
    if (item.legacyIds?.length) legacyById.set(item.id, item.legacyIds);
  }
  if (legacyById.size === 0) return next;

  return next.map((item) => {
    const carried = legacyById.get(item.id);
    if (!carried) return item;
    const legacyIds = Array.from(new Set([...(item.legacyIds ?? []), ...carried])).filter(
      (legacy) => legacy !== item.id
    );
    return { ...item, legacyIds };
  });
}

/**
 * Carry `firstSeenAt` from the previous item list onto a freshly scanned one.
 *
 * Scans rebuild library items from disk, where only file modification times are
 * available. An item's "added to library" timestamp must be set once and kept
 * across rescans. Lookups check both current ID and any recorded legacy IDs,
 * so re-identified composites keep their original addition date.
 */
export function carryForwardFirstSeenAt(
  previous: MediaItem[],
  next: MediaItem[],
  now: number = Date.now()
): MediaItem[] {
  const firstSeenById = new Map<string, number>();
  for (const item of previous) {
    const ts = item.firstSeenAt ?? item.dateAdded;
    if (typeof ts === 'number' && !Number.isNaN(ts)) {
      firstSeenById.set(item.id, ts);
      for (const legacy of item.legacyIds ?? []) {
        firstSeenById.set(legacy, ts);
      }
    }
  }

  return next.map((item) => {
    let seen = firstSeenById.get(item.id);
    if (seen === undefined && item.legacyIds?.length) {
      for (const legacy of item.legacyIds) {
        const found = firstSeenById.get(legacy);
        if (found !== undefined) {
          seen = found;
          break;
        }
      }
    }

    const firstSeenAt = seen ?? item.firstSeenAt ?? now;
    const fileModifiedAt = item.fileModifiedAt ?? item.dateAdded ?? now;

    return {
      ...item,
      firstSeenAt,
      fileModifiedAt,
      dateAdded: firstSeenAt,
    };
  });
}

