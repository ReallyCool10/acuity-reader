import fs from 'node:fs';

/**
 * Keep a copy of a library file that could not be read.
 *
 * When acuity_library.json fails to load, the app carries on with an empty
 * library, and the next change would save that over the file, losing a library
 * that may only need one bad character fixed. The copy, beside it as
 * acuity_library.corrupt-<time>.json, can be repaired or restored. Returns the
 * copy's path, or null if there was nothing to keep.
 */
export async function keepUnreadableLibrary(filePath: string, now = new Date()): Promise<string | null> {
  if (!fs.existsSync(filePath)) return null;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const copy = filePath.replace(/\.json$/i, '') + `.corrupt-${stamp}.json`;
  await fs.promises.copyFile(filePath, copy);
  return copy;
}
