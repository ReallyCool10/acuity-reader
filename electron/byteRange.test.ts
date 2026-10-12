import { describe, it, expect } from 'vitest';
import { parseByteRange } from './byteRange';

describe('electron/byteRange - parseByteRange', () => {
  it('reads an open-ended range, as <audio> asks when it seeks', () => {
    expect(parseByteRange('bytes=1000-', 5000)).toEqual({ start: 1000, end: 4999 });
  });

  it('clamps a range that runs past the end of the file', () => {
    expect(parseByteRange('bytes=0-99999', 5000)).toEqual({ start: 0, end: 4999 });
  });

  it('reads a suffix range as the last N bytes, not the first', () => {
    expect(parseByteRange('bytes=-500', 5000)).toEqual({ start: 4500, end: 4999 });
    expect(parseByteRange('bytes=-9000', 5000)).toEqual({ start: 0, end: 4999 });
  });

  it('refuses a range that starts past the end, or is backwards', () => {
    expect(parseByteRange('bytes=5000-', 5000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=20-10', 5000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 5000)).toBe('unsatisfiable');
  });

  it('sends the whole file for no range, a malformed one, or several ranges', () => {
    expect(parseByteRange(null, 5000)).toBeNull();
    expect(parseByteRange('bytes=-', 5000)).toBeNull();
    expect(parseByteRange('bytes=0-1,5-6', 5000)).toBeNull();
    expect(parseByteRange('items=0-1', 5000)).toBeNull();
  });
});
