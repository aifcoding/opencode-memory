import { createHash } from 'node:crypto';
import { z } from 'zod';
import { composeInstructions, readInstructionsFile } from '@aifcoding/memory-core';
import type { MemoryMcpToolDefinition } from './types.js';
import { toolResult } from '../render/tool-result.js';



/** MCP 手动提取：材料来自调用方（sourceKind=model-report），不读宿主历史。 */
export const extractTools: MemoryMcpToolDefinition[] = [
  {
    name: 'memory_extract',
    title: 'Extract memory candidates',
    description:
      'Extract durable memory candidates from the provided text. The text is treated as an unverified model report: it is redacted locally, sent to the configured model, and only pending candidates are written. Requires extraction to be enabled in the MCP config.',
    inputSchema: z.object({ text: z.string().min(20).max(200000) }).strict(),
    requiredCapabilities: ['candidate:extract'],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    execute: async (input, ctx) => {
      if (!ctx.extraction) {
        return toolResult('memory_extract', ctx.scope, { status: 'disabled' }, 'Extraction is not enabled.');
      }
      let instructions: string;
      try {
        const userRules = ctx.extractionInstructionsFile
          ? readInstructionsFile(ctx.extractionInstructionsFile)
          : undefined;
        instructions = composeInstructions(userRules);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'instructions_unreadable';
        return toolResult('memory_extract', ctx.scope, { status: 'failed', reason: code }, `提取未执行：${code}`);
      }
      const outcome = await ctx.extraction.extract({
        scope: ctx.scope,
        sourceKind: 'model-report',
        contextKey: 'mcp:model-report',
        snapshotId: createHash('sha256').update(input.text).digest('hex').slice(0, 16),
        trigger: 'manual',
        messages: [
          { id: 'model-report', role: 'unknown', text: input.text, synthetic: false, origin: 'model-report' },
        ],
        instructions,
        targetFingerprint: ctx.extractionFingerprint ?? 'mcp',
      });
      return toolResult(
        'memory_extract',
        ctx.scope,
        { status: outcome.status, candidateCount: outcome.candidateCount, reason: outcome.reason },
        `提取${outcome.status === 'completed' ? '完成' : '未完成'}：新增 ${outcome.candidateCount} 条候选${outcome.reason ? `（${outcome.reason}）` : ''}`,
      );
    },
  },
];
