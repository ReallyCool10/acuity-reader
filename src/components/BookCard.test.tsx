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

/** jsdom never decodes images; give the cover a natural size and fire its load event. */
function loadCover(container: HTMLElement, width: number, height: number) {
  const img = container.querySelector('img.cover-image') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height });
  act(() => {
    img.dispatchEvent(new Event('load'));
  });
}

const aspectOf = (container: HTMLElement) =>
  Number((container.querySelector('.book-card') as HTMLElement).style.getPropertyValue('--cover-aspect'));

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

  it('frames a cover at its own shape once the image loads', () => {
    act(() => root.render(<BookCard item={makeItem()} onOpen={vi.fn()} />));
    expect(aspectOf(container)).toBeCloseTo(2 / 3);

    loadCover(container, 1600, 2560);
    expect(aspectOf(container)).toBeCloseTo(0.625);
  });

  it('limits an extreme image to the widest frame instead of squashing the card', () => {
    act(() => root.render(<BookCard item={makeItem({ mediaType: 'audio' })} onOpen={vi.fn()} />));
    expect(aspectOf(container)).toBe(1);

    loadCover(container, 1500, 500);
    expect(aspectOf(container)).toBe(1.5);
  });

  it('falls back to a generated jacket at the default shape when the image fails', () => {
    act(() => root.render(<BookCard item={makeItem()} onOpen={vi.fn()} />));
    loadCover(container, 1000, 1000);
    expect(aspectOf(container)).toBe(1);

    act(() => {
      container.querySelector('img.cover-image')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img.cover-image')).toBeNull();
    expect(aspectOf(container)).toBeCloseTo(2 / 3);
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
