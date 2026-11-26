import type { ExtractionService, MemoryManager, ScopeRef } from '@aifcoding/memory-core';
import type { z } from 'zod';

export type MemoryMcpCapability =
  | 'memory:read'
  | 'memory:write'
  | 'pin:read'
  | 'pin:write'
  | 'candidate:read'
  | 'candidate:review'
  | 'candidate:extract';
export type MemoryMcpProfile = 'readonly' | 'full';
/** Server-side recall budget; `memory_search.maxCharacters` may override only the Detail budget. */
export interface MemoryMcpRecallConfig {
  maxCharacters: number;
  maxOverflowItems: number;
  maxOverflowCharacters: number;
}
export interface MemoryMcpToolContext {
  manager: MemoryManager;
  scope: ScopeRef;
  defaultLimit: number;
  maxLimit: number;
  previewLength: number;
  writeTrust: 'high' | 'low';
  recall: MemoryMcpRecallConfig;
  /** 仅在启用提取且允许 MCP 手动提取时提供。 */
  extraction?: ExtractionService;
  extractionFingerprint?: string;
}
export interface MemoryMcpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  requiredCapabilities: MemoryMcpCapability[];
  annotations?: Record<string, unknown>;
  execute: (input: any, context: MemoryMcpToolContext) => Promise<any>;
}
