import type { MediaItem } from '../types';
import { THUMB_MAX_SIZE } from './coverArt';
import { whenIdle } from './idle';
import { renderPdfCover } from './pdf';

/**
 * Covers for PDFs.
 *
 * A PDF has no cover image to extract, so without one it showed a generated
 * jacket. This draws each such PDF's first page in the background, one at a
 * time when the renderer is idle, and has the main process keep it in the
 * covers folder, where later scans find it (`findOrExtractCover`). A cover image
 * beside the file or in its folder still wins, since those PDFs already have one.
 */

export interface PdfCoverApi {
  /** Keep a first-page cover for this PDF; resolves to the saved cover's path. */
  savePdfCover(filePath: string, jpeg: Uint8Array): Promise<string | null>;
}

/** Draws a PDF's first page as a JPEG, or null if it cannot. */
export type PdfPageRenderer = (filePath: string) => Promise<Uint8Array | null>;

/** Covers are reported a few at a time, so the library is not rewritten after each one. */
const BATCH_SIZE = 8;

/** PDFs that could not be drawn (encrypted, damaged); not retried until the app restarts. */
const failed = new Set<string>();
let latestRun = 0;

const renderFirstPage: PdfPageRenderer = (filePath) =>
  renderPdfCover(
    (start, end) => window.electronAPI?.readRange(filePath, start, end) ?? Promise.resolve(null),
    THUMB_MAX_SIZE
  );

/**
 * Give PDFs without cover art a cover drawn from their first page. `onCovers`
 * receives item IDs mapped to their new cover paths. A newer call supersedes an
 * older one, since the library has changed; covers already made are reported.
 */
export async function makePdfCovers(
  items: MediaItem[],
  onCovers: (covers: Map<string, string>) => void,
  api: PdfCoverApi | undefined = window.electronAPI,
  render: PdfPageRenderer = renderFirstPage
): Promise<void> {
  const run = ++latestRun;
  const needed = items.filter(
    (item) => item.format.toLowerCase() === 'pdf' && !item.coverUrl && !failed.has(item.filePath)
  );
  if (!api || needed.length === 0) return;

  let made = new Map<string, string>();
  const report = () => {
    if (made.size === 0) return;
    onCovers(made);
    made = new Map();
  };

  for (const item of needed) {
    await whenIdle();
    if (run !== latestRun) break;
    const jpeg = await render(item.filePath);
    const coverPath = jpeg ? await api.savePdfCover(item.filePath, jpeg).catch(() => null) : null;
    if (coverPath) made.set(item.id, coverPath);
    else failed.add(item.filePath);
    if (made.size >= BATCH_SIZE) report();
  }
  report();
}
