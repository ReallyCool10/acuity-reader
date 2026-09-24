import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReaderView } from './ReaderView';
import type { MediaItem } from '../types';

vi.mock('../lib/epub', () => ({
  parseEpub: vi.fn().mockResolvedValue({
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    chapters: [
      {
        id: 'c1',
        href: 'ch1.html',
        title: 'Chapter 1',
        html: '<p>It is a truth universally acknowledged...</p>',
        text: 'It is a truth universally acknowledged...',
        words: 50,
      },
      {
        id: 'c2',
        href: 'ch2.html',
        title: 'Chapter 2',
        html: '<p>Mr. Bennet was among the earliest of those who waited on Mr. Bingley.</p>',
        text: 'Mr. Bennet was among the earliest of those who waited on Mr. Bingley.',
        words: 60,
      },
    ],
    objectUrls: [],
  }),
}));

describe('ReaderView (EPUB)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);

    class MockAudio {
      src = '';
      playbackRate = 1;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
    }
    vi.stubGlobal('Audio', MockAudio);

    window.electronAPI = {
      readBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      getEdgeVoices: vi.fn().mockResolvedValue([
        { name: 'en-US-JennyNeural', friendlyName: 'Microsoft Jenny Online (Natural)', locale: 'en-US', gender: 'Female' },
        { name: 'en-US-GuyNeural', friendlyName: 'Microsoft Guy Online (Natural)', locale: 'en-US', gender: 'Male' },
      ]),
      synthesizeEdge: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    container.remove();
    delete window.electronAPI;
  });

  const sampleBook: MediaItem = {
    id: 'b1',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    format: 'epub',
    mediaType: 'book',
    filePath: 'C:/Books/pride.epub',
    dirName: 'C:/Books',
    fileSize: 1024,
    fileModifiedAt: 1000,
    firstSeenAt: 1000,
    dateAdded: 1000,
  };

  it('loads chapters and renders reader controls and appearance popover', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderView
          item={sampleBook}
          onClose={vi.fn()}
          onProgressUpdate={vi.fn()}
          onAddBookmark={vi.fn()}
        />
      );
    });

    // Wait for async loadEpub to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Pride and Prejudice');
    expect(container.textContent).toContain('Chapter 1');
    expect(container.textContent).toContain('It is a truth universally acknowledged');

    // Appearance button
    const appearanceBtn = container.querySelector('button[aria-label="Appearance"]') as HTMLButtonElement;
    expect(appearanceBtn).toBeDefined();

    await act(async () => {
      appearanceBtn.click();
    });

    // Theme options in appearance menu
    expect(container.textContent).toContain('Theme');
    expect(container.textContent).toContain('Dark');
    expect(container.textContent).toContain('Sepia');
    expect(container.textContent).toContain('Light');

    // Typography options
    expect(container.textContent).toContain('Typeface');
    expect(container.textContent).toContain('Serif');
    expect(container.textContent).toContain('Sans');
    expect(container.textContent).toContain('Read Aloud voice');

    // Switch theme to Sepia
    const sepiaBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Sepia');
    expect(sepiaBtn).toBeDefined();

    await act(async () => {
      sepiaBtn?.click();
    });

    const readerSurface = container.querySelector('.reader-surface');
    expect(readerSurface?.getAttribute('data-theme')).toBe('sepia');

    // Switch typeface to Sans
    const sansBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Sans');
    await act(async () => {
      sansBtn?.click();
    });
    expect(localStorage.getItem('acuity.reader.typeface')).toContain('sans');

    // Increase font size
    const increaseFontBtn = container.querySelector('button[aria-label="Larger text"]') as HTMLButtonElement;
    expect(increaseFontBtn).toBeDefined();
    await act(async () => {
      increaseFontBtn.click();
    });
    expect(Number(JSON.parse(localStorage.getItem('acuity.reader.fontSize') || '18'))).toBeGreaterThan(18);

    await act(async () => {
      root.unmount();
    });
  });

  it('toggles narration play and stop and advances chapters via keyboard', async () => {
    const onProgressUpdate = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderView
          item={sampleBook}
          onClose={vi.fn()}
          onProgressUpdate={onProgressUpdate}
          onAddBookmark={vi.fn()}
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Start narration button
    const playNarrationBtn = container.querySelector('button[aria-label="Read aloud"]') as HTMLButtonElement;
    expect(playNarrationBtn).toBeDefined();

    await act(async () => {
      playNarrationBtn.click();
    });

    // Button aria-label flips to stop reading aloud
    const stopNarrationBtn = container.querySelector('button[aria-label="Stop reading aloud"]') as HTMLButtonElement;
    expect(stopNarrationBtn).toBeDefined();

    // Clicking stop narration
    await act(async () => {
      stopNarrationBtn.click();
    });

    expect(container.querySelector('button[aria-label="Read aloud"]')).toBeDefined();

    // Navigate to chapter 2 via ArrowRight
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(container.textContent).toContain('Chapter 2');
    expect(container.textContent).toContain('Mr. Bennet was among the earliest');
    expect(onProgressUpdate).toHaveBeenCalledWith('b1', 1, expect.any(Number), 0);

    await act(async () => {
      root.unmount();
    });
  });
});
