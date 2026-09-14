import { z } from 'zod';
import type { MemoryMcpToolDefinition } from './types.js';
import { toolResult } from '../render/tool-result.js';

export const readTools: MemoryMcpToolDefinition[] = [
  {
    name: 'memory_search',
    title: 'Search memory',
    description: 'Search fixed-scope historical memory.',
    inputSchema: z
      .object({ query: z.string().min(1), limit: z.number().int().min(1).optional() })
      .strict(),
    requiredCapabilities: ['memory:read'],
    annotations: { readOnlyHint: true },
    execute: async (input, ctx) => {
      const result = await ctx.manager.recallMemories({
        query: input.query,
        scope: ctx.scope,
        limit: Math.min(input.limit ?? ctx.defaultLimit, ctx.maxLimit),
      });
      const data = result.memories.map(({ memory, score }) => ({
        id: memory.id,
        title: memory.title,
        preview: memory.content.slice(0, ctx.previewLength),
        type: memory.type,
        tags: memory.tags,
        origin: memory.origin,
        trust: memory.trust,
        score,
        scope: { scope: memory.scope, scopeKey: memory.scopeKey },
        updatedAt: memory.updatedAt,
      }));
      return toolResult(
        'memory_search',
        ctx.scope,
        data,
        data.map((m) => `[id=${m.id}] ${m.title}\n${m.preview}`).join('\n\n') ||
          'No matching memory.',
      );
    },
  },
  {
    name: 'memory_read',
    title: 'Read memory',
    description: 'Read one fixed-scope memory.',
    inputSchema: z.object({ id: z.number().int().positive() }).strict(),
    requiredCapabilities: ['memory:read'],
    annotations: { readOnlyHint: true },
    execute: async (input, ctx) => {
      const result = await ctx.manager.readMemory({ id: input.id, scope: ctx.scope });
      return toolResult(
        'memory_read',
        ctx.scope,
        result,
        result.status === 'found'
          ? `[id=${result.memory.id}] ${result.memory.title}\n${result.memory.content}`
          : result.status,
      );
    },
  },
  {
    name: 'memory_list',
    title: 'List memory',
    description: 'List fixed-scope memory metadata.',
    inputSchema: z
      .object({
        type: z.enum(['preference', 'fact', 'decision', 'solution', 'convention']).optional(),
        limit: z.number().int().min(1).optional(),
      })
      .strict(),
    requiredCapabilities: ['memory:read'],
    annotations: { readOnlyHint: true },
    execute: async (input, ctx) => {
      const data = await ctx.manager.listMemories({
        scope: ctx.scope,
        type: input.type,
        limit: Math.min(input.limit ?? ctx.defaultLimit, ctx.maxLimit),
      });
      const metadata = data.map(({ id, title, type, tags, origin, trust, scope, updatedAt }) => ({
        id,
        title,
        type,
        tags,
        origin,
        trust,
        scope: { scope, scopeKey: ctx.scope.scopeKey },
        updatedAt,
      }));
      return toolResult(
        'memory_list',
        ctx.scope,
        metadata,
        metadata.map((m) => `[id=${m.id}] ${m.title} (${m.type})`).join('\n') || 'No memory.',
      );
    },
  },
];
