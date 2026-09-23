import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scrubber, ScrubberChapter } from './Scrubber';

const mockChapters: ScrubberChapter[] = [
  { id: 'c1', title: 'Chapter 1: The Beginning', startTime: 0, endTime: 120 },
  { id: 'c2', title: 'Chapter 2: The Journey', startTime: 120, endTime: 300 },
  { id: 'c3', title: 'Chapter 3: The Climax', startTime: 300, endTime: 600 },
];

describe('Scrubber', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders track, fill, and accessible range input', async () => {
    const handleSeek = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Scrubber
          value={150}
          max={600}
          onSeek={handleSeek}
          ariaLabel="Seek timeline"
          formatValue={(v) => `${v}s`}
        />
      );
    });

    const input = container.querySelector('input[type="range"]') as HTMLInputElement | null;
    expect(input).toBeDefined();
    expect(input?.value).toBe('150');
    expect(input?.getAttribute('aria-valuetext')).toBe('150s');

    await act(async () => {
      root.unmount();
    });
  });

  it('invokes onSeek when range input changes', async () => {
    const handleSeek = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Scrubber
          value={0}
          max={600}
          onSeek={handleSeek}
          ariaLabel="Seek timeline"
        />
      );
    });

    const input = container.querySelector('input[type="range"]') as HTMLInputElement;
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeSetter?.call(input, '250');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(handleSeek).toHaveBeenCalledWith(250);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders chapter dots along the timeline with titles and accessibility labels', async () => {
    const handleSeek = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Scrubber
          value={150}
          max={600}
          onSeek={handleSeek}
          ariaLabel="Audio timeline"
          chapters={mockChapters}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBe(3);

    const labels = buttons.map((b) => b.getAttribute('aria-label'));
    expect(labels[0]).toContain('Chapter 1: The Beginning');
    expect(labels[1]).toContain('Chapter 2: The Journey');
    expect(labels[2]).toContain('Chapter 3: The Climax');

    await act(async () => {
      root.unmount();
    });
  });

  it('skips directly to chapter start time when clicking a chapter dot', async () => {
    const handleSeek = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Scrubber
          value={50}
          max={600}
          onSeek={handleSeek}
          ariaLabel="Audio timeline"
          chapters={mockChapters}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    // Click chapter 3 dot (startTime: 300)
    await act(async () => {
      buttons[2].click();
    });

    expect(handleSeek).toHaveBeenCalledWith(300);

    await act(async () => {
      root.unmount();
    });
  });

  it('shows tooltip on pointer enter and hides tooltip on pointer leave', async () => {
    const handleSeek = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Scrubber
          value={100}
          max={600}
          onSeek={handleSeek}
          ariaLabel="Audio timeline"
          chapters={mockChapters}
        />
      );
    });

    // Initially no floating tooltip rendered
    expect(container.textContent).not.toContain('5:00');

    // Find chapter 3 dot button
    const buttons = Array.from(container.querySelectorAll('button'));
    const chap3Btn = buttons[2];

    await act(async () => {
      chap3Btn.focus();
    });

    // Tooltip should be visible with chapter name and timestamp 5:00 (300s)
    expect(container.textContent).toContain('5:00');
    expect(container.textContent).toContain('Chapter 3: The Climax');

    // Blur hides tooltip
    await act(async () => {
      chap3Btn.blur();
    });

    expect(container.textContent).not.toContain('5:00');

    await act(async () => {
      root.unmount();
    });
  });
});
