import type { MediaItem } from '../types';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function getFilename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/**
 * Finds sibling tracks for a multi-file audiobook.
 * Tracks belonging to the same album or directory are sorted in natural track order
 * (disc number, track number, or natural filename order).
 */
export function findSiblingTracks(
  current: MediaItem,
  allItems: MediaItem[]
): {
  playlist: MediaItem[];
  currentIndex: number;
  prevItem: MediaItem | null;
  nextItem: MediaItem | null;
} {
  const currentAlbum = current.album?.trim().toLowerCase();

  const siblings = allItems.filter((item) => {
    if (item.mediaType !== 'audio') return false;
    if (currentAlbum && item.album?.trim().toLowerCase() === currentAlbum) return true;
    return item.dirName === current.dirName;
  });

  const playlist = siblings.sort((a, b) => {
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

  const currentIndex = playlist.findIndex((item) => item.id === current.id);
  if (currentIndex === -1 || playlist.length <= 1) {
    return {
      playlist,
      currentIndex: Math.max(0, currentIndex),
      prevItem: null,
      nextItem: null,
    };
  }

  return {
    playlist,
    currentIndex,
    prevItem: currentIndex > 0 ? playlist[currentIndex - 1] : null,
    nextItem: currentIndex < playlist.length - 1 ? playlist[currentIndex + 1] : null,
  };
}
