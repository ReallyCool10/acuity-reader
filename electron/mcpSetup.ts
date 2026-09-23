import fs from 'fs';
import path from 'path';
import os from 'os';
import type { McpClientInfo, McpSetupResult } from '../src/types';

/**
 * Host values this module needs from the Electron app object.
 *
 * They are injected rather than imported. A static `import { app } from 'electron'`
 * makes every consumer - including a unit test of pure path logic - resolve the
 * Electron binary, which is why this file's tests could not run. Every other
 * extracted module in electron/ stays free of that dependency; this one now does too.
 */
interface McpRuntime {
  isPackaged: boolean;
  appPath: string;
}

let runtime: McpRuntime = {
  isPackaged: false,
  appPath: typeof process !== 'undefined' ? process.cwd() : '',
};

/** Called once from the main process during startup. */
export function configureMcpRuntime(next: Partial<McpRuntime>): void {
  runtime = { ...runtime, ...next };
}

export interface ClientDefinition {
  id: 'claude' | 'cursor' | 'antigravity' | 'windsurf';
  name: string;
  description: string;
  getConfigPath: (customHome?: string) => string;
  isAppDetected: (configPath: string, customHome?: string) => boolean;
}

export function getClientDefinitions(): ClientDefinition[] {
  return [
    {
      id: 'claude',
      name: 'Claude Desktop',
      description: 'Anthropic Claude Desktop assistant',
      getConfigPath: (customHome?: string) => {
        if (process.platform === 'win32') {
          const appData = customHome
            ? path.join(customHome, 'AppData', 'Roaming')
            : process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
          return path.join(appData, 'Claude', 'claude_desktop_config.json');
        } else if (process.platform === 'darwin') {
          const home = customHome || os.homedir();
          return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        } else {
          const home = customHome || os.homedir();
          return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
        }
      },
      isAppDetected: (configPath: string, customHome?: string) => {
        if (fs.existsSync(configPath)) return true;
        const dir = path.dirname(configPath);
        if (fs.existsSync(dir)) return true;
        // Check program files on Windows
        if (process.platform === 'win32') {
          const localAppData = customHome
            ? path.join(customHome, 'AppData', 'Local')
            : process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
          if (fs.existsSync(path.join(localAppData, 'Programs', 'Claude'))) return true;
        }
        return false;
      },
    },
    {
      id: 'cursor',
      name: 'Cursor IDE',
      description: 'AI-first code editor and assistant',
      getConfigPath: (customHome?: string) => {
        const home = customHome || os.homedir();
        return path.join(home, '.cursor', 'mcp.json');
      },
      isAppDetected: (configPath: string, customHome?: string) => {
        if (fs.existsSync(configPath)) return true;
        const home = customHome || os.homedir();
        return fs.existsSync(path.join(home, '.cursor'));
      },
    },
    {
      id: 'antigravity',
      name: 'Antigravity / Gemini CLI',
      description: 'Google Deepmind Agentic CLI & Assistant',
      getConfigPath: (customHome?: string) => {
        const home = customHome || os.homedir();
        return path.join(home, '.gemini', 'config', 'mcp_config.json');
      },
      isAppDetected: (configPath: string, customHome?: string) => {
        if (fs.existsSync(configPath)) return true;
        const home = customHome || os.homedir();
        return fs.existsSync(path.join(home, '.gemini'));
      },
    },
    {
      id: 'windsurf',
      name: 'Codeium Windsurf',
      description: 'Agentic developer IDE by Codeium',
      getConfigPath: (customHome?: string) => {
        const home = customHome || os.homedir();
        return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
      },
      isAppDetected: (configPath: string, customHome?: string) => {
        if (fs.existsSync(configPath)) return true;
        const home = customHome || os.homedir();
        return fs.existsSync(path.join(home, '.codeium'));
      },
    },
  ];
}

export function getMcpCommandConfig(options?: {
  isPackaged?: boolean;
  appPath?: string;
  resourcesPath?: string;
  execPath?: string;
}): {
  command: string;
  args: string[];
  env?: Record<string, string>;
} {
  const isPackaged = options?.isPackaged ?? runtime.isPackaged;
  const resourcesPath = options?.resourcesPath ?? (typeof process !== 'undefined' ? process.resourcesPath : '');
  const execPath = options?.execPath ?? (typeof process !== 'undefined' ? process.execPath : '');
  const appPath = options?.appPath ?? runtime.appPath;

  if (isPackaged && resourcesPath) {
    const scriptPath = path.join(resourcesPath, 'mcp', 'index.js');
    return {
      command: execPath,
      args: [scriptPath],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
      },
    };
  }

  // In development mode, prioritize node.exe if installed
  const distPath = path.resolve(appPath, 'dist-mcp', 'index.js');
  const winNodeDefault = 'C:\\Program Files\\nodejs\\node.exe';
  const nodeBinary =
    process.platform === 'win32' && fs.existsSync(winNodeDefault)
      ? winNodeDefault
      : 'node';

  return {
    command: nodeBinary,
    args: [distPath],
  };
}

export function stripJsonComments(str: string): string {
  return str.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
}

export function parseJsonSafe(content: string): Record<string, any> {
  try {
    return JSON.parse(content);
  } catch {
    return JSON.parse(stripJsonComments(content));
  }
}

export async function writeJsonAtomic(filePath: string, data: Record<string, any>): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  const serialized = JSON.stringify(data, null, 2) + '\n';
  await fs.promises.writeFile(tmpPath, serialized, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

export async function getMcpClients(customHome?: string): Promise<McpClientInfo[]> {
  const defs = getClientDefinitions();
  const results: McpClientInfo[] = [];

  for (const def of defs) {
    const configPath = def.getConfigPath(customHome);
    const detected = def.isAppDetected(configPath, customHome);
    let installed = false;

    if (fs.existsSync(configPath)) {
      try {
        const raw = await fs.promises.readFile(configPath, 'utf8');
        const json = parseJsonSafe(raw);
        installed = Boolean(json?.mcpServers?.['acuity-reader']);
      } catch {
        installed = false;
      }
    }

    results.push({
      id: def.id,
      name: def.name,
      description: def.description,
      detected,
      installed,
      configPath,
    });
  }

  return results;
}

export async function installMcpClient(
  clientId: string,
  customHome?: string,
  options?: { isPackaged?: boolean; appPath?: string; resourcesPath?: string; execPath?: string }
): Promise<McpSetupResult> {
  const defs = getClientDefinitions();
  const def = defs.find((c) => c.id === clientId);
  if (!def) {
    return { success: false, message: `Unsupported client "${clientId}".` };
  }

  const configPath = def.getConfigPath(customHome);

  try {
    let json: Record<string, any> = { mcpServers: {} };

    if (fs.existsSync(configPath)) {
      const raw = await fs.promises.readFile(configPath, 'utf8');
      try {
        json = parseJsonSafe(raw);
      } catch (e) {
        return {
          success: false,
          message: `Unable to parse existing ${def.name} configuration at ${configPath}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      json = {};
    }
    if (!json.mcpServers || typeof json.mcpServers !== 'object' || Array.isArray(json.mcpServers)) {
      json.mcpServers = {};
    }

    const commandConfig = getMcpCommandConfig(options);
    json.mcpServers['acuity-reader'] = {
      command: commandConfig.command,
      args: commandConfig.args,
      ...(commandConfig.env ? { env: commandConfig.env } : {}),
    };

    await writeJsonAtomic(configPath, json);
    return { success: true, message: `Successfully configured Acuity MCP for ${def.name}.` };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Failed to install to ${def.name}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function uninstallMcpClient(clientId: string, customHome?: string): Promise<McpSetupResult> {
  const defs = getClientDefinitions();
  const def = defs.find((c) => c.id === clientId);
  if (!def) {
    return { success: false, message: `Unsupported client "${clientId}".` };
  }

  const configPath = def.getConfigPath(customHome);

  try {
    if (!fs.existsSync(configPath)) {
      return { success: true, message: `No configuration found for ${def.name}.` };
    }

    const raw = await fs.promises.readFile(configPath, 'utf8');
    const json = parseJsonSafe(raw);

    if (json?.mcpServers && typeof json.mcpServers === 'object') {
      delete json.mcpServers['acuity-reader'];
      await writeJsonAtomic(configPath, json);
    }

    return { success: true, message: `Removed Acuity MCP from ${def.name}.` };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Failed to remove Acuity MCP from ${def.name}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function getMcpSnippet(
  clientId: string,
  options?: { isPackaged?: boolean; appPath?: string; resourcesPath?: string; execPath?: string }
): string {
  const commandConfig = getMcpCommandConfig(options);
  const serverConfig = {
    command: commandConfig.command,
    args: commandConfig.args,
    ...(commandConfig.env ? { env: commandConfig.env } : {}),
  };

  if (clientId === 'cli') {
    const argsStr = serverConfig.args.map((a) => `"${a}"`).join(' ');
    return `claude mcp add acuity-reader "${serverConfig.command}" ${argsStr}`;
  }

  return JSON.stringify(
    {
      mcpServers: {
        'acuity-reader': serverConfig,
      },
    },
    null,
    2
  );
}
