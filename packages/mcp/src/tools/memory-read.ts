import { z } from 'zod';
import type { MemoryMcpToolDefinition } from './types.js';
import { toolResult } from '../render/tool-result.js';

export const readTools: MemoryMcpToolDefinition[] = [
  {
    name: 'memory_search',
    title: 'Search memory',
    description:
      'Search fixed-scope historical memory. Summary projection only; each score is the relative relevance within this query and must not be compared across queries.',
    inputSchema: z
      .object({
        query: z.string().min(1),
        limit: z.number().int().min(1).optional(),
        maxCharacters: z.number().int().min(1).max(20000).optional(),
      })
      .strict(),
    requiredCapabilities: ['memory:read'],
    annotations: { readOnlyHint: true },
    execute: async (input, ctx) => {
      const result = await ctx.manager.recallMemories({
        query: input.query,
        scope: ctx.scope,
        limit: Math.min(input.limit ?? ctx.defaultLimit, ctx.maxLimit),
        projection: 'summary',
        budget: {
          maxCharacters: input.maxCharacters ?? ctx.recall.maxCharacters,
          preferSummary: true,
          maxOverflowItems: ctx.recall.maxOverflowItems,
          maxOverflowCharacters: ctx.recall.maxOverflowCharacters,
        },
      });
      const data = result.memories.map(({ memory, score }) => {
        const preview = memory.projection === 'title' ? '' : memory.summary;
        return {
          id: memory.id,
          ref: memory.ref,
          title: memory.title,
          preview: preview.slice(0, ctx.previewLength),
          previewSource:
            memory.projection === 'summary' && memory.summarySource === 'stored'
              ? 'stored_summary'
              : 'content_preview',
          type: memory.type,
          tags: memory.tags,
          origin: memory.origin,
          trust: memory.trust,
          score,
          scope: memory.scope,
          updatedAt: memory.updatedAt,
        };
      });
      const detailLines = data
        .map((item) => `[id=${item.id}] ${item.ref} ${item.title}\n${item.preview}`)
        .join('\n\n');
      const overflowLines = result.overflow
        .map(
          (item) =>
            `[id=${item.id}] ${item.ref} ${item.title} trust=${item.trust} score=${item.score}`,
        )
        .join('\n');
      const sections: string[] = [];
      if (detailLines) sections.push(`Detailed matches:\n${detailLines}`);
      if (overflowLines) sections.push(`Additional title-only matches:\n${overflowLines}`);
      if (result.omittedCount > 0)
        sections.push(
          `${result.omittedCount} additional matches were omitted by the overflow budget.`,
        );
      const text =
        sections.length > 0
          ? sections.join('\n\n')
          : result.consideredCount === 0
            ? 'No matching memory.'
            : `${result.consideredCount} matching memories were omitted by the character budget.`;
      return toolResult('memory_search', ctx.scope, data, text, {
        consideredCount: result.consideredCount,
        usedCharacters: result.usedCharacters,
        overflowUsedCharacters: result.overflowUsedCharacters,
        truncated: result.truncated,
        degradedCount: result.degradedCount,
        omittedCount: result.omittedCount,
        overflow: result.overflow,
      });
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
