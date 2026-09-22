#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAcuityMcpServer } from './server';

async function main() {
  const server = createAcuityMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[acuity-mcp] Acuity MCP Server active and listening on stdio');
}

main().catch((err) => {
  console.error('[acuity-mcp] Fatal error:', err);
  process.exit(1);
});
