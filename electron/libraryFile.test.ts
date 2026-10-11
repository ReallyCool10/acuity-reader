import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keepUnreadableLibrary } from './libraryFile';

describe('electron/libraryFile - keepUnreadableLibrary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acuity-library-'));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('copies an unreadable library aside, leaving the original in place', async () => {
    const file = path.join(dir, 'acuity_library.json');
    fs.writeFileSync(file, '{"items": [ truncated');
    const copy = await keepUnreadableLibrary(file, new Date('2026-10-11T12:34:56.789Z'));

    expect(copy).toBe(path.join(dir, 'acuity_library.corrupt-2026-10-11T12-34-56-789Z.json'));
    expect(fs.readFileSync(copy!, 'utf8')).toBe('{"items": [ truncated');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('does nothing when there is no library file yet', async () => {
    expect(await keepUnreadableLibrary(path.join(dir, 'missing.json'))).toBeNull();
  });
});
