import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Initialize the worker source for Vite / Electron
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export interface PdfDocumentInfo {
  numPages: number;
  title?: string;
  author?: string;
  outline: PdfChapter[];
}

export interface PdfChapter {
  id: string;
  title: string;
  pageNumber: number; // 1-based index
}

/**
 * Loads a PDF document from a URL or ArrayBuffer/Uint8Array.
 */
export async function loadPdfDocument(
  source: string | Uint8Array | ArrayBuffer
): Promise<pdfjsLib.PDFDocumentProxy> {
  const loadingTask =
    typeof source === 'string'
      ? pdfjsLib.getDocument({ url: source })
      : pdfjsLib.getDocument({ data: source instanceof Uint8Array ? source : new Uint8Array(source) });

  return loadingTask.promise;
}

/** Reads bytes [start, end) of one file, with the file's total size. */
export type ByteRangeReader = (start: number, end: number) => Promise<{ bytes: Uint8Array; size: number } | null>;

/**
 * Feeds pdf.js only the byte ranges it asks for. Streaming a PDF from its
 * `acuity://` URL does not work from the renderer: the page's origin is
 * file://, so CORS blocks script from reading the response, and the reader
 * falls back to copying the whole file. This reads ranges over IPC instead.
 */
class RangeReaderTransport extends pdfjsLib.PDFDataRangeTransport {
  private readonly readRange: ByteRangeReader;

  constructor(size: number, initialData: Uint8Array, readRange: ByteRangeReader) {
    super(size, initialData);
    this.readRange = readRange;
  }

  requestDataRange(begin: number, end: number) {
    void this.readRange(begin, end).then((result) => {
      if (result) this.onDataRange(begin, result.bytes);
    });
  }
}

const COVER_INITIAL_BYTES = 64 * 1024;
const COVER_TIMEOUT_MS = 30_000;

/**
 * A PDF's first page as a JPEG, fitted within `maxSize` pixels, to serve as its
 * cover. Only the parts of the file page 1 needs are read, so a large scanned
 * book costs no more than a small one. Null if the page cannot be drawn.
 *
 * pdf.js parses in its own worker and draws in short slices between frames, so
 * this does not hold up scrolling.
 */
export async function renderPdfCover(readRange: ByteRangeReader, maxSize: number): Promise<Uint8Array | null> {
  const first = await readRange(0, COVER_INITIAL_BYTES).catch(() => null);
  if (!first || first.size === 0) return null;

  const task = pdfjsLib.getDocument({
    range: new RangeReaderTransport(first.size, first.bytes, readRange),
    disableAutoFetch: true,
    disableStream: true,
  });
  // A range that never arrives would otherwise leave pdf.js waiting for good.
  const timeout = setTimeout(() => void task.destroy(), COVER_TIMEOUT_MS);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxSize / Math.max(natural.width, natural.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    void task.destroy();
  }
}

/**
 * Extracts metadata and outline chapters from a PDF document.
 */
export async function getPdfInfo(doc: pdfjsLib.PDFDocumentProxy): Promise<PdfDocumentInfo> {
  let title: string | undefined;
  let author: string | undefined;

  try {
    const meta = await doc.getMetadata();
    const info = meta.info as Record<string, unknown> | undefined;
    if (info) {
      if (typeof info.Title === 'string' && info.Title.trim()) {
        title = info.Title.trim();
      }
      if (typeof info.Author === 'string' && info.Author.trim()) {
        author = info.Author.trim();
      }
    }
  } catch {
    // Metadata parsing is best-effort.
  }

  const outline = await extractPdfOutline(doc);

  return {
    numPages: doc.numPages,
    title,
    author,
    outline,
  };
}

/**
 * Extracts the outline tree and maps entries to 1-based page numbers.
 */
export async function extractPdfOutline(doc: pdfjsLib.PDFDocumentProxy): Promise<PdfChapter[]> {
  try {
    const rawOutline = await doc.getOutline();
    if (!rawOutline || !Array.isArray(rawOutline) || rawOutline.length === 0) {
      return [];
    }

    const result: PdfChapter[] = [];

    async function walk(nodes: unknown[]) {
      for (const rawNode of nodes) {
        if (!rawNode || typeof rawNode !== 'object') continue;
        const node = rawNode as { title?: unknown; dest?: unknown; items?: unknown[] };
        let pageNumber = 1;
        if (node.dest) {
          try {
            let explicitDest: unknown = node.dest;
            if (typeof explicitDest === 'string') {
              explicitDest = await doc.getDestination(explicitDest);
            }
            if (Array.isArray(explicitDest) && explicitDest.length > 0) {
              const pageRef = explicitDest[0];
              const pageIdx = await doc.getPageIndex(pageRef);
              pageNumber = pageIdx + 1;
            }
          } catch {
            // Keep default page 1 if destination cannot be resolved
          }
        }

        if (typeof node.title === 'string' && node.title.trim()) {
          result.push({
            id: `outline-${pageNumber}-${result.length}`,
            title: node.title.trim(),
            pageNumber,
          });
        }

        if (node.items && Array.isArray(node.items) && node.items.length > 0) {
          await walk(node.items);
        }
      }
    }

    await walk(rawOutline);
    return result;
  } catch {
    return [];
  }
}

/**
 * Renders a PDF page onto an HTML canvas element.
 * Accounts for devicePixelRatio for sharp rendering on high-DPI displays.
 */
export async function renderPdfPage(
  page: pdfjsLib.PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number = 1.0
): Promise<pdfjsLib.RenderTask> {
  const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const viewport = page.getViewport({ scale: scale * pixelRatio });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is not available');
  }

  const renderContext = {
    canvasContext: context,
    viewport,
  };

  return page.render(renderContext);
}

/**
 * Extracts plain text from a single PDF page for indexing and in-book search.
 */
export async function extractPdfPageText(page: pdfjsLib.PDFPageProxy): Promise<string> {
  try {
    const textContent = await page.getTextContent();

    interface RawPdfTextItem {
      str: string;
      transform?: number[];
    }

    const items: RawPdfTextItem[] = [];
    for (const raw of textContent.items) {
      if (raw && typeof raw === 'object' && 'str' in raw && typeof (raw as { str: unknown }).str === 'string') {
        const item = raw as { str: string; transform?: number[] };
        items.push({
          str: item.str,
          transform: Array.isArray(item.transform) ? item.transform : undefined,
        });
      }
    }

    // Sort items in reading order: top-to-bottom (Y desc), then left-to-right (X asc).
    // In PDF coordinates, (0, 0) is bottom-left, so larger Y is physically higher on the page.
    items.sort((a, b) => {
      const transformA = a.transform;
      const transformB = b.transform;
      if (transformA && transformB && transformA.length >= 6 && transformB.length >= 6) {
        const yDiff = transformB[5] - transformA[5];
        if (Math.abs(yDiff) > 4) {
          return yDiff;
        }
        return transformA[4] - transformB[4];
      }
      return 0;
    });

    return items
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

