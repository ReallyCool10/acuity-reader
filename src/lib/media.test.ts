import { describe, it, expect } from 'vitest';
import { coverThumbUrl, coverUrl } from './media';

describe('src/lib/media - cover URLs', () => {
  const windowsCover = 'C:\\Users\\Reader\\AppData\\Roaming\\Acuity Reader\\covers\\3f2a#1.jpg';

  it('asks the main process for a thumbnail of a local cover', () => {
    const url = new URL(coverThumbUrl({ coverUrl: windowsCover }));
    // electron/main.ts serveFile routes on the host and decodes the path the same way.
    expect(url.protocol).toBe('acuity:');
    expect(url.hostname).toBe('thumb');
    expect(decodeURIComponent(url.pathname.replace(/^\//, ''))).toBe(windowsCover);
  });

  it('keeps the full-size cover for the full-screen player', () => {
    expect(new URL(coverUrl({ coverUrl: windowsCover })).hostname).toBe('media');
  });

  it('normalises legacy file:/// covers and leaves non-file covers alone', () => {
    expect(coverThumbUrl({ coverUrl: 'file:///C:/Books/Dune.jpg' })).toBe(
      `acuity://thumb/${encodeURIComponent('C:/Books/Dune.jpg')}`
    );
    expect(coverThumbUrl({ coverUrl: 'data:image/png;base64,AAAA' })).toBe('data:image/png;base64,AAAA');
    expect(coverThumbUrl({ coverUrl: undefined })).toBe('');
  });
});
