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
