import { describe, it, expect, vi } from 'vitest';
import type * as pdfjsLib from 'pdfjs-dist';
import { extractPdfOutline, extractPdfPageText, getPdfInfo, renderPdfPage } from './pdf';

describe('src/lib/pdf', () => {
  describe('extractPdfOutline', () => {
    it('returns empty array when doc has no outline', async () => {
      const mockDoc = {
        getOutline: vi.fn().mockResolvedValue(null),
      } as unknown as pdfjsLib.PDFDocumentProxy;

      const outline = await extractPdfOutline(mockDoc);
      expect(outline).toEqual([]);
    });

    it('extracts flat and nested outline nodes with resolved page numbers', async () => {
      const mockDoc = {
        getOutline: vi.fn().mockResolvedValue([
          {
            title: 'Chapter 1: Introduction',
            dest: ['pageRef1', { name: 'XYZ' }],
          },
          {
            title: 'Chapter 2: Deep Dive',
            dest: 'namedDest2',
            items: [
              {
                title: 'Section 2.1: Fundamentals',
                dest: ['pageRef3'],
              },
            ],
          },
        ]),
        getDestination: vi.fn().mockImplementation(async (name) => {
          if (name === 'namedDest2') return ['pageRef2'];
          return null;
        }),
        getPageIndex: vi.fn().mockImplementation(async (ref) => {
          if (ref === 'pageRef1') return 0; // 0-based page index -> page 1
          if (ref === 'pageRef2') return 14; // -> page 15
          if (ref === 'pageRef3') return 22; // -> page 23
          return 0;
        }),
      } as unknown as pdfjsLib.PDFDocumentProxy;

      const outline = await extractPdfOutline(mockDoc);
      expect(outline).toHaveLength(3);
      expect(outline[0]).toMatchObject({
        title: 'Chapter 1: Introduction',
        pageNumber: 1,
      });
      expect(outline[1]).toMatchObject({
        title: 'Chapter 2: Deep Dive',
        pageNumber: 15,
      });
      expect(outline[2]).toMatchObject({
        title: 'Section 2.1: Fundamentals',
        pageNumber: 23,
      });
    });
  });

  describe('getPdfInfo', () => {
    it('extracts metadata and total page count', async () => {
      const mockDoc = {
        numPages: 42,
        getMetadata: vi.fn().mockResolvedValue({
          info: {
            Title: 'The Art of Computer Programming',
            Author: 'Donald E. Knuth',
          },
        }),
        getOutline: vi.fn().mockResolvedValue([]),
      } as unknown as pdfjsLib.PDFDocumentProxy;

      const info = await getPdfInfo(mockDoc);
      expect(info.numPages).toBe(42);
      expect(info.title).toBe('The Art of Computer Programming');
      expect(info.author).toBe('Donald E. Knuth');
      expect(info.outline).toEqual([]);
    });
  });

  describe('renderPdfPage', () => {
    it('scales canvas dimensions by devicePixelRatio and invokes page.render', async () => {
      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 800, height: 1200 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      } as unknown as pdfjsLib.PDFPageProxy;

      const canvas = document.createElement('canvas');
      const mockContext = {} as CanvasRenderingContext2D;
      vi.spyOn(canvas, 'getContext').mockReturnValue(mockContext);

      await renderPdfPage(mockPage, canvas, 1.5);

      expect(mockPage.getViewport).toHaveBeenCalled();
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(1200);
      expect(mockPage.render).toHaveBeenCalledWith({
        canvasContext: mockContext,
        viewport: { width: 800, height: 1200 },
      });
    });
  });

  describe('extractPdfPageText', () => {
    it('concatenates and cleans text items from page content', async () => {
      const mockPage = {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Chapter' },
            { str: '1:' },
            { str: 'A' },
            { str: 'New' },
            { str: 'Beginning' },
          ],
        }),
      } as unknown as pdfjsLib.PDFPageProxy;

      const text = await extractPdfPageText(mockPage);
      expect(text).toBe('Chapter 1: A New Beginning');
    });
  });
});

