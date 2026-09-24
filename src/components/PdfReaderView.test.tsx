import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PdfReaderView } from './PdfReaderView';
import type { MediaItem } from '../types';

vi.mock('../lib/pdf', () => ({
  loadPdfDocument: vi.fn().mockResolvedValue({
    numPages: 5,
    getPage: vi.fn().mockResolvedValue({
      getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  }),
  getPdfInfo: vi.fn().mockResolvedValue({
    numPages: 5,
    title: 'Clean Architecture in Practice',
    author: 'Robert C. Martin',
    outline: [
      { id: 'chap-1', title: 'Chapter 1: Clean Code', pageNumber: 1 },
      { id: 'chap-2', title: 'Chapter 2: Solid Principles', pageNumber: 3 },
    ],
  }),
  renderPdfPage: vi.fn().mockResolvedValue({
    promise: Promise.resolve(),
    cancel: vi.fn(),
  }),
  extractPdfOutline: vi.fn().mockResolvedValue([]),
}));

describe('PdfReaderView', () => {
  let container: HTMLDivElement;

  const mockItem: MediaItem = {
    id: 'pdf-item-1',
    title: 'Clean Architecture',
    author: 'Uncle Bob',
    filePath: 'C:/Library/clean_architecture.pdf',
    mediaType: 'book',
    format: 'pdf',
    fileModifiedAt: 100,
    firstSeenAt: 100,
    dateAdded: 100,
    dirName: 'C:/Library',
    fileSize: 1048576,
  };

  const defaultProps = {
    item: mockItem,
    onClose: vi.fn(),
    onProgressUpdate: vi.fn(),
    onAddBookmark: vi.fn(),
    onRemoveBookmark: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    (window as unknown as { electronAPI: { readBytes: () => Promise<Uint8Array> } }).electronAPI = {
      readBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
  });

  afterEach(() => {
    container.remove();
  });

  it('renders header, title, and page navigation controls', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<PdfReaderView {...defaultProps} />);
    });

    // Wait for document to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container.textContent).toContain('Clean Architecture in Practice');
    expect(container.textContent).toContain('Page 1 of 5');

    // Click back button
    const backBtn = container.querySelector('button[aria-label="Back to library (Esc)"]') as HTMLButtonElement;
    expect(backBtn).toBeDefined();
    await act(async () => {
      backBtn.click();
    });
    expect(defaultProps.onClose).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('zooms in and out when clicking zoom buttons in appearance menu', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<PdfReaderView {...defaultProps} />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Open Appearance menu to access zoom controls
    const appearanceBtn = container.querySelector('button[aria-label="Appearance"]') as HTMLButtonElement;
    expect(appearanceBtn).toBeDefined();
    await act(async () => {
      appearanceBtn.click();
    });

    const zoomInBtn = container.querySelector('button[aria-label="Zoom in (+)"]') as HTMLButtonElement;
    expect(zoomInBtn).toBeDefined();

    await act(async () => {
      zoomInBtn.click();
    });

    expect(container.textContent).toContain('140%');

    const zoomOutBtn = container.querySelector('button[aria-label="Zoom out (-)"]') as HTMLButtonElement;
    await act(async () => {
      zoomOutBtn.click();
    });

    expect(container.textContent).toContain('120%');

    await act(async () => {
      root.unmount();
    });
  });

  it('navigates next and previous pages', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<PdfReaderView {...defaultProps} />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container.textContent).toContain('Page 1 of 5');

    const nextBtn = container.querySelector('button[aria-label="Next page (Right arrow)"]') as HTMLButtonElement;
    await act(async () => {
      nextBtn.click();
    });

    expect(container.textContent).toContain('Page 2 of 5');

    const prevBtn = container.querySelector('button[aria-label="Previous page (Left arrow)"]') as HTMLButtonElement;
    await act(async () => {
      prevBtn.click();
    });

    expect(container.textContent).toContain('Page 1 of 5');

    await act(async () => {
      root.unmount();
    });
  });

  it('opens outline drawer and displays chapters', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<PdfReaderView {...defaultProps} />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const tocBtn = container.querySelector('button[aria-label="Table of contents"]') as HTMLButtonElement;
    await act(async () => {
      tocBtn.click();
    });

    expect(container.textContent).toContain('Chapter 1: Clean Code');
    expect(container.textContent).toContain('Chapter 2: Solid Principles');

    await act(async () => {
      root.unmount();
    });
  });

  it('adds a bookmark when bookmark button is clicked', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<PdfReaderView {...defaultProps} />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const bookmarkBtn = container.querySelector('button[aria-label="Bookmark this page (B)"]') as HTMLButtonElement;
    await act(async () => {
      bookmarkBtn.click();
    });

    expect(defaultProps.onAddBookmark).toHaveBeenCalledWith('pdf-item-1', 0, 'Page 1 of 5');

    await act(async () => {
      root.unmount();
    });
  });

  it('handles Escape key to close the reader', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<PdfReaderView {...defaultProps} />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(defaultProps.onClose).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
