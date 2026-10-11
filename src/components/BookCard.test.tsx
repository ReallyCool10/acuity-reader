import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MediaItem } from '../types';
import { BookCard } from './BookCard';

function makeItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'item-1',
    title: 'The Way of Kings',
    author: 'Brandon Sanderson',
    filePath: 'C:/books/kings.epub',
    mediaType: 'book',
    format: 'epub',
    fileSize: 1024,
    fileModifiedAt: 100,
    firstSeenAt: 100,
    dirName: 'books',
    coverUrl: 'C:/covers/kings.jpg',
    ...overrides,
  };
}

/** jsdom never loads images; give the cover a natural size, fire its load event, let decode() settle. */
async function loadCover(container: HTMLElement, width: number, height: number) {
  const img = container.querySelector('img.cover-image') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height });
  await act(async () => {
    img.dispatchEvent(new Event('load'));
  });
}

const card = (container: HTMLElement) => container.querySelector('.book-card') as HTMLElement;
const aspectOf = (container: HTMLElement) => Number(card(container).style.getPropertyValue('--cover-aspect'));
const isReady = (container: HTMLElement) => card(container).dataset.coverReady === 'true';

describe('BookCard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps the slot empty until the cover is decoded, then shows it at its own shape', async () => {
    act(() => root.render(<BookCard item={makeItem()} onOpen={vi.fn()} />));
    expect(isReady(container)).toBe(false);

    await loadCover(container, 1600, 2560);
    expect(isReady(container)).toBe(true);
    expect(aspectOf(container)).toBeCloseTo(0.625);
  });

  it('limits an extreme image to the widest frame instead of squashing the card', async () => {
    act(() => root.render(<BookCard item={makeItem({ mediaType: 'audio' })} onOpen={vi.fn()} />));
    await loadCover(container, 1500, 500);
    expect(aspectOf(container)).toBe(1.5);
  });

  it('shows a generated jacket at once when the item has no cover art', () => {
    act(() => root.render(<BookCard item={makeItem({ coverUrl: undefined })} onOpen={vi.fn()} />));
    expect(isReady(container)).toBe(true);
    expect(aspectOf(container)).toBeCloseTo(2 / 3);
    expect(container.querySelector('img.cover-image')).toBeNull();
  });

  it('shows a generated jacket at the default shape when the image fails', () => {
    act(() => root.render(<BookCard item={makeItem()} onOpen={vi.fn()} />));
    act(() => {
      container.querySelector('img.cover-image')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img.cover-image')).toBeNull();
    expect(isReady(container)).toBe(true);
    expect(aspectOf(container)).toBeCloseTo(2 / 3);
  });

  it('shows an image that is already in memory on the first paint, without waiting', () => {
    const proto = HTMLImageElement.prototype;
    const complete = Object.getOwnPropertyDescriptor(proto, 'complete');
    const naturalWidth = Object.getOwnPropertyDescriptor(proto, 'naturalWidth');
    const naturalHeight = Object.getOwnPropertyDescriptor(proto, 'naturalHeight');
    Object.defineProperty(proto, 'complete', { configurable: true, get: () => true });
    Object.defineProperty(proto, 'naturalWidth', { configurable: true, get: () => 1000 });
    Object.defineProperty(proto, 'naturalHeight', { configurable: true, get: () => 1500 });
    try {
      // One synchronous act: no load event, no awaited decode.
      act(() => root.render(<BookCard item={makeItem()} onOpen={vi.fn()} />));
      expect(isReady(container)).toBe(true);
      expect(aspectOf(container)).toBeCloseTo(2 / 3);
    } finally {
      for (const [name, descriptor] of [
        ['complete', complete],
        ['naturalWidth', naturalWidth],
        ['naturalHeight', naturalHeight],
      ] as const) {
        if (descriptor) Object.defineProperty(proto, name, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[name];
      }
    }
  });

  it('keeps "Add to collection" outside the open button, and it does not open the book', () => {
    const onOpen = vi.fn();
    const onAddToCollection = vi.fn();
    act(() =>
      root.render(<BookCard item={makeItem()} onOpen={onOpen} onAddToCollection={onAddToCollection} />)
    );

    const open = container.querySelector('button.book-open') as HTMLButtonElement;
    const add = container.querySelector('button[aria-label="Add The Way of Kings to collection"]') as HTMLButtonElement;
    expect(open.querySelector('button')).toBeNull();
    expect(open.contains(add)).toBe(false);

    act(() => add.click());
    expect(onAddToCollection).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    act(() => open.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
