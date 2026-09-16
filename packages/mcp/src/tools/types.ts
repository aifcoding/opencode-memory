import type { MemoryManager, ScopeRef } from '@aifcoding/memory-core';
import type { z } from 'zod';

export type MemoryMcpCapability =
  | 'memory:read'
  | 'memory:write'
  | 'pin:read'
  | 'pin:write'
  | 'candidate:read'
  | 'candidate:review';
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
