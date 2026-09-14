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
export interface MemoryMcpToolContext {
  manager: MemoryManager;
  scope: ScopeRef;
  defaultLimit: number;
  maxLimit: number;
  previewLength: number;
  writeTrust: 'high' | 'low';
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
