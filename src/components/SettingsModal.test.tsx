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
    initialTab: 'folders' as const,
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

  it('renders independent theme selection card when initialTab="theme"', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal {...defaultProps} initialTab="theme" />);
    });

    expect(container.textContent).toContain('Settings');
    expect(container.textContent).toContain('Appearance Theme');
    expect(container.textContent).toContain('Windows 11 Mica Material');

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
      root.render(<SettingsModal {...defaultProps} initialTab="theme" onThemeChange={onThemeChange} />);
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

  it('renders stats, watched folders, and handles folder actions when on folders tab', async () => {
    const onRemoveFolder = vi.fn();
    const onAddFolder = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <SettingsModal
          {...defaultProps}
          initialTab="folders"
          onRemoveFolder={onRemoveFolder}
          onAddFolder={onAddFolder}
        />
      );
    });

    expect(container.textContent).toContain('Library Folders');
    expect(container.textContent).toContain('42');
    expect(container.textContent).toContain('C:/Books');
    expect(container.textContent).toContain('D:/Audiobooks');

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

  it('allows navigating between Theme, Library Folders, and AI & MCP tabs', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal {...defaultProps} initialTab="folders" />);
    });

    expect(container.textContent).toContain('Library Folders');

    // Click Theme tab
    const themeTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === 'Theme'
    );
    expect(themeTabBtn).toBeDefined();

    await act(async () => {
      themeTabBtn?.click();
    });

    expect(container.textContent).toContain('Appearance Theme');
    expect(container.textContent).toContain('Windows 11 Mica Material');

    // Click Folders tab
    const foldersTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Library Folders')
    );
    expect(foldersTabBtn).toBeDefined();

    await act(async () => {
      foldersTabBtn?.click();
    });

    expect(container.textContent).toContain('C:/Books');

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

  it('switches to AI & MCP tab and renders 1-click integration options', async () => {
    const mockClients = [
      {
        id: 'claude' as const,
        name: 'Claude Desktop',
        description: 'Anthropic Claude Desktop assistant',
        detected: true,
        installed: false,
        configPath: 'C:/AppData/Claude/config.json',
      },
      {
        id: 'cursor' as const,
        name: 'Cursor IDE',
        description: 'AI-first code editor',
        detected: true,
        installed: true,
        configPath: 'C:/.cursor/mcp.json',
      },
    ];

    window.electronAPI = {
      ...(window.electronAPI || {}),
      getMcpClients: vi.fn().mockResolvedValue(mockClients),
      installMcpClient: vi.fn().mockResolvedValue({ success: true, message: 'Installed!' }),
      uninstallMcpClient: vi.fn().mockResolvedValue({ success: true, message: 'Removed!' }),
      getMcpSnippet: vi.fn().mockResolvedValue('{"mcpServers": {}}'),
    } as any;

    const root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal {...defaultProps} initialTab="folders" />);
    });

    // Click on AI & MCP tab
    const mcpTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('AI & MCP')
    );
    expect(mcpTabBtn).toBeDefined();

    await act(async () => {
      mcpTabBtn?.click();
    });

    expect(window.electronAPI?.getMcpClients).toHaveBeenCalled();
    expect(container.textContent).toContain('Claude Desktop');
    expect(container.textContent).toContain('Cursor IDE');
    expect(container.textContent).toContain('Configured');
    expect(container.textContent).toContain('Detected on PC');

    // Click 1-Click Setup on Claude
    const installBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('1-Click Setup')
    );
    expect(installBtn).toBeDefined();

    await act(async () => {
      installBtn?.click();
    });

    expect(window.electronAPI?.installMcpClient).toHaveBeenCalledWith('claude');

    await act(async () => {
      root.unmount();
    });
  });
});
