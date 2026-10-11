/** Bytes `start` to `end` of a file, both inclusive, as in a Content-Range header. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Read a `Range` request header against a file of `size` bytes (RFC 9110 14.1.2).
 *
 * Returns the range to send, `'unsatisfiable'` for a 416, or null to send the
 * whole file: no header, or one asking for several ranges, which a server may
 * answer in full.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    // A suffix range: the last N bytes, however large the file.
    const length = Number(match[2]);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
