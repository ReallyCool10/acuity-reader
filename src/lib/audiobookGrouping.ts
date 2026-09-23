import type { AudioChapter, AudioTrack, MediaItem, ProgressItem } from '../types';
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
        percent: Math.min(1, Math.max(0, globalCurrentTime / totalDuration)),
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
    let earliestDateAdded = sortedTracks[0].dateAdded;

    for (let i = 0; i < sortedTracks.length; i++) {
      const item = sortedTracks[i];
      const duration = item.durationSeconds && item.durationSeconds > 0 ? item.durationSeconds : 0;
      const offset = cumulativeOffset;
      cumulativeOffset += duration;
      totalFileSize += item.fileSize || 0;
      if (item.dateAdded && item.dateAdded > earliestDateAdded) {
        earliestDateAdded = item.dateAdded;
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

    // Generate deterministic stable composite ID
    const compositeId = hashString(
      `audiobook:${bookTitle.toLowerCase()}|${commonAuthor.toLowerCase()}|${constituentTracks.map((t) => t.id).join(',')}`
    );

    const compositeBook: MediaItem = {
      id: compositeId,
      title: bookTitle,
      author: commonAuthor,
      filePath: firstItem.filePath,
      mediaType: 'audio',
      format: firstItem.format,
      fileSize: totalFileSize,
      dateAdded: earliestDateAdded,
      dirName: firstItem.dirName,
      durationSeconds: cumulativeOffset,
      coverUrl: representativeCover,
      album: albumTitle,
      chapters,
      tracks: constituentTracks,
    };

    result.push(compositeBook);
  }

  return result;
}
