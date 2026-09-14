#!/usr/bin/env bun
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
import type { MemoryManager } from '@aifcoding/memory-core';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { readConfig } from './config.js';
import { createMemoryMcpServer } from './server.js';

const configIndex = process.argv.indexOf('--config');
const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
if (configIndex >= 0 && !configPath) {
  console.error('--config requires a file path');
  process.exit(2);
}

let manager: MemoryManager | undefined;
try {
  const config = readConfig(configPath);
  manager = createSqliteMemoryManager({ dbPath: config.dbPath, pinQuota: config.pinQuota });
  const server = createMemoryMcpServer({
    manager,
    scope: config.scope,
    profile: config.profile,
    writeTrust: config.writeTrust,
    allowCandidateReview: config.allowCandidateReview,
    defaultLimit: config.limits?.defaultLimit ?? 10,
    maxLimit: config.limits?.maxLimit ?? 50,
    previewLength: config.limits?.previewLength ?? 500,
  });
  const transport = new StdioServerTransport();
  let closed = false;
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    try {
      await server.close();
    } finally {
      await manager?.close();
    }
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  await server.connect(transport);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'memory-mcp failed');
  await manager?.close();
  process.exitCode = 1;
}
