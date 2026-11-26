import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v1Plugin } from '../src/plugin-v1';

test('capture configures isolation and model before generating with user rules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-model-'));
  const rulesFile = join(dir, 'rules.md');
  writeFileSync(rulesFile, '只收录与 PROBE 有关的事实。');

  const calls: string[] = [];
  let promptText = '';
  const client: any = {
    session: {
      typedContext: async () => ([{ type: 'user', id: 'msg_u1', text: 'PROBE 端口是 18093' }]),
      messages: async () => ({
        data: [
          { info: { id: 'msg_u1', role: 'user' }, parts: [{ type: 'text', text: 'PROBE 端口是 18093' }] },
        ],
      }),
      create: async () => {
        calls.push('create');
        return { data: { id: 'child-1' } };
      },
      update: async ({ body }: any) => {
        calls.push(`update:${body.permissions[0].effect}`);
        return { data: true };
      },
      switchModel: async ({ body }: any) => {
        calls.push(`model:${body.model.providerID}/${body.model.id}`);
        return { data: true };
      },
      prompt: async ({ body }: any) => {
        calls.push('prompt');
        promptText = body.parts[0].text;
        return { data: { parts: [{ type: 'text', text: '{"candidates":[]}' }] } };
      },
      delete: async () => {
        calls.push('delete');
        return { data: true };
      },
    },
    app: { log: async () => undefined },
    tui: { showToast: async () => undefined },
  };

  const hooks: any = await (v1Plugin as any)({ client }, {
    dbPath: join(dir, 'm.db'),
    capture: {
      enabled: true,
      trustRoleAsOrigin: true,
      model: { provider: 'deepseek', model: 'deepseek-flash' },
      instructionsFile: rulesFile,
      maxCandidates: 3,
    },
  });

  const result = await hooks.tool.memory_capture.execute({}, { sessionID: 's1', messageID: 'm1' });

  expect(calls).toEqual([
    'create',
    'update:deny',
    'model:deepseek/deepseek-flash',
    'prompt',
    'delete',
  ]);
  expect(promptText).toContain('只收录与 PROBE 有关的事实。');
  expect(promptText).toContain('【程序附加约束');
  expect(String(result)).toContain('候选');
});

test('unreadable rules file fails without creating a session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-model-'));
  let created = 0;
  const client: any = {
    session: {
      typedContext: async () => ([{ type: 'user', id: 'msg_u1', text: 'PROBE 端口是 18093' }]),
      messages: async () => ({
        data: [
          { info: { id: 'msg_u1', role: 'user' }, parts: [{ type: 'text', text: 'PROBE 端口是 18093' }] },
        ],
      }),
      create: async () => {
        created += 1;
        return { data: { id: 'child-1' } };
      },
      delete: async () => ({ data: true }),
    },
    app: { log: async () => undefined },
    tui: { showToast: async () => undefined },
  };

  const hooks: any = await (v1Plugin as any)({ client }, {
    dbPath: join(dir, 'm.db'),
    capture: {
      enabled: true,
      trustRoleAsOrigin: true,
      instructionsFile: join(dir, 'missing.md'),
    },
  });

  const result = await hooks.tool.memory_capture.execute({}, { sessionID: 's1', messageID: 'm1' });
  expect(String(result)).toContain('instructions_unreadable');
  expect(created).toBe(0);
});

function isolatedClient(overrides: any = {}) {
  const calls: string[] = [];
  const client: any = {
    session: {
      typedContext: async () => [{ type: 'user', id: 'u1', text: 'PROBE 端口是 18093' }],
      create: async () => ({ data: { id: 'child' } }),
      update: async () => ({ data: true }),
      switchModel: async () => ({ data: true }),
      prompt: async () => {
        calls.push('prompt');
        return { data: { parts: [{ type: 'text', text: '{"candidates":[]}' }] } };
      },
      delete: async () => ({ data: true }),
      ...overrides,
    },
    app: { log: async () => undefined },
    tui: { showToast: async () => undefined },
  };
  return { client, calls };
}

test('missing update fails closed without prompting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-model-'));
  const { client, calls } = isolatedClient({ update: undefined });
  const hooks: any = await (v1Plugin as any)({ client }, {
    dbPath: join(dir, 'm.db'),
    capture: { enabled: true },
  });
  const result = await hooks.tool.memory_capture.execute({}, { sessionID: 's1', messageID: 'm1' });
  expect(String(result)).toContain('tool_isolation_unsupported');
  expect(calls).toEqual([]);
});

test('a resolved permission error fails closed without prompting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-model-'));
  const { client, calls } = isolatedClient({ update: async () => ({ error: { status: 403 } }) });
  const hooks: any = await (v1Plugin as any)({ client }, {
    dbPath: join(dir, 'm.db'),
    capture: { enabled: true },
  });
  const result = await hooks.tool.memory_capture.execute({}, { sessionID: 's1', messageID: 'm1' });
  expect(String(result)).toContain('tool_isolation_unsupported');
  expect(calls).toEqual([]);
});

test('a resolved model switch error fails without prompting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-model-'));
  const { client, calls } = isolatedClient({
    switchModel: async () => ({ error: { status: 404 } }),
  });
  const hooks: any = await (v1Plugin as any)({ client }, {
    dbPath: join(dir, 'm.db'),
    capture: {
      enabled: true,
      model: { provider: 'deepseek', model: 'deepseek-flash' },
    },
  });
  const result = await hooks.tool.memory_capture.execute({}, { sessionID: 's1', messageID: 'm1' });
  expect(String(result)).toContain('model_selection_unsupported');
  expect(calls).toEqual([]);
});
