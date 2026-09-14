import { z } from 'zod';
import type { MemoryMcpToolDefinition } from './types.js';
import { toolResult } from '../render/tool-result.js';
export const candidateTools: MemoryMcpToolDefinition[] = [
  {
    name: 'memory_candidate_list',
    title: 'List candidates',
    description: 'List pending candidates in the fixed scope.',
    inputSchema: z
      .object({
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        suggestedDomain: z.enum(['code', 'user', 'business', 'uncertain']).optional(),
        limit: z.number().int().min(1).max(20).default(20),
      })
      .strict(),
    requiredCapabilities: ['candidate:read'],
    execute: async (input, ctx) => {
      const candidates = await ctx.manager.listMemoryCandidates({ ...input, scope: ctx.scope });
      const data = candidates.map((c) => ({
        id: c.id,
        title: c.title,
        preview: c.content.slice(0, ctx.previewLength),
        status: c.status,
        suggestedDomain: c.suggestedDomain,
        type: c.type,
        tags: c.tags,
        trust: c.trust,
        createdAt: c.createdAt,
      }));
      return toolResult(
        'memory_candidate_list',
        ctx.scope,
        data,
        data.map((c) => `[id=${c.id}] ${c.title} (${c.status}, ${c.suggestedDomain})`).join('\n') ||
          'No candidates.',
      );
    },
  },
  {
    name: 'memory_candidate_read',
    title: 'Read candidate',
    description: 'Read one candidate.',
    inputSchema: z.object({ id: z.number().int().positive() }).strict(),
    requiredCapabilities: ['candidate:read'],
    execute: async (input, ctx) => {
      const result = await ctx.manager.readMemoryCandidate({ id: input.id, scope: ctx.scope });
      const text =
        result.status === 'found'
          ? `[id=${result.candidate.id}] ${result.candidate.title} (${result.candidate.status}, ${result.candidate.suggestedDomain})\n${result.candidate.content}`
          : `Candidate ${result.status}.`;
      return toolResult('memory_candidate_read', ctx.scope, result, text);
    },
  },
  {
    name: 'memory_candidate_review',
    title: 'Review candidate',
    description: 'Approve or reject one candidate.',
    inputSchema: z
      .object({ id: z.number().int().positive(), decision: z.enum(['approve', 'reject']) })
      .strict(),
    requiredCapabilities: ['candidate:review'],
    execute: async (input, ctx) => {
      const result = await ctx.manager.reviewMemoryCandidate({
        id: input.id,
        decision: input.decision,
        scope: ctx.scope,
      });
      return toolResult(
        'memory_candidate_review',
        ctx.scope,
        result,
        `Candidate review result: ${result.status}.`,
      );
    },
  },
];
