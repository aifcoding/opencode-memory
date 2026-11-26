import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtractionService } from '../src/application/ExtractionService';
import { createSqliteMemoryManager } from '../src/sqlite/index';

const scope = { scope: 'global' as const, scopeKey: 'default' };
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'extraction-'));
  return createSqliteMemoryManager({ dbPath: join(dir, 'm.db') });
};

const message = (id: string, text: string) => ({
  id,
  role: 'user' as const,
  text,
  synthetic: false,
  origin: 'human' as const,
});

function service(manager: ReturnType<typeof fresh>, generator: any) {
  return new ExtractionService(manager, generator, {
    maxInputChars: 2000,
    maxOutputTokens: 800,
    maxCandidates: 5,
  });
}

const request = (messages: any[], overrides: Record<string, unknown> = {}) => ({
  scope,
  sourceKind: 'host-transcript' as const,
  contextKey: 'ses_1',
  snapshotId: 'snap_1',
  trigger: 'manual' as const,
  instructions: 'extract',
  targetFingerprint: 'test-target',
  messages,
  ...overrides,
});

test('redacts credentials before generation and writes valid candidates', async () => {
  const manager = fresh();
  let sent = '';
  const generator = {
    async generate(input: any) {
      sent = input.data;
      return {
        text: JSON.stringify({
          candidates: [
            {
              title: 'atlas 仓库路径',
              content: 'atlas 仓库统一放在 /srv/atlas，部署脚本从这里取构件。',
              type: 'fact',
              suggestedDomain: 'code',
              evidenceQuote: 'atlas 仓库统一放 /srv/atlas',
            },
          ],
        }),
      };
    },
  };
  const result = await service(manager, generator).extract(
    request([message('u1', 'atlas 仓库统一放 /srv/atlas，登录 password=abc123')]),
  );
  expect(result.status).toBe('completed');
  expect(result.candidateCount).toBe(1);
  expect(sent).not.toContain('abc123');
  expect(sent).toContain('[REDACTED]');
  expect(await manager.listMemoryCandidates({ scope })).toHaveLength(1);
  manager.close();
});

test('invalid json fails without writing candidates', async () => {
  const manager = fresh();
  const generator = { async generate() { return { text: 'not json' }; } };
  const result = await service(manager, generator).extract(request([message('u1', 'atlas 路径 /srv/atlas')]));
  expect(result.status).toBe('failed');
  expect(await manager.listMemoryCandidates({ scope })).toHaveLength(0);
  manager.close();
});

test('candidates without evidence or with unknown evidence are kept (quality moved to prompt)', async () => {
  const manager = fresh();
  const generator = {
    async generate() {
      return {
        text: JSON.stringify({
          candidates: [
            { title: '无证据', content: '这是一条没有证据的候选内容，长度足够但缺少引用。', type: 'fact', suggestedDomain: 'code' },
            { title: '假证据', content: '这条候选引用了材料里不存在的句子，应该被丢弃。', type: 'fact', suggestedDomain: 'code', evidenceQuote: '材料里没有这句话' },
          ],
        }),
      };
    },
  };
  const result = await service(manager, generator).extract(request([message('u1', 'atlas 路径 /srv/atlas 已确认')]));
  expect(result.status).toBe('completed');
  expect(result.candidateCount).toBe(2);
  manager.close();
});

test('material over budget keeps the most recent messages', async () => {
  const manager = fresh();
  let sent = '';
  const generator = {
    async generate(input: any) {
      sent = input.data;
      return { text: JSON.stringify({ candidates: [] }) };
    },
  };
  const filler = '这是一段用于占满预算的说明文字。';
  const messages = [
    message('u1', '旧内容 ' + filler.repeat(30)),
    message('u2', '新内容 ' + filler.repeat(30)),
  ];
  const svc = new ExtractionService(manager, generator, {
    maxInputChars: 600,
    maxOutputTokens: 200,
    maxCandidates: 3,
  });
  const result = await svc.extract(request(messages));
  expect(result.status).toBe('completed');
  expect(sent).toContain('新内容');
  expect(sent).not.toContain('旧内容');
  manager.close();
});

test('model-report accepts the unknown role, host transcripts do not', async () => {
  const manager = fresh();
  const calls: string[] = [];
  const generator = {
    async generate(input: any) {
      calls.push(input.data);
      return { text: JSON.stringify({ candidates: [] }) };
    },
  };
  const serviceUnderTest = service(manager, generator);
  const modelReport = [
    { id: 'model-report', role: 'unknown' as const, text: 'probe 的端口是 18093', synthetic: false, origin: 'model-report' as const },
  ];

  const rejected = await serviceUnderTest.extract(request(modelReport));
  expect(rejected.status).toBe('skipped');
  expect(rejected.reason).toBe('empty_material');

  const accepted = await serviceUnderTest.extract(
    request(modelReport, { sourceKind: 'model-report', contextKey: 'mcp:model-report' }),
  );
  expect(accepted.status).toBe('completed');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('18093');
  await manager.close();
});

test('final payload scan rejects credentials that only form after joining', async () => {
  const manager = fresh();
  let called = 0;
  const generator = {
    async generate() {
      called += 1;
      return { text: '{"candidates":[]}' };
    },
  };
  const svc = service(manager, generator);
  const result = await svc.extract(
    request([
      { id: 'm1', role: 'user', text: '记住 password=', synthetic: false, origin: 'human' },
      { id: 'm2', role: 'user', text: 'abc123 这个值', synthetic: false, origin: 'human' },
    ]),
  );
  expect(result.status).toBe('skipped');
  expect(result.reason).toBe('credential_residual');
  expect(called).toBe(0);
  await manager.close();
});

test('budget is a hard cap for a single oversized message', async () => {
  const manager = fresh();
  let seen = '';
  const generator = {
    async generate(input: any) {
      seen = input.data;
      return { text: '{"candidates":[]}' };
    },
  };
  const svc = new ExtractionService(manager, generator, {
    maxInputChars: 100,
    maxOutputTokens: 100,
    maxCandidates: 5,
  });
  const result = await svc.extract(
    request([{ id: 'm', role: 'user', text: 'x'.repeat(5000), synthetic: false, origin: 'human' }]),
  );
  expect(result.status).toBe('completed');
  expect(seen.length).toBeLessThanOrEqual(100);
  await manager.close();
});

test('idempotency key is content-based, not length-based', async () => {
  const manager = fresh();
  let calls = 0;
  const generator = {
    async generate() {
      calls += 1;
      return { text: '{"candidates":[]}' };
    },
  };
  const svc = service(manager, generator);
  const first = await svc.extract(
    request([{ id: 'a', role: 'user', text: '记住 value-alpha', synthetic: false, origin: 'human' }]),
  );
  const second = await svc.extract(
    request([{ id: 'a', role: 'user', text: '记住 value-beta', synthetic: false, origin: 'human' }]),
  );
  expect(first.status).toBe('completed');
  expect(second.status).toBe('completed');
  expect(calls).toBe(2);
  await manager.close();
});

test('unknown generator errors are folded to a safe code', async () => {
  const manager = fresh();
  const generator = {
    async generate() {
      throw new Error('boom password=abc123');
    },
  };
  const svc = service(manager, generator);
  const result = await svc.extract(
    request([{ id: 'a', role: 'user', text: '记住 value', synthetic: false, origin: 'human' }]),
  );
  expect(result.status).toBe('failed');
  expect(result.reason).toBe('generator_failed');
  await manager.close();
});

test('credentials in the instructions are rejected before generation', async () => {
  const manager = fresh();
  let called = 0;
  const generator = {
    async generate() {
      called += 1;
      return { text: '{"candidates":[]}' };
    },
  };
  const svc = service(manager, generator);
  const result = await svc.extract(
    request([message('u1', 'atlas 路径 /srv/atlas 已确认')], {
      instructions: '规则：password=abc123 不要外发',
    }),
  );
  expect(result.status).toBe('skipped');
  expect(result.reason).toBe('credential_in_instructions');
  expect(called).toBe(0);
  await manager.close();
});

test('autoApprove writes memories directly and leaves no pending candidates', async () => {
  const manager = fresh();
  const generator = {
    async generate() {
      return {
        text: JSON.stringify({
          candidates: [
            {
              title: 'atlas 仓库路径',
              content: 'atlas 仓库统一放在 /srv/atlas，部署脚本从这里取构件。',
              type: 'fact',
              suggestedDomain: 'code',
              evidenceQuote: 'atlas 仓库统一放 /srv/atlas',
            },
          ],
        }),
      };
    },
  };
  const result = await service(manager, generator).extract(
    request([message('u1', 'atlas 仓库统一放 /srv/atlas')], { autoApprove: true }),
  );
  expect(result.status).toBe('completed');
  expect(result.approvedCount).toBe(1);
  expect(await manager.listMemoryCandidates({ scope })).toHaveLength(0);
  const memories = await manager.listMemories({ scope });
  expect(memories).toHaveLength(1);
  expect(memories[0]!.trust).toBe('high');
  manager.close();
});
