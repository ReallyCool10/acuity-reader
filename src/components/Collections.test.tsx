import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Collection, MediaItem } from '../types';
import type { CollectionWorkItem } from '../lib/collections';
import { CollectionCard } from './CollectionCard';
import { CollectionDetailView } from './CollectionDetailView';
import { CollectionModal } from './CollectionModal';

function makeMockMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  const id = overrides.id || 'item-1';
  return {
    id,
    title: 'The Way of Kings',
    author: 'Brandon Sanderson',
    filePath: `C:/books/${id}.epub`,
    mediaType: 'book',
    format: 'epub',
    fileSize: 1024,
    dateAdded: Date.now(),
    dirName: 'books',
    ...overrides,
  };
}

describe('Collections UI Components', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('CollectionCard', () => {
    const mockCollection: Collection = {
      id: 'col-1',
      name: 'The Stormlight Archive',
      kind: 'series',
      description: 'Epic fantasy series',
      memberIds: ['item-1', 'item-2'],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const mockWorks: CollectionWorkItem[] = [
      {
        primaryItem: makeMockMediaItem({ id: 'item-1', title: 'The Way of Kings' }),
        bookItem: makeMockMediaItem({ id: 'item-1', title: 'The Way of Kings' }),
        isDual: false,
        memberIds: ['item-1'],
        orderIndex: 1,
      },
      {
        primaryItem: makeMockMediaItem({ id: 'item-2', title: 'Words of Radiance' }),
        bookItem: makeMockMediaItem({ id: 'item-2', title: 'Words of Radiance' }),
        isDual: false,
        memberIds: ['item-2'],
        orderIndex: 2,
      },
    ];

    it('renders collection title, series badge, and work count', async () => {
      const onClick = vi.fn();
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <CollectionCard
            collection={mockCollection}
            resolvedWorks={mockWorks}
            onClick={onClick}
          />
        );
      });

      expect(container.textContent).toContain('The Stormlight Archive');
      expect(container.textContent).toContain('Series');
      expect(container.textContent).toContain('2 works');

      const card = container.querySelector('.book-card') as HTMLElement;
      expect(card).toBeTruthy();
      card?.click();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders theme badge for theme collections', async () => {
      const themeCollection: Collection = {
        ...mockCollection,
        id: 'col-theme',
        name: 'Sci-Fi Classics',
        kind: 'theme',
      };

      const root = createRoot(container);
      await act(async () => {
        root.render(
          <CollectionCard
            collection={themeCollection}
            resolvedWorks={mockWorks}
            onClick={vi.fn()}
          />
        );
      });

      expect(container.textContent).toContain('Theme');
      expect(container.textContent).not.toContain('Series');
    });
  });

  describe('CollectionDetailView', () => {
    const mockSeriesCollection: Collection = {
      id: 'col-series',
      name: 'The Stormlight Archive',
      kind: 'series',
      description: 'Epic fantasy series by Brandon Sanderson',
      memberIds: ['book-1', 'book-2'],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const bookItem1 = makeMockMediaItem({
      id: 'book-1',
      title: 'The Way of Kings',
      filePath: 'C:/books/book-1.epub',
      companionPath: 'C:/books/audio-1.m4b',
    });
    const audioItem1 = makeMockMediaItem({
      id: 'audio-1',
      title: 'The Way of Kings (Audiobook)',
      mediaType: 'audio',
      format: 'm4b',
      filePath: 'C:/books/audio-1.m4b',
      companionPath: 'C:/books/book-1.epub',
    });
    const bookItem2 = makeMockMediaItem({
      id: 'book-2',
      title: 'Words of Radiance',
      filePath: 'C:/books/book-2.epub',
    });

    it('surfaces series volume badges and Read/Listen action buttons for dual works', async () => {
      const onBack = vi.fn();
      const onOpenItem = vi.fn();
      const onUpdateCollection = vi.fn();

      const root = createRoot(container);
      await act(async () => {
        root.render(
          <CollectionDetailView
            collection={mockSeriesCollection}
            libraryItems={[bookItem1, audioItem1, bookItem2]}
            progress={{}}
            onBack={onBack}
            onOpenItem={onOpenItem}
            onUpdateCollection={onUpdateCollection}
            onEditCollection={vi.fn()}
            onDeleteCollection={vi.fn()}
          />
        );
      });

      // Header info
      expect(container.textContent).toContain('The Stormlight Archive');
      expect(container.textContent).toContain('Epic fantasy series by Brandon Sanderson');

      // Series sequence badges (#1, #2) are surfaced because kind === 'series'
      expect(container.textContent).toContain('#1');
      expect(container.textContent).toContain('#2');

      // Dual work has Read and Listen buttons
      const buttons = Array.from(container.querySelectorAll('button'));
      const readBtn = buttons.find((b) => b.textContent?.trim() === 'Read');
      const listenBtn = buttons.find((b) => b.textContent?.trim() === 'Listen');

      expect(readBtn).toBeTruthy();
      expect(listenBtn).toBeTruthy();

      await act(async () => {
        readBtn?.click();
      });
      expect(onOpenItem).toHaveBeenCalledWith(bookItem1);
    });

    it('hides sequence number badges when collection kind is theme', async () => {
      const themeCol: Collection = {
        ...mockSeriesCollection,
        kind: 'theme',
      };

      const root = createRoot(container);
      await act(async () => {
        root.render(
          <CollectionDetailView
            collection={themeCol}
            libraryItems={[bookItem1, bookItem2]}
            progress={{}}
            onBack={vi.fn()}
            onOpenItem={vi.fn()}
            onUpdateCollection={vi.fn()}
            onEditCollection={vi.fn()}
            onDeleteCollection={vi.fn()}
          />
        );
      });

      // Sequence numbers should NOT be rendered when kind === 'theme'
      expect(container.textContent).not.toContain('#1');
      expect(container.textContent).not.toContain('#2');
    });
  });

  describe('CollectionModal', () => {
    it('allows editing collection details and submitting', async () => {
      const onSave = vi.fn();
      const onClose = vi.fn();

      const existingCollection: Collection = {
        id: 'col-edit',
        name: 'Mistborn Series',
        kind: 'series',
        description: 'Original trilogy',
        memberIds: [],
        createdAt: 1000,
        updatedAt: 1000,
      };

      const root = createRoot(container);
      await act(async () => {
        root.render(
          <CollectionModal
            isOpen={true}
            collection={existingCollection}
            onClose={onClose}
            onSave={onSave}
          />
        );
      });

      const saveButton = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Save Changes')
      );
      expect(saveButton).toBeTruthy();

      await act(async () => {
        saveButton?.click();
      });

      expect(onSave).toHaveBeenCalledWith({
        name: 'Mistborn Series',
        kind: 'series',
        description: 'Original trilogy',
      });
    });

    it('starts blank when creating a new collection', async () => {
      const onSave = vi.fn();
      const root = createRoot(container);
      await act(async () => {
        root.render(<CollectionModal isOpen={true} collection={null} onClose={vi.fn()} onSave={onSave} />);
      });

      const textInputs = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[type="text"], input:not([type]), textarea'));
      expect(textInputs.length).toBeGreaterThan(0);
      for (const input of textInputs) expect(input.value).toBe('');

      // An empty name must not be saved.
      const form = container.querySelector('form');
      await act(async () => {
        form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
