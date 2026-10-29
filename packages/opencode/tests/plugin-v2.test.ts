import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v2Setup } from '../src/plugin-v2';

test('v2 adapter bridges session.compaction.ended to v1 archive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-memory-v2-'));
  const messages = new Map<string, any[]>([
    [
      's1',
      [
        {
          id: 'msg_compaction',
          role: 'assistant',
          agent: 'compaction',
          content: [{ type: 'text', text: 'summary text for archive' }],
        },
      ],
    ],
  ]);
  const tools: Record<string, any> = {};
  let contextHook: ((event: any) => Promise<void> | void) | undefined;

  const ctx: any = {
    options: { dbPath: join(dir, 'test.db'), autoUpdate: false },
    tool: {
      async transform(fn: (editor: any) => void) {
        fn({
          add(tool: any) {
            tools[tool.name] = tool;
          },
        });
      },
    },
    session: {
      async hook(name: string, fn: (event: any) => Promise<void> | void) {
        if (name === 'context') contextHook = fn;
      },
      async context({ sessionID }: { sessionID: string }) {
        return messages.get(sessionID) ?? [];
      },
      async create() {
        return { id: 'child' };
      },
      async switchAgent() {},
      async generate() {
        return { text: '[]' };
      },
      async remove() {},
    },
    event: {
      async *subscribe() {
        yield { type: 'session.compaction.ended', properties: { sessionID: 's1' } };
      },
    },
  };

  const cleanup = await v2Setup(ctx);
  await new Promise((resolve) => setTimeout(resolve, 50));

  // 确认工具已注册，且 v2 的消息转换没有破坏 context hook。
  expect(tools.memory_recall).toBeDefined();
  expect(contextHook).toBeDefined();
  await contextHook?.({
    sessionID: 's1',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });

  const result = await tools.recall_summaries.execute({ query: 'summary' }, { sessionID: 's1' });
  expect(result.content[0].text).toContain('summary text for archive');

  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});
