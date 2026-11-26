import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v1Plugin } from '../src/plugin-v1';

test('capture works without a configured agent (host default model)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-noagent-'));
  let promptCalls = 0;
  let switchedAgent: string | undefined;
  const client: any = {
    session: {
      async messages() {
        return {
          data: [
            {
              info: { id: 'u1', role: 'user' },
              parts: [{ type: 'text', text: 'atlas 仓库统一放 /srv/atlas，已确认' }],
            },
          ],
        };
      },
      async create() { return { data: { id: 'child' } }; },
      async prompt({ body }: any) {
        promptCalls += 1;
        switchedAgent = body?.agent;
        return {
          data: {
            parts: [{
              type: 'text',
              text: JSON.stringify({
                candidates: [{
                  title: 'atlas 仓库路径',
                  content: 'atlas 仓库统一放在 /srv/atlas，部署脚本从这里取构件。',
                  type: 'fact',
                  suggestedDomain: 'code',
                  evidenceQuote: 'atlas 仓库统一放 /srv/atlas',
                }],
              }),
            }],
          },
        };
      },
      async delete() { return { data: {} }; },
    },
    app: { async log() {} },
    tui: { async showToast() {} },
  };

  const hooks: any = await (v1Plugin as any)({ client }, {
    dbPath: join(dir, 'm.db'),
    capture: {
      enabled: true,
      onCompaction: true,
      trustRoleAsOrigin: true,
      maxCandidates: 3,
    },
  });

  expect(hooks.tool.memory_capture).toBeDefined();
  const result = await hooks.tool.memory_capture.execute({}, { sessionID: 's1', messageID: 'm1' });
  expect(String(result)).toContain('候选');
  expect(promptCalls).toBe(1);
  expect(switchedAgent).toBeUndefined();
});

const fakeClient = () => {
  const state = { switchedAgent: undefined as string | undefined, promptCalls: 0 };
  const client: any = {
    session: {
      async messages() {
        return {
          data: [
            { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'atlas 仓库统一放 /srv/atlas，已确认' }] },
          ],
        };
      },
      async create() { return { data: { id: 'child' } }; },
      async prompt({ body }: any) {
        state.promptCalls += 1;
        state.switchedAgent = body?.agent;
        return {
          data: {
            parts: [{
              type: 'text',
              text: JSON.stringify({
                candidates: [{
                  title: 'atlas 仓库路径',
                  content: 'atlas 仓库统一放在 /srv/atlas，部署脚本从这里取构件。',
                  type: 'fact',
                  suggestedDomain: 'code',
                  evidenceQuote: 'atlas 仓库统一放 /srv/atlas',
                }],
              }),
            }],
          },
        };
      },
      async delete() { return { data: {} }; },
    },
    app: { async log() {} },
    tui: { async showToast() {} },
  };
  return { client, state };
};

test('model target is rejected by the OpenCode adapter for now', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-target-'));
  const { client } = fakeClient();
  await expect(
    (v1Plugin as any)({ client }, {
      dbPath: join(dir, 'm.db'),
      capture: { enabled: true, target: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } },
    }),
  ).rejects.toThrow(/model target is not supported/);
});

test('agent target pins the extraction agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-target-'));
  const { client, state } = fakeClient();
  const hooks: any = await (v1Plugin as any)({ client }, {
    dbPath: join(dir, 'm.db'),
    capture: {
      enabled: true,
      target: { kind: 'agent', name: 'memory-capture' },
      trustRoleAsOrigin: true,
      maxCandidates: 2,
    },
  });
  await hooks.tool.memory_capture.execute({}, { sessionID: 's', messageID: 'm' });
  expect(state.switchedAgent).toBe('memory-capture');
});

test('target and legacy agent conflict is rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-target-'));
  const { client } = fakeClient();
  await expect(
    (v1Plugin as any)({ client }, {
      dbPath: join(dir, 'm.db'),
      capture: { enabled: true, agent: 'build', target: { kind: 'agent', name: 'memory-capture' } },
    }),
  ).rejects.toThrow(/conflicts/);
});
