import { isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { parse, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
export const MemoryMcpConfigSchema = z
  .object({
    dbPath: z.string().refine(isAbsolute),
    scope: z.object({ scope: z.literal('project'), scopeKey: z.string().min(1) }).strict(),
    profile: z.enum(['readonly', 'full']).default('readonly'),
    transport: z.object({ type: z.literal('stdio') }).default({ type: 'stdio' }),
    pinQuota: z.number().int().positive().optional(),
    writeTrust: z.enum(['high', 'low']).default('low'),
    allowCandidateReview: z.boolean().default(false),
    limits: z
      .object({
        defaultLimit: z.number().int().min(1).max(50).optional(),
        maxLimit: z.number().int().min(1).max(50).optional(),
        previewLength: z.number().int().min(1).max(5000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type MemoryMcpConfig = z.infer<typeof MemoryMcpConfigSchema>;
export function readConfig(
  path = process.env.MEMORY_MCP_CONFIG ??
    `${process.env.XDG_CONFIG_HOME ?? `${homedir()}/.config`}/aifcoding/memory-mcp.jsonc`,
): MemoryMcpConfig {
  const raw = readFileSync(path, 'utf8');
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`Invalid JSONC configuration in ${path}`);
  return MemoryMcpConfigSchema.parse(parsed);
}
