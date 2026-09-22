import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReaderShell, Section, Stepper } from './ReaderShell';

describe('ReaderShell', () => {
  let container: HTMLDivElement;

  const defaultProps = {
    title: 'Pride and Prejudice',
    subtitle: 'Chapter 1',
    theme: 'dark' as const,
    onThemeChange: vi.fn(),
    onClose: vi.fn(),
    canGoPrev: true,
    canGoNext: true,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    progressPercent: 42,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders header with title, subtitle, and footer progress', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderShell {...defaultProps}>
          <div>Book Content</div>
        </ReaderShell>
      );
    });

    expect(container.textContent).toContain('Pride and Prejudice');
    expect(container.textContent).toContain('Chapter 1');
    expect(container.textContent).toContain('Book Content');
    expect(container.textContent).toContain('42%');

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

  it('navigates previous and next via footer buttons', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderShell {...defaultProps} prevLabel="Prev Chapter" nextLabel="Next Chapter">
          <div>Book Content</div>
        </ReaderShell>
      );
    });

    const prevBtn = container.querySelector('button[aria-label="Prev Chapter (Left arrow)"]') as HTMLButtonElement;
    const nextBtn = container.querySelector('button[aria-label="Next Chapter (Right arrow)"]') as HTMLButtonElement;

    expect(prevBtn).toBeDefined();
    expect(nextBtn).toBeDefined();

    await act(async () => {
      prevBtn.click();
    });
    expect(defaultProps.onPrev).toHaveBeenCalled();

    await act(async () => {
      nextBtn.click();
    });
    expect(defaultProps.onNext).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('toggles table of contents drawer and selects an entry', async () => {
    const onSelectToc = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderShell
          {...defaultProps}
          tocEntries={[
            { id: 0, title: 'Chapter 1: The Beginning' },
            { id: 1, title: 'Chapter 2: The Journey' },
          ]}
          onSelectTocEntry={onSelectToc}
        >
          <div>Book Content</div>
        </ReaderShell>
      );
    });

    const tocBtn = container.querySelector('button[aria-label="Table of contents"]') as HTMLButtonElement;
    expect(tocBtn).toBeDefined();

    await act(async () => {
      tocBtn.click();
    });

    expect(container.textContent).toContain('Contents (2)');
    expect(container.textContent).toContain('Chapter 1: The Beginning');

    const entryBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Chapter 2: The Journey')
    );
    expect(entryBtn).toBeDefined();

    await act(async () => {
      entryBtn?.click();
    });

    expect(onSelectToc).toHaveBeenCalledWith({ id: 1, title: 'Chapter 2: The Journey' });

    await act(async () => {
      root.unmount();
    });
  });

  it('opens appearance menu, changes theme, and renders custom appearanceSlot', async () => {
    const onThemeChange = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderShell
          {...defaultProps}
          onThemeChange={onThemeChange}
          appearanceSlot={
            <Section label="Custom Control">
              <Stepper
                value="100%"
                onDecrease={() => {}}
                onIncrease={() => {}}
                decreaseLabel="Decrease"
                increaseLabel="Increase"
              />
            </Section>
          }
        >
          <div>Book Content</div>
        </ReaderShell>
      );
    });

    const appearanceBtn = container.querySelector('button[aria-label="Appearance"]') as HTMLButtonElement;
    expect(appearanceBtn).toBeDefined();

    await act(async () => {
      appearanceBtn.click();
    });

    expect(container.textContent).toContain('Theme');
    expect(container.textContent).toContain('Custom Control');
    expect(container.textContent).toContain('100%');

    const sepiaBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Sepia'
    );
    expect(sepiaBtn).toBeDefined();

    await act(async () => {
      sepiaBtn?.click();
    });

    expect(onThemeChange).toHaveBeenCalledWith('sepia');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders companion audiobook button when companionPath provided', async () => {
    const onSwitch = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderShell
          {...defaultProps}
          companionPath="C:/audio/book.m4b"
          onSwitchToAudio={onSwitch}
        >
          <div>Book Content</div>
        </ReaderShell>
      );
    });

    const listenBtn = container.querySelector('button[aria-label="Switch to companion audiobook"]') as HTMLButtonElement;
    expect(listenBtn).toBeDefined();

    await act(async () => {
      listenBtn.click();
    });

    expect(onSwitch).toHaveBeenCalledWith('C:/audio/book.m4b');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders search button and opens search tab when onSearch provided', async () => {
    const onSearch = vi.fn().mockResolvedValue([]);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ReaderShell
          {...defaultProps}
          onSearch={onSearch}
        >
          <div>Book Content</div>
        </ReaderShell>
      );
    });

    const searchBtn = container.querySelector('button[aria-label="Search in book (Ctrl+F)"]') as HTMLButtonElement;
    expect(searchBtn).toBeDefined();

    await act(async () => {
      searchBtn.click();
    });

    const searchInput = container.querySelector('input[placeholder="Search in book..."]') as HTMLInputElement;
    expect(searchInput).toBeDefined();

    await act(async () => {
      root.unmount();
    });
  });
});

