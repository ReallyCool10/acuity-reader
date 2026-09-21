import path from 'node:path';
import { normalizeString } from './id';

export interface PairableItem {
  filePath: string;
  mediaType: 'audio' | 'book';
  format: string;
  title: string;
  author: string;
  dirName: string;
  companionPath?: string;
  companionType?: string;
}

/**
 * Pair audio and text editions of the same work.
 *
 * Pairing rules:
 * 1. Same-folder stem match: Files in the exact same directory sharing the same filename
 *    stem (e.g. `Dune.m4b` and `Dune.epub`) are paired with highest confidence.
 * 2. Cross-folder title + author match: If both title and author match (and author is known),
 *    they are paired even if stored in separate Audio/ and Books/ directories.
 *    Two unrelated books sharing a title (e.g. "Persuasion" by different authors) never collide.
 * 3. Unknown-author fallback: If author is missing or 'unknown', items only pair if they
 *    share the same directory name or stem to prevent false positives.
 * 4. Multi-item groups: All audio and book editions in a matched group receive companion links.
 */
export function pairCompanions<T extends PairableItem>(items: T[]): void {
  // Clear any stale companion pointers first
  for (const item of items) {
    delete item.companionPath;
    delete item.companionType;
  }

  // 1. First pass: exact same directory + filename stem
  const byDirStem = new Map<string, T[]>();
  for (const item of items) {
    const dir = path.dirname(item.filePath).toLowerCase();
    const stem = normalizeString(path.basename(item.filePath, path.extname(item.filePath)));
    const key = `${dir}:::${stem}`;
    if (!byDirStem.has(key)) byDirStem.set(key, []);
    byDirStem.get(key)!.push(item);
  }

  for (const group of byDirStem.values()) {
    const audioItems = group.filter((i) => i.mediaType === 'audio');
    const bookItems = group.filter((i) => i.mediaType === 'book');
    if (audioItems.length > 0 && bookItems.length > 0) {
      const primaryBook = bookItems[0];
      const primaryAudio = audioItems[0];

      for (const audio of audioItems) {
        if (!audio.companionPath) {
          audio.companionPath = primaryBook.filePath;
          audio.companionType = primaryBook.format;
        }
      }
      for (const book of bookItems) {
        if (!book.companionPath) {
          book.companionPath = primaryAudio.filePath;
          book.companionType = primaryAudio.format;
        }
      }
    }
  }

  // 2. Second pass: Title + Author matching
  const byWork = new Map<string, T[]>();
  for (const item of items) {
    const normTitle = normalizeString(item.title).replace(/[^a-z0-9]/g, '');
    const normAuthor = normalizeString(item.author).replace(/[^a-z0-9]/g, '');

    if (!normTitle) continue;

    let workKey: string | null = null;
    const isAuthorKnown = normAuthor && normAuthor !== 'unknown';

    if (isAuthorKnown) {
      workKey = `work:${normTitle}:::${normAuthor}`;
    } else {
      // If author is unknown, only pair within the same directory name
      const normDir = normalizeString(item.dirName).replace(/[^a-z0-9]/g, '');
      if (normDir) {
        workKey = `dir:${normTitle}:::${normDir}`;
      }
    }

    if (!workKey) continue;
    if (!byWork.has(workKey)) byWork.set(workKey, []);
    byWork.get(workKey)!.push(item);
  }

  for (const group of byWork.values()) {
    const audioItems = group.filter((i) => i.mediaType === 'audio');
    const bookItems = group.filter((i) => i.mediaType === 'book');

    if (audioItems.length > 0 && bookItems.length > 0) {
      const primaryBook = bookItems[0];
      const primaryAudio = audioItems[0];

      // Connect all audio items in the group to the book
      for (const audio of audioItems) {
        if (!audio.companionPath) {
          audio.companionPath = primaryBook.filePath;
          audio.companionType = primaryBook.format;
        }
      }

      // Connect all book items in the group to the audio
      for (const book of bookItems) {
        if (!book.companionPath) {
          book.companionPath = primaryAudio.filePath;
          book.companionType = primaryAudio.format;
        }
      }
    }
  }
}
