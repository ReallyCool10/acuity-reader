import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowControls } from './WindowControls';
import type { ElectronAPI } from '../../electron/preload';

describe('WindowControls', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
    delete window.electronAPI;
  });

  it('renders minimize, maximize, and close buttons safely when window.electronAPI is missing', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<WindowControls />);
    });

    const minBtn = container.querySelector('button[aria-label="Minimize"]');
    const maxBtn = container.querySelector('button[aria-label="Maximize"]');
    const closeBtn = container.querySelector('button[aria-label="Close"]');

    expect(minBtn).not.toBeNull();
    expect(maxBtn).not.toBeNull();
    expect(closeBtn).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('invokes minimize, maximize, and close IPC calls on button click', async () => {
    const minimizeMock = vi.fn().mockResolvedValue(undefined);
    const maximizeMock = vi.fn().mockResolvedValue(undefined);
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const isMaximizedMock = vi.fn().mockResolvedValue(false);

    window.electronAPI = {
      minimize: minimizeMock,
      maximize: maximizeMock,
      close: closeMock,
      isMaximized: isMaximizedMock,
      onMaximizedChanged: vi.fn().mockReturnValue(() => {}),
    } as unknown as ElectronAPI;

    const root = createRoot(container);
    await act(async () => {
      root.render(<WindowControls />);
    });

    const minBtn = container.querySelector('button[aria-label="Minimize"]') as HTMLButtonElement;
    const maxBtn = container.querySelector('button[aria-label="Maximize"]') as HTMLButtonElement;
    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLButtonElement;

    await act(async () => {
      minBtn.click();
    });
    expect(minimizeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      maxBtn.click();
    });
    expect(maximizeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      closeBtn.click();
    });
    expect(closeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('updates maximize label and icon when window is maximized or state changes', async () => {
    let stateCallback: ((isMaximized: boolean) => void) | undefined;
    const onMaximizedChanged = vi.fn((cb: (isMaximized: boolean) => void) => {
      stateCallback = cb;
      return () => {};
    });

    window.electronAPI = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChanged,
    } as unknown as ElectronAPI;

    const root = createRoot(container);
    await act(async () => {
      root.render(<WindowControls />);
    });

    expect(container.querySelector('button[aria-label="Maximize"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Restore"]')).toBeNull();

    // Trigger maximized change event
    await act(async () => {
      stateCallback?.(true);
    });

    expect(container.querySelector('button[aria-label="Restore"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Maximize"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
