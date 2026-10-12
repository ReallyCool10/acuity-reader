import fs from 'node:fs';
import { isAllowedPath } from './paths';

/**
 * The scanner's own record of every file it has read, kept across restarts.
 *
 * The scan cache used to be seeded only from the saved library. That holds a
 * multi-file audiobook as one grouped item, so the files that make it up were
 * never in the cache after a restart, and every rescan parsed all of them
 * again: about half a megabyte read per track in testing, which adds up on a
 * large audiobook library or a slow drive. This keeps each file's own scan
 * result, so a rescan re-reads only files that changed.
 */

const FORMAT_VERSION = 1;

export interface ScanStore<T extends { filePath: string }> {
  get(filePath: string): T | undefined;
  /** Everything recorded inside `folder`: what its last scan found. */
  inFolder(folder: string): T[];
  /** Replace everything recorded inside `folder` with this scan's results. */
  replaceFolder(folder: string, items: T[]): void;
  /** Read the record from disk once; an unreadable file starts it empty. */
  load(): Promise<void>;
  /** Write the record atomically (temp file and rename). */
  save(): Promise<void>;
}

export function createScanStore<T extends { filePath: string }>(file: string): ScanStore<T> {
  const entries = new Map<string, T>();
  let loading: Promise<void> | null = null;

  async function read() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8')) as { version?: number; items?: T[] };
      if (parsed.version !== FORMAT_VERSION || !Array.isArray(parsed.items)) return;
      for (const item of parsed.items) {
        if (item && typeof item.filePath === 'string') entries.set(item.filePath, item);
      }
    } catch {
      // Missing or unreadable: the next scan rebuilds it.
    }
  }

  return {
    get: (filePath) => entries.get(filePath),

    inFolder: (folder) => [...entries.values()].filter((item) => isAllowedPath(item.filePath, [folder])),

    replaceFolder(folder, items) {
      for (const filePath of [...entries.keys()]) {
        if (isAllowedPath(filePath, [folder])) entries.delete(filePath);
      }
      for (const item of items) entries.set(item.filePath, item);
    },

    load() {
      loading ??= read();
      return loading;
    },

    async save() {
      const temp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, JSON.stringify({ version: FORMAT_VERSION, items: [...entries.values()] }), 'utf8');
      await fs.promises.rename(temp, file);
    },
  };
}
