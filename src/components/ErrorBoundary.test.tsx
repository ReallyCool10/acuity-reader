import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Explosion in rendering');
  }
  return <div>Safe child content</div>;
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Suppress expected React error logs during error testing
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    container.remove();
  });

  it('renders children normally when no error occurs', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <ProblemChild shouldThrow={false} />
        </ErrorBoundary>
      );
    });

    expect(container.textContent).toContain('Safe child content');
    root.unmount();
  });

  it('catches render error and displays fallback UI', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary fallbackTitle="Reader Failed" fallbackMessage="Could not open book">
          <ProblemChild shouldThrow={true} />
        </ErrorBoundary>
      );
    });

    expect(container.textContent).toContain('Reader Failed');
    expect(container.textContent).toContain('Explosion in rendering');
    root.unmount();
  });

  it('invokes onReset callback when the reset button is clicked', async () => {
    const handleReset = vi.fn();
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ErrorBoundary onReset={handleReset} actionLabel="Back to Library">
          <ProblemChild shouldThrow={true} />
        </ErrorBoundary>
      );
    });

    const button = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Back to Library')
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
    });

    expect(handleReset).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});
