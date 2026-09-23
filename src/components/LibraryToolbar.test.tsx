import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LibraryToolbar } from './LibraryToolbar';

describe('LibraryToolbar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders search bar in-line with filter buttons (all, books, audio, collections)', async () => {
    const onSearchChange = vi.fn();
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <LibraryToolbar
          searchQuery=""
          onSearchChange={onSearchChange}
          activeFilter="all"
          onFilterChange={onFilterChange}
          sortKey="recent"
          onSortChange={onSortChange}
          counts={{ all: 10, books: 6, audio: 4, collections: 2 }}
        />
      );
    });

    // Check search input
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Search your library');

    // Check the four filter buttons
    const filterButtons = container.querySelectorAll('.pill');
    expect(filterButtons.length).toBe(4);
    expect(container.textContent).toContain('All');
    expect(container.textContent).toContain('Books');
    expect(container.textContent).toContain('Audio');
    expect(container.textContent).toContain('Collections');

    // Check counts
    expect(container.textContent).toContain('10');
    expect(container.textContent).toContain('6');
    expect(container.textContent).toContain('4');
    expect(container.textContent).toContain('2');

    // Clicking a filter button calls onFilterChange
    await act(async () => {
      (filterButtons[1] as HTMLButtonElement).click();
    });
    expect(onFilterChange).toHaveBeenCalledWith('book');

    await act(async () => {
      root.unmount();
    });
  });

  it('handles clearing search and toggling sort menu', async () => {
    const onSearchChange = vi.fn();
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <LibraryToolbar
          searchQuery="Dune"
          onSearchChange={onSearchChange}
          activeFilter="book"
          onFilterChange={onFilterChange}
          sortKey="recent"
          onSortChange={onSortChange}
          counts={{ all: 5, books: 3, audio: 2, collections: 1 }}
        />
      );
    });

    // Clear button is visible when searchQuery is non-empty
    const clearBtn = container.querySelector('button[aria-label="Clear search"]') as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    await act(async () => {
      clearBtn.click();
    });
    expect(onSearchChange).toHaveBeenCalledWith('');

    // Sort menu toggle
    const sortBtn = container.querySelector('button[title="Sort"]') as HTMLButtonElement;
    expect(sortBtn).not.toBeNull();
    await act(async () => {
      sortBtn.click();
    });
    expect(container.textContent).toContain('Recently played');
    expect(container.textContent).toContain('Title');
    expect(container.textContent).toContain('Author');

    await act(async () => {
      root.unmount();
    });
  });
});
