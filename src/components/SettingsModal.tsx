import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  FolderOpen,
  FolderPlus,
  Laptop,
  Loader2,
  Moon,
  Palette,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type { AppTheme, McpClientInfo } from '../types';

export type SettingsTab = 'theme' | 'folders' | 'mcp';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: SettingsTab;
  onClose: () => void;
  appTheme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  folders: string[];
  onAddFolder: () => void;
  onRemoveFolder: (folder: string) => void;
  onRescan: () => void;
  isScanning: boolean;
  totalItems: number;
  booksCount: number;
  audioCount: number;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 'folders',
  onClose,
  appTheme,
  onThemeChange,
  folders,
  onAddFolder,
  onRemoveFolder,
  onRescan,
  isScanning,
  totalItems,
  booksCount,
  audioCount,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [mcpClients, setMcpClients] = useState<McpClientInfo[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [actionClientId, setActionClientId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [snippetClientId, setSnippetClientId] = useState<string>('claude');
  const [snippetText, setSnippetText] = useState<string>('');
  const [hasCopied, setHasCopied] = useState<boolean>(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  /* Synchronize activeTab when initialTab or isOpen updates */
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  /* Minimal focus management */
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!nodes || nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [isOpen, onClose]);

  // Load MCP clients when modal opens or tab changes to mcp
  useEffect(() => {
    if (!isOpen || activeTab !== 'mcp') return;

    let mounted = true;
    const fetchMcpData = async () => {
      if (!window.electronAPI?.getMcpClients) return;
      setLoadingClients(true);
      try {
        const clients = await window.electronAPI.getMcpClients();
        if (mounted) setMcpClients(clients);
      } catch (err) {
        console.error('Failed to load MCP clients:', err);
      } finally {
        if (mounted) setLoadingClients(false);
      }
    };

    fetchMcpData();
    return () => {
      mounted = false;
    };
  }, [isOpen, activeTab]);

  // Load configuration snippet
  useEffect(() => {
    if (!isOpen || activeTab !== 'mcp') return;

    let mounted = true;
    const fetchSnippet = async () => {
      if (!window.electronAPI?.getMcpSnippet) return;
      try {
        const text = await window.electronAPI.getMcpSnippet(snippetClientId);
        if (mounted) setSnippetText(text);
      } catch (err) {
        console.error('Failed to get snippet:', err);
      }
    };

    fetchSnippet();
    return () => {
      mounted = false;
    };
  }, [isOpen, activeTab, snippetClientId]);

  const handleInstallClient = async (clientId: string) => {
    if (!window.electronAPI?.installMcpClient) return;
    setActionClientId(clientId);
    setNotification(null);
    try {
      const res = await window.electronAPI.installMcpClient(clientId);
      if (res.success) {
        setNotification({ type: 'success', message: res.message || 'Configured successfully!' });
        const updated = await window.electronAPI.getMcpClients();
        setMcpClients(updated);
      } else {
        setNotification({ type: 'error', message: res.message || 'Failed to install configuration.' });
      }
    } catch (err: unknown) {
      setNotification({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionClientId(null);
    }
  };

  const handleUninstallClient = async (clientId: string) => {
    if (!window.electronAPI?.uninstallMcpClient) return;
    setActionClientId(clientId);
    setNotification(null);
    try {
      const res = await window.electronAPI.uninstallMcpClient(clientId);
      if (res.success) {
        setNotification({ type: 'success', message: res.message || 'Configuration removed.' });
        const updated = await window.electronAPI.getMcpClients();
        setMcpClients(updated);
      } else {
        setNotification({ type: 'error', message: res.message || 'Failed to remove configuration.' });
      }
    } catch (err: unknown) {
      setNotification({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setActionClientId(null);
    }
  };

  const handleCopySnippet = async () => {
    if (!snippetText) return;
    try {
      await navigator.clipboard.writeText(snippetText);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="animate-sheet-in flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--stroke-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-xl)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--stroke-subtle)] px-5 py-3.5">
          <h2 id="settings-title" className="text-[13.5px] font-semibold text-[var(--text-primary)]">
            Settings
          </h2>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close settings">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[var(--stroke-subtle)] bg-[var(--surface-sunken)]/40 px-5">
          <button
            type="button"
            onClick={() => setActiveTab('theme')}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 text-[12px] font-medium transition-all ${
              activeTab === 'theme'
                ? 'border-[var(--accent)] font-semibold text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            Theme
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('folders')}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 text-[12px] font-medium transition-all ${
              activeTab === 'folders'
                ? 'border-[var(--accent)] font-semibold text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Library Folders
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mcp')}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 px-3 text-[12px] font-medium transition-all ${
              activeTab === 'mcp'
                ? 'border-[var(--accent)] font-semibold text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            AI & MCP
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* TAB 1: INDEPENDENT THEME SELECTION CARD */}
          {activeTab === 'theme' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                  Appearance Theme
                </h3>
                <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                  Choose your application appearance. Acuity adapts seamlessly to Windows 11 Mica acrylic material and your desktop accent color.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2.5 pt-1">
                {[
                  { key: 'system' as const, label: 'System', description: 'Follow Windows', icon: Laptop },
                  { key: 'dark' as const, label: 'Dark', description: 'Deep Mica acrylic', icon: Moon },
                  { key: 'light' as const, label: 'Light', description: 'Clean paper white', icon: Sun },
                ].map(({ key, label, description, icon: Icon }) => {
                  const isSelected = appTheme === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onThemeChange(key)}
                      aria-pressed={isSelected}
                      className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border p-3.5 text-center transition-all duration-150 ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent-muted)]/50 shadow-sm ring-1 ring-[var(--accent)]'
                          : 'border-[var(--stroke-subtle)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:border-[var(--stroke-default)] hover:bg-[var(--surface-raised-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${
                          isSelected
                            ? 'bg-[var(--accent)] text-white'
                            : 'bg-[var(--surface-sunken)] text-[var(--text-secondary)]'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p
                          className={`text-[12px] font-semibold ${
                            isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {label}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-[var(--stroke-subtle)] pt-3">
                <div className="rounded-[var(--radius-md)] border border-[var(--stroke-subtle)] bg-[var(--surface-raised)] p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-[var(--text-primary)]">
                      Windows 11 Mica Material
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      <Check className="h-2.5 w-2.5" />
                      Hardware Accelerated
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                    Translucency dynamically samples your desktop wallpaper behind the app through the DWM compositor for native depth.
                  </p>
                </div>
              </div>

              <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">
                Note: In-reader reading themes (Dark, Sepia, Light, Inverted) are also independently accessible inside book reading mode via the Reader toolbar.
              </p>
            </div>
          )}

          {/* TAB 2: INDEPENDENT LIBRARY FOLDERS CARD */}
          {activeTab === 'folders' && (
            <div className="space-y-5">
              <div className="space-y-1">
                <h3 className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                  Library Folders
                </h3>
                <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                  Manage the directories Acuity monitors for books, EPUBs, PDFs, and audiobooks.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Titles', value: totalItems },
                  { label: 'Books', value: booksCount },
                  { label: 'Audio', value: audioCount },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="surface-raised rounded-[var(--radius-md)] px-3 py-2.5 text-center"
                  >
                    <p className="text-[17px] font-semibold tabular-nums text-[var(--text-primary)]">
                      {stat.value}
                    </p>
                    <p className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                {folders.length === 0 ? (
                  <p className="py-3 text-center text-[12px] text-[var(--text-tertiary)]">
                    No folders are being watched yet.
                  </p>
                ) : (
                  folders.map((folder) => (
                    <div
                      key={folder}
                      className="surface-raised group flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2"
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-secondary)]"
                        title={folder}
                        dir="rtl"
                      >
                        {folder}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveFolder(folder)}
                        className="icon-button h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red-400"
                        aria-label={`Stop watching ${folder}`}
                        title="Stop watching this folder"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onAddFolder}
                  className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--text-primary)] px-3 py-2 text-[12px] font-semibold text-[var(--text-inverse)] transition-transform duration-150 ease-[var(--ease-out)] hover:brightness-105 active:scale-[0.98]"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  Add folder
                </button>

                <button
                  type="button"
                  onClick={onRescan}
                  disabled={isScanning || folders.length === 0}
                  className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--stroke-default)] px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-raised-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  {isScanning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Rescan
                </button>
              </div>

              <p className="text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">
                Acuity reads these folders and their subfolders. Covers and metadata come from embedded
                tags where present, or from a matching image beside the file.
              </p>
            </div>
          )}

          {/* TAB 3: INDEPENDENT AI & MCP INTEGRATION CARD */}
          {activeTab === 'mcp' && (
            <div className="space-y-5">
              {/* MCP Overview */}
              <div className="rounded-[var(--radius-md)] border border-[var(--accent-ring)]/40 bg-[var(--accent-muted)]/30 p-3.5">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                  <div className="space-y-1">
                    <p className="text-[12px] font-medium text-[var(--text-primary)]">
                      Connect Acuity to your AI assistants
                    </p>
                    <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      Model Context Protocol (MCP) allows AI tools (Claude, Cursor, Antigravity) to query your books,
                      read chapter excerpts, inspect reading progress, and manage bookmarks.
                    </p>
                  </div>
                </div>
              </div>

              {/* Notification Banner */}
              {notification && (
                <div
                  className={`rounded-[var(--radius-md)] border px-3 py-2 text-[11.5px] ${
                    notification.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}
                >
                  {notification.message}
                </div>
              )}

              {/* 1-Click Integrations List */}
              <div className="space-y-2.5">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                  1-Click AI Integrations
                </h3>

                {loadingClients ? (
                  <div className="flex items-center justify-center py-6 text-[12px] text-[var(--text-tertiary)]">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Detecting AI clients...
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mcpClients.map((client) => {
                      const isActing = actionClientId === client.id;
                      return (
                        <div
                          key={client.id}
                          className="surface-raised flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--stroke-subtle)] p-3 transition-colors hover:border-[var(--stroke-default)]"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
                                {client.name}
                              </span>
                              {client.installed ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                                  <Check className="h-2.5 w-2.5" />
                                  Configured
                                </span>
                              ) : client.detected ? (
                                <span className="inline-flex items-center rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                                  Detected on PC
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-[var(--surface-raised-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
                                  Not Found
                                </span>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                              {client.description}
                            </p>
                          </div>

                          <div className="shrink-0">
                            {client.installed ? (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => handleUninstallClient(client.id)}
                                className="rounded-[var(--radius-sm)] border border-[var(--stroke-subtle)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                              >
                                {isActing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  'Remove'
                                )}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => handleInstallClient(client.id)}
                                className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--text-primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-inverse)] transition-all hover:brightness-105 active:scale-95 disabled:opacity-40"
                              >
                                {isActing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>
                                    <Sparkles className="h-3 w-3" />
                                    1-Click Setup
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--stroke-subtle)]" />

              {/* Manual Snippet Section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                    Manual Configuration Snippet
                  </h3>
                  <button
                    type="button"
                    onClick={handleCopySnippet}
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
                  >
                    {hasCopied ? (
                      <>
                        <Check className="h-3 w-3" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy Snippet
                      </>
                    )}
                  </button>
                </div>

                {/* Sub-tabs for snippets */}
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {[
                    { id: 'claude', label: 'Claude Desktop' },
                    { id: 'cursor', label: 'Cursor' },
                    { id: 'antigravity', label: 'Antigravity' },
                    { id: 'cli', label: 'Claude Code CLI' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSnippetClientId(tab.id)}
                      className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        snippetClientId === tab.id
                          ? 'bg-[var(--surface-raised-hover)] text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Code preview block */}
                <div className="relative rounded-[var(--radius-md)] border border-[var(--stroke-default)] bg-black/60 p-3">
                  <pre className="max-h-36 overflow-x-auto overflow-y-auto font-mono text-[11px] leading-relaxed text-zinc-300">
                    {snippetText || '// Loading configuration...'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
