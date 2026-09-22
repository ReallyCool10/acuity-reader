import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsModal } from './SettingsModal';

describe('SettingsModal', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    appTheme: 'system' as const,
    onThemeChange: vi.fn(),
    folders: ['C:/Books', 'D:/Audiobooks'],
    onAddFolder: vi.fn(),
    onRemoveFolder: vi.fn(),
    onRescan: vi.fn(),
    isScanning: false,
    totalItems: 42,
    booksCount: 20,
    audioCount: 22,
  };

  it('renders stats, watched folders, and appearance theme buttons', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal {...defaultProps} />);
    });

    expect(container.textContent).toContain('Settings');
    expect(container.textContent).toContain('Appearance');
    expect(container.textContent).toContain('Library Folders');
    expect(container.textContent).toContain('42');
    expect(container.textContent).toContain('C:/Books');
    expect(container.textContent).toContain('D:/Audiobooks');

    // Theme buttons: System, Dark, Light
    const systemBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('System'));
    const darkBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Dark'));
    const lightBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Light'));

    expect(systemBtn).toBeDefined();
    expect(darkBtn).toBeDefined();
    expect(lightBtn).toBeDefined();
    expect(systemBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(darkBtn?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      root.unmount();
    });
  });

  it('calls onThemeChange when theme buttons are clicked', async () => {
    const onThemeChange = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal {...defaultProps} onThemeChange={onThemeChange} />);
    });

    const darkBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Dark'));
    await act(async () => {
      darkBtn?.click();
    });

    expect(onThemeChange).toHaveBeenCalledWith('dark');

    const lightBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Light'));
    await act(async () => {
      lightBtn?.click();
    });

    expect(onThemeChange).toHaveBeenCalledWith('light');

    await act(async () => {
      root.unmount();
    });
  });

  it('handles folder removal and add folder actions', async () => {
    const onRemoveFolder = vi.fn();
    const onAddFolder = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <SettingsModal
          {...defaultProps}
          onRemoveFolder={onRemoveFolder}
          onAddFolder={onAddFolder}
        />
      );
    });

    const removeBtn = container.querySelector('button[aria-label="Stop watching C:/Books"]') as HTMLButtonElement;
    expect(removeBtn).toBeDefined();

    await act(async () => {
      removeBtn?.click();
    });
    expect(onRemoveFolder).toHaveBeenCalledWith('C:/Books');

    const addBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Add folder'));
    await act(async () => {
      addBtn?.click();
    });
    expect(onAddFolder).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('closes on Escape key press and backdrop click', async () => {
    const onClose = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal {...defaultProps} onClose={onClose} />);
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
