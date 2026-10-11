import { describe, it, expect, vi } from 'vitest';
import type { MediaItem } from '../types';
import { makePdfCovers, type PdfCoverApi } from './pdfCovers';

const pdf = (id: string, overrides: Partial<MediaItem> = {}): MediaItem => ({
  id,
  title: id,
  author: '',
  filePath: `C:/books/${id}.pdf`,
  mediaType: 'book',
  format: 'pdf',
  fileSize: 1,
  fileModifiedAt: 0,
  firstSeenAt: 0,
  dirName: 'books',
  ...overrides,
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);
const api: PdfCoverApi = { savePdfCover: vi.fn(async (filePath: string) => `C:/covers/${filePath.slice(9)}.jpg`) };

describe('src/lib/pdfCovers - makePdfCovers', () => {
  it('draws covers only for PDFs without art, and reports them by item', async () => {
    const render = vi.fn(async () => JPEG);
    const onCovers = vi.fn();
    await makePdfCovers(
      [
        pdf('plain'),
        pdf('has-art', { coverUrl: 'C:/books/has-art.jpg' }),
        pdf('epub', { format: 'epub', filePath: 'C:/books/epub.epub' }),
      ],
      onCovers,
      api,
      render
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith('C:/books/plain.pdf');
    expect(onCovers).toHaveBeenCalledWith(new Map([['plain', 'C:/covers/plain.pdf.jpg']]));
  });

  it('does not retry a PDF that cannot be drawn', async () => {
    const render = vi.fn(async () => null);
    const onCovers = vi.fn();
    await makePdfCovers([pdf('encrypted')], onCovers, api, render);
    await makePdfCovers([pdf('encrypted')], onCovers, api, render);

    expect(render).toHaveBeenCalledTimes(1);
    expect(onCovers).not.toHaveBeenCalled();
  });

  it('reports covers a few at a time rather than after every one', async () => {
    const onCovers = vi.fn();
    const items = Array.from({ length: 10 }, (_, i) => pdf(`batch-${i}`));
    await makePdfCovers(items, onCovers, api, async () => JPEG);

    expect(onCovers.mock.calls.map(([covers]) => covers.size)).toEqual([8, 2]);
  });
});
