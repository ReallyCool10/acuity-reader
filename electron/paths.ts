import path from 'node:path';

/** Directories the renderer is permitted to read from: library roots + our cover cache. */
export const allowedRoots = new Set<string>();

export function registerAllowedRoot(dir: string | undefined | null): void {
  if (!dir) return;
  try {
    allowedRoots.add(path.resolve(dir));
  } catch {
    // Ignore unusable paths.
  }
}

export function clearAllowedRoots(): void {
  allowedRoots.clear();
}

/**
 * True when `target` sits inside one of the allowed roots.
 *
 * Compares resolved paths segment-wise via path.relative rather than by string
 * prefix: a prefix test would let "/books-private" through on the strength of an
 * allowed "/books".
 *
 * @param target File path to test
 * @param roots Optional iterable of roots; defaults to the module-level allowedRoots set
 */
export function isAllowedPath(target: string, roots: Iterable<string> = allowedRoots): boolean {
  if (!target) return false;
  const resolved = path.resolve(target);
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    const rel = path.relative(resolvedRoot, resolved);
    if (rel === '') return true;
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}
