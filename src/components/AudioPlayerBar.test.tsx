import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioPlayerBar } from './AudioPlayerBar';
import type { Bookmark, MediaItem } from '../types';

const mockItem: MediaItem = {
  id: 'test-audio-1',
  title: 'Great Audiobook',
  author: 'Jane Doe',
  filePath: 'C:/Audio/Great Audiobook.m4b',
  mediaType: 'audio',
  format: 'm4b',
  fileSize: 10485760,
  dateAdded: Date.now(),
  dirName: 'C:/Audio',
  durationSeconds: 3600,
};

const mockBookmarks: Bookmark[] = [
  {
    id: 'bm-1',
    itemId: 'test-audio-1',
    label: 'Chapter 2 opening',
    createdAt: Date.now(),
    position: 450,
  },
  {
    id: 'bm-2',
    itemId: 'test-audio-1',
    label: 'Key argument',
    createdAt: Date.now(),
    position: 1200,
  },
];

describe('AudioPlayerBar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders track title, author, and audio controls', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          initialTime={100}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Great Audiobook');
    expect(container.textContent).toContain('Jane Doe');
    await act(async () => {
      root.unmount();
    });
  });

  it('displays bookmark badge and shows bookmarks menu when clicked', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          bookmarks={mockBookmarks}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const bookmarkBtn = container.querySelector('button[aria-label="Bookmarks"]') as HTMLButtonElement | null;
    expect(bookmarkBtn).toBeDefined();
    expect(bookmarkBtn?.textContent).toContain('2');

    // Open bookmarks popover
    await act(async () => {
      bookmarkBtn?.click();
    });

    expect(container.textContent).toContain('Bookmarks (2)');
    expect(container.textContent).toContain('Chapter 2 opening');
    expect(container.textContent).toContain('Key argument');
    await act(async () => {
      root.unmount();
    });
  });

  it('displays sleep timer menu with options when clicked', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AudioPlayerBar
          item={mockItem}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    const sleepBtn = container.querySelector('button[aria-label="Set sleep timer"]') as HTMLButtonElement | null;
    expect(sleepBtn).toBeDefined();

    await act(async () => {
      sleepBtn?.click();
    });

    expect(container.textContent).toContain('Sleep timer');
    expect(container.textContent).toContain('15 minutes');
    expect(container.textContent).toContain('30 minutes');
    expect(container.textContent).toContain('60 minutes');
    await act(async () => {
      root.unmount();
    });
  });
});
