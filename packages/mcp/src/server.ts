import { McpServer } from '@modelcontextprotocol/server';
import type { MemoryManager, ScopeRef } from '@aifcoding/memory-core';
import { candidateTools } from './tools/candidates.js';
import { readTools } from './tools/memory-read.js';
import { writeTools } from './tools/memory-write.js';
import { pinTools } from './tools/pins.js';
import { profileCapabilities, registerAllowed } from './tools/registry.js';
import type {
  MemoryMcpProfile,
  MemoryMcpRecallConfig,
  MemoryMcpToolContext,
} from './tools/types.js';
import { errorToolResult } from './render/tool-result.js';

export interface MemoryMcpServerOptions {
  manager: MemoryManager;
  scope: ScopeRef;
  profile?: MemoryMcpProfile;
  defaultLimit?: number;
  maxLimit?: number;
  previewLength?: number;
  writeTrust?: 'high' | 'low';
  allowCandidateReview?: boolean;
  recall?: Partial<MemoryMcpRecallConfig>;
}

export function createMemoryMcpServer(options: MemoryMcpServerOptions): McpServer {
  if (!options.manager) throw new Error('Invalid MCP manager');
  if (!options.scope || options.scope.scope !== 'project' || !options.scope.scopeKey)
    throw new Error('Invalid MCP server scope');
  if (options.profile && !profileCapabilities[options.profile])
    throw new Error('Invalid MCP profile');
  const defaultLimit = options.defaultLimit ?? 10;
  const maxLimit = options.maxLimit ?? 50;
  if (
    !Number.isInteger(defaultLimit) ||
    defaultLimit < 1 ||
    !Number.isInteger(maxLimit) ||
    maxLimit < 1 ||
    defaultLimit > maxLimit
  )
    throw new Error('Invalid MCP limits');
  const previewLength = options.previewLength ?? 500;
  if (!Number.isInteger(previewLength) || previewLength < 1 || previewLength > 5000)
    throw new Error('Invalid MCP previewLength');
  if (
    options.writeTrust !== undefined &&
    options.writeTrust !== 'high' &&
    options.writeTrust !== 'low'
  )
    throw new Error('Invalid MCP writeTrust');
  if (
    options.allowCandidateReview !== undefined &&
    typeof options.allowCandidateReview !== 'boolean'
  )
    throw new Error('Invalid MCP allowCandidateReview');
  const profile = options.profile ?? 'readonly';
  const recall: MemoryMcpRecallConfig = {
    maxCharacters: options.recall?.maxCharacters ?? 3000,
    maxOverflowItems: options.recall?.maxOverflowItems ?? 10,
    maxOverflowCharacters: options.recall?.maxOverflowCharacters ?? 1500,
  };
  if (
    !Number.isInteger(recall.maxCharacters) ||
    recall.maxCharacters < 1 ||
    recall.maxCharacters > 20000
  )
    throw new Error('Invalid MCP recall maxCharacters');
  if (
    !Number.isInteger(recall.maxOverflowItems) ||
    recall.maxOverflowItems < 0 ||
    recall.maxOverflowItems > 20
  )
    throw new Error('Invalid MCP recall maxOverflowItems');
  if (
    !Number.isInteger(recall.maxOverflowCharacters) ||
    recall.maxOverflowCharacters < 0 ||
    recall.maxOverflowCharacters > 10000
  )
    throw new Error('Invalid MCP recall maxOverflowCharacters');
  const capabilities = profileCapabilities[profile].filter(
    (capability) => options.allowCandidateReview || capability !== 'candidate:review',
  );
  const context: MemoryMcpToolContext = {
    manager: options.manager,
    scope: options.scope,
    defaultLimit,
    maxLimit,
    previewLength,
    writeTrust: options.writeTrust ?? 'low',
    recall,
  };
  const server = new McpServer({ name: 'memory-mcp', version: '0.2.0' });
  for (const definition of registerAllowed(
    [...readTools, ...writeTools, ...pinTools, ...candidateTools],
    capabilities,
  )) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema as any,
        outputSchema: definition.outputSchema as any,
        annotations: definition.annotations as any,
      },
      async (input: any) => {
        try {
          return await definition.execute(input, context);
        } catch (error) {
          const message =
            error instanceof Error && error.name === 'MemoryValidationError'
              ? error.message
              : 'Internal MCP error.';
          return errorToolResult(
            error instanceof Error && error.name === 'MemoryValidationError'
              ? 'VALIDATION_ERROR'
              : 'INTERNAL_ERROR',
            message,
          );
        }
      },
    );
  }
  return server;
}
