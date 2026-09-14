import { z } from 'zod';
import type { MemoryMcpToolDefinition } from './types.js';
import { toolResult } from '../render/tool-result.js';
export const writeTools: MemoryMcpToolDefinition[] = [
  {
    name: 'memory_store',
    title: 'Store memory',
    description: 'Store a low-trust agent memory in the fixed scope.',
    inputSchema: z
      .object({
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(50000),
        summary: z.string().max(500).optional(),
        type: z.enum(['preference', 'fact', 'decision', 'solution', 'convention']).default('fact'),
        tags: z.array(z.string().min(1).max(100)).max(20).default([]),
      })
      .strict(),
    requiredCapabilities: ['memory:write'],
    execute: async (input, ctx) => {
      const memory = await ctx.manager.storeMemory({
        ...input,
        scope: ctx.scope,
        origin: 'agent',
        trust: ctx.writeTrust,
      });
      return toolResult(
        'memory_store',
        ctx.scope,
        { id: memory.id, title: memory.title },
        `Stored memory id=${memory.id}.`,
      );
    },
  },
  {
    name: 'memory_forget',
    title: 'Forget memory',
    description: 'Soft-delete a fixed-scope memory.',
    inputSchema: z.object({ id: z.number().int().positive() }).strict(),
    requiredCapabilities: ['memory:write'],
    annotations: { destructiveHint: true },
    execute: async (input, ctx) =>
      toolResult(
        'memory_forget',
        ctx.scope,
        await ctx.manager.forgetMemory({ id: input.id, scope: ctx.scope }),
        `Forget result: ${input.id}.`,
      ),
  },
];
