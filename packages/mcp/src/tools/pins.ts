import { z } from 'zod';
import type { MemoryMcpToolDefinition } from './types.js';
import { toolResult } from '../render/tool-result.js';
export const pinTools: MemoryMcpToolDefinition[] = [
  {
    name: 'memory_pin',
    title: 'Pin memory',
    description: 'Pin a fixed-scope memory.',
    inputSchema: z
      .object({
        id: z.number().int().positive(),
        pinMode: z.enum(['full', 'summary']).default('summary'),
        summary: z.string().optional(),
      })
      .strict(),
    requiredCapabilities: ['pin:write'],
    execute: async (input, ctx) =>
      toolResult(
        'memory_pin',
        ctx.scope,
        await ctx.manager.pinMemory({ ...input, scope: ctx.scope }),
        `Pin result: ${input.id}.`,
      ),
  },
  {
    name: 'memory_unpin',
    title: 'Unpin memory',
    description: 'Unpin a fixed-scope memory.',
    inputSchema: z.object({ id: z.number().int().positive() }).strict(),
    requiredCapabilities: ['pin:write'],
    execute: async (input, ctx) =>
      toolResult(
        'memory_unpin',
        ctx.scope,
        await ctx.manager.unpinMemory({ id: input.id, scope: ctx.scope }),
        `Unpin result: ${input.id}.`,
      ),
  },
  {
    name: 'memory_pins',
    title: 'List pins',
    description: 'List fixed-scope pinned memory metadata.',
    inputSchema: z.object({}).strict(),
    requiredCapabilities: ['pin:read'],
    annotations: { readOnlyHint: true },
    execute: async (_input, ctx) => {
      const pins = await ctx.manager.listPinnedMemories({ scope: ctx.scope });
      const data = pins.map((p) => ({
        id: p.id,
        title: p.title,
        pinMode: p.pinMode,
        summary: p.summary,
        scope: { scope: p.scope, scopeKey: p.scopeKey },
        updatedAt: p.updatedAt,
      }));
      return toolResult(
        'memory_pins',
        ctx.scope,
        data,
        data.map((p) => `[id=${p.id}] ${p.title} (${p.pinMode})`).join('\n') || 'No pinned memory.',
      );
    },
  },
];
