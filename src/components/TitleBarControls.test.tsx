import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TitleBarControls } from './TitleBarControls';
import type { ElectronAPI } from '../../electron/preload';

describe('TitleBarControls', () => {
  let container: HTMLDivElement;
  const defaultProps = {
    onOpenSettings: vi.fn(),
    onRescan: vi.fn(),
    isScanning: false,
    scanCount: 0,
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
    window.electronAPI = {
      isPinned: vi.fn().mockResolvedValue(false),
      onPinChanged: vi.fn().mockReturnValue(() => {}),
      togglePin: vi.fn().mockResolvedValue(true),
    } as unknown as ElectronAPI;
  });

  afterEach(() => {
    container.remove();
  });

  it('renders branding and single settings button without standalone topbar action buttons', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<TitleBarControls {...defaultProps} />);
    });

    expect(container.textContent).toContain('Acuity Reader');

    // Only the single Settings button should be present in the topbar
    const settingsBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Settings and options"]');
    expect(settingsBtn).not.toBeNull();

    // Standalone topbar buttons from before should not exist
    const rescanBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Rescan library"]');
    const foldersBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Library folders"]');
    const pinBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Keep window on top"]');
    expect(rescanBtn).toBeNull();
    expect(foldersBtn).toBeNull();
    expect(pinBtn).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('opens menu panel on clicking settings button and triggers menu actions', async () => {
    const onOpenSettings = vi.fn();
    const onRescan = vi.fn();
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TitleBarControls
          {...defaultProps}
          onOpenSettings={onOpenSettings}
          onRescan={onRescan}
        />
      );
    });

    const settingsBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Settings and options"]');
    expect(settingsBtn).not.toBeNull();

    // Click settings button to open the menu
    await act(async () => {
      settingsBtn?.click();
    });

    // Menu should now be open with embedded items
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Rescan library');
    expect(menu?.textContent).toContain('Theme & appearance');
    expect(menu?.textContent).toContain('Library folders');
    expect(menu?.textContent).toContain('AI & MCP integration');
    expect(menu?.textContent).toContain('Keep window on top');

    // Clicking Rescan Library
    const rescanItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.menu-item')).find(
      (btn) => btn.textContent?.includes('Rescan library')
    );
    expect(rescanItem).toBeDefined();

    await act(async () => {
      rescanItem?.click();
    });
    expect(onRescan).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="menu"]')).toBeNull();

    // Re-open and click Theme & appearance
    await act(async () => {
      settingsBtn?.click();
    });
    const themeItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.menu-item')).find(
      (btn) => btn.textContent?.includes('Theme & appearance')
    );
    expect(themeItem).toBeDefined();

    await act(async () => {
      themeItem?.click();
    });
    expect(onOpenSettings).toHaveBeenCalledWith('theme');
    expect(container.querySelector('[role="menu"]')).toBeNull();

    // Re-open and click Library Folders
    await act(async () => {
      settingsBtn?.click();
    });
    const foldersItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.menu-item')).find(
      (btn) => btn.textContent?.includes('Library folders')
    );
    expect(foldersItem).toBeDefined();

    await act(async () => {
      foldersItem?.click();
    });
    expect(onOpenSettings).toHaveBeenCalledWith('folders');
    expect(container.querySelector('[role="menu"]')).toBeNull();

    // Re-open and click AI & MCP
    await act(async () => {
      settingsBtn?.click();
    });
    const mcpItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.menu-item')).find(
      (btn) => btn.textContent?.includes('AI & MCP integration')
    );
    expect(mcpItem).toBeDefined();

    await act(async () => {
      mcpItem?.click();
    });
    expect(onOpenSettings).toHaveBeenCalledWith('mcp');
    expect(container.querySelector('[role="menu"]')).toBeNull();

    // Re-open and toggle pin
    await act(async () => {
      settingsBtn?.click();
    });
    const pinItem = Array.from(container.querySelectorAll<HTMLButtonElement>('.menu-item')).find(
      (btn) => btn.textContent?.includes('Keep window on top')
    );
    expect(pinItem).toBeDefined();

    await act(async () => {
      pinItem?.click();
    });
    expect(window.electronAPI?.togglePin).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('closes menu panel on Escape key', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<TitleBarControls {...defaultProps} />);
    });

    const settingsBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Settings and options"]');
    await act(async () => {
      settingsBtn?.click();
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
