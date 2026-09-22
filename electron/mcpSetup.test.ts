import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getClientDefinitions,
  getMcpClients,
  installMcpClient,
  uninstallMcpClient,
  getMcpSnippet,
  getMcpCommandConfig,
  parseJsonSafe,
  stripJsonComments,
} from './mcpSetup';

describe('electron/mcpSetup', () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = path.join(os.tmpdir(), `acuity-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.mkdir(tempHome, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(tempHome)) {
      await fs.promises.rm(tempHome, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('provides client definitions for Claude, Cursor, Antigravity, and Windsurf', () => {
    const defs = getClientDefinitions();
    const ids = defs.map((d) => d.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('cursor');
    expect(ids).toContain('antigravity');
    expect(ids).toContain('windsurf');
  });

  it('parses JSON safely with comments', () => {
    const jsonWithComments = `
    {
      // Single line comment
      "mcpServers": {
        /* Block comment */
        "existing-server": {
          "command": "cmd"
        }
      }
    }
    `;
    expect(stripJsonComments(jsonWithComments)).not.toContain('Single line comment');
    const parsed = parseJsonSafe(jsonWithComments);
    expect(parsed.mcpServers['existing-server'].command).toBe('cmd');
  });

  it('installs Acuity MCP server into a client config preserving existing entries', async () => {
    const cursorDir = path.join(tempHome, '.cursor');
    await fs.promises.mkdir(cursorDir, { recursive: true });
    const cursorConfigPath = path.join(cursorDir, 'mcp.json');

    await fs.promises.writeFile(
      cursorConfigPath,
      JSON.stringify({
        mcpServers: {
          'other-tool': { command: 'other-binary' },
        },
      }),
      'utf8'
    );

    const res = await installMcpClient('cursor', tempHome, {
      isPackaged: false,
      appPath: 'C:/Acuity',
    });
    expect(res.success).toBe(true);

    const saved = JSON.parse(await fs.promises.readFile(cursorConfigPath, 'utf8'));
    expect(saved.mcpServers['other-tool'].command).toBe('other-binary');
    expect(saved.mcpServers['acuity-reader']).toBeDefined();
    expect(saved.mcpServers['acuity-reader'].args[0]).toContain('dist-mcp');
  });

  it('uninstalls Acuity MCP server cleanly without deleting other servers', async () => {
    const cursorDir = path.join(tempHome, '.cursor');
    await fs.promises.mkdir(cursorDir, { recursive: true });
    const cursorConfigPath = path.join(cursorDir, 'mcp.json');

    await fs.promises.writeFile(
      cursorConfigPath,
      JSON.stringify({
        mcpServers: {
          'other-tool': { command: 'other-binary' },
          'acuity-reader': { command: 'node', args: ['some-path'] },
        },
      }),
      'utf8'
    );

    const res = await uninstallMcpClient('cursor', tempHome);
    expect(res.success).toBe(true);

    const saved = JSON.parse(await fs.promises.readFile(cursorConfigPath, 'utf8'));
    expect(saved.mcpServers['other-tool']).toBeDefined();
    expect(saved.mcpServers['acuity-reader']).toBeUndefined();
  });

  it('detects installation status accurately with getMcpClients', async () => {
    // Before installing
    const clientsInitial = await getMcpClients(tempHome);
    const cursorInitial = clientsInitial.find((c) => c.id === 'cursor');
    expect(cursorInitial?.installed).toBe(false);

    // Install
    await installMcpClient('cursor', tempHome);

    // After installing
    const clientsAfter = await getMcpClients(tempHome);
    const cursorAfter = clientsAfter.find((c) => c.id === 'cursor');
    expect(cursorAfter?.installed).toBe(true);
    expect(cursorAfter?.detected).toBe(true);
  });

  it('generates packaged command using ELECTRON_RUN_AS_NODE and production paths', () => {
    const cmd = getMcpCommandConfig({
      isPackaged: true,
      resourcesPath: 'C:/Program Files/Acuity/resources',
      execPath: 'C:/Program Files/Acuity/Acuity Reader.exe',
    });
    expect(cmd.command).toBe('C:/Program Files/Acuity/Acuity Reader.exe');
    expect(cmd.args[0]).toBe(path.normalize('C:/Program Files/Acuity/resources/mcp/index.js'));
    expect(cmd.env?.['ELECTRON_RUN_AS_NODE']).toBe('1');
  });

  it('formats snippet for manual copy', () => {
    const snippet = getMcpSnippet('claude', { isPackaged: false, appPath: 'C:/Acuity' });
    expect(snippet).toContain('"acuity-reader"');
    expect(snippet).toContain('dist-mcp');

    const cliSnippet = getMcpSnippet('cli', { isPackaged: false, appPath: 'C:/Acuity' });
    expect(cliSnippet).toContain('claude mcp add acuity-reader');
  });
});
