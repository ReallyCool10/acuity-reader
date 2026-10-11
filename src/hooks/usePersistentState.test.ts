import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { useThrottledCallback } from './usePersistentState';

describe('useThrottledCallback', () => {
  let container: HTMLDivElement;
  let root: Root;
  let save: Mock<(position: number) => void>;
  let throttled: (position: number) => void;

  function Harness() {
    throttled = useThrottledCallback((position: number) => save(position), 1000);
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    save = vi.fn<(position: number) => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(Harness)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('runs the first call at once and collapses the rest into one trailing call', () => {
    throttled(1);
    throttled(2);
    throttled(3);
    expect(save.mock.calls).toEqual([[1]]);

    act(() => vi.advanceTimersByTime(1000));
    expect(save.mock.calls).toEqual([[1], [3]]);
  });

  it('makes a waiting call when the component unmounts, such as a book being closed', () => {
    throttled(1);
    throttled(42);
    act(() => root.unmount());
    expect(save.mock.calls).toEqual([[1], [42]]);
    root = createRoot(container); // for afterEach
  });

  it('makes a waiting call when the window is closed', () => {
    throttled(1);
    throttled(7);
    window.dispatchEvent(new Event('pagehide'));
    expect(save.mock.calls).toEqual([[1], [7]]);

    // Nothing is left to send afterwards.
    act(() => vi.advanceTimersByTime(1000));
    expect(save).toHaveBeenCalledTimes(2);
  });
});
