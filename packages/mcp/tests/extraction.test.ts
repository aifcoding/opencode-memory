import { expect, test } from 'bun:test';
import { MemoryMcpConfigSchema } from '../src/config';
import { extractTools } from '../src/tools/extract';
import { registerAllowed } from '../src/tools/registry';

const scope = { scope: 'project' as const, scopeKey: '/repo' };

test('extraction config is optional and validated', () => {
  const base = {
    dbPath: '/tmp/memory.db',
    scope: { scope: 'project', scopeKey: '/repo' },
  };
  expect(MemoryMcpConfigSchema.parse(base).extraction).toBeUndefined();
  const parsed = MemoryMcpConfigSchema.parse({
    ...base,
    extraction: {
      enabled: true,
      allowMcpExtract: true,
      provider: { baseUrl: 'https://api.example.test/v1', model: 'm', apiKeyEnv: 'KEY' },
    },
  });
  expect(parsed.extraction?.enabled).toBe(true);
  expect(parsed.extraction?.maxCandidates).toBe(8);
  expect(() =>
    MemoryMcpConfigSchema.parse({ ...base, extraction: { enabled: true } }),
  ).toThrow();
});

test('memory_extract requires the extract capability', () => {
  expect(registerAllowed(extractTools, ['candidate:read'])).toHaveLength(0);
  expect(registerAllowed(extractTools, ['candidate:extract'])).toHaveLength(1);
});

test('memory_extract forwards text as a model report and reports candidates', async () => {
  const calls: any[] = [];
  const stub: any = {
    async extract(input: any) {
      calls.push(input);
      return { status: 'completed', candidateCount: 2, filteredCount: 0 };
    },
  };
  const ctx: any = {
    manager: {},
    scope,
    defaultLimit: 10,
    maxLimit: 50,
    previewLength: 500,
    writeTrust: 'low',
    recall: { maxCharacters: 3000, maxOverflowItems: 10, maxOverflowCharacters: 1500 },
    extraction: stub,
    extractionFingerprint: 'test',
  };
  const result = await extractTools[0]!.execute(
    { text: 'atlas 仓库统一放 /srv/atlas，已确认，部署脚本从这里取构件。' },
    ctx,
  );
  expect(result.structuredContent.data.candidateCount).toBe(2);
  expect(result.structuredContent.data.status).toBe('completed');
  expect(calls[0].sourceKind).toBe('model-report');
  expect(calls[0].messages[0].role).toBe('unknown');
});

test('memory_extract reports disabled when extraction is absent', async () => {
  const ctx: any = {
    manager: {},
    scope,
    defaultLimit: 10,
    maxLimit: 50,
    previewLength: 500,
    writeTrust: 'low',
    recall: { maxCharacters: 3000, maxOverflowItems: 10, maxOverflowCharacters: 1500 },
  };
  const result = await extractTools[0]!.execute({ text: '至少二十个字符的测试材料内容。' }, ctx);
  expect(result.structuredContent.data.status).toBe('disabled');
});
