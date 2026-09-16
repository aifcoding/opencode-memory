import type { MemoryMcpCapability, MemoryMcpToolDefinition, MemoryMcpProfile } from './types.js';
import { z } from 'zod';
export const memorySearchMetaSchema = z
  .object({
    consideredCount: z.number(),
    usedCharacters: z.number(),
    overflowUsedCharacters: z.number(),
    truncated: z.boolean(),
    degradedCount: z.number(),
    omittedCount: z.number(),
    overflow: z.array(
      z.object({
        projection: z.literal('title'),
        id: z.number(),
        ref: z.string(),
        title: z.string(),
        trust: z.string(),
        score: z.number(),
      }),
    ),
  })
  .strict();
export const mcpOutputSchema = z.union([
  z.object({
    schemaVersion: z.literal(1),
    kind: z.string(),
    notice: z.string(),
    scope: z.object({ scope: z.string(), scopeKey: z.string() }),
    data: z.any(),
    meta: memorySearchMetaSchema.optional(),
  }),
  z.object({
    schemaVersion: z.literal(1),
    ok: z.literal(false),
    error: z.object({
      code: z.enum([
        'VALIDATION_ERROR',
        'NOT_FOUND',
        'DELETED',
        'TRUST_DENIED',
        'QUOTA_EXCEEDED',
        'INTERNAL_ERROR',
      ]),
      message: z.string(),
      retryable: z.boolean(),
    }),
  }),
]);
export const profileCapabilities: Record<MemoryMcpProfile, MemoryMcpCapability[]> = {
  readonly: ['memory:read'],
  full: [
    'memory:read',
    'memory:write',
    'pin:read',
    'pin:write',
    'candidate:read',
    'candidate:review',
  ],
};
export function registerAllowed(
  definitions: MemoryMcpToolDefinition[],
  capabilities: MemoryMcpCapability[],
) {
  return definitions
    .filter((definition) =>
      definition.requiredCapabilities.every((capability) => capabilities.includes(capability)),
    )
    .map((definition) => ({
      ...definition,
      outputSchema: definition.outputSchema ?? mcpOutputSchema,
    }));
}
