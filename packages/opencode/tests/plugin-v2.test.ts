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

test('v2 adapter keeps v1 defaults for pinMode and store args', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-memory-v2-defaults-'));
  const tools: Record<string, any> = {};
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
      async hook() {},
      async context() {
        return [];
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
      async *subscribe() {},
    },
  };

  const cleanup = await v2Setup(ctx);
  try {
    // v1 默认值：pinMode=summary；type/tags 也有默认，不应进 required。
    expect(tools.memory_pin.input.required).not.toContain('pinMode');
    expect(tools.memory_pin.input.properties.pinMode.default).toBe('summary');
    expect(tools.memory_store.input.required).not.toContain('type');
    expect(tools.memory_store.input.required).not.toContain('tags');

    const context = { sessionID: 's1' };
    const stored = await tools.memory_store.execute(
      {
        title: 'pin 默认值测试',
        content: '验证不传 pinMode 也能取消固定',
        type: 'fact',
        tags: [],
      },
      context,
    );
    const id = Number(stored.content[0].text.match(/id=(\d+)/)?.[1]);
    const pinned = await tools.memory_pin.execute(
      { id, pinned: true, pinMode: 'summary', summary: '测试摘要' },
      context,
    );
    expect(pinned.content[0].text).toContain('已固定');
    const unpinned = await tools.memory_pin.execute({ id, pinned: false }, context);
    expect(unpinned.content[0].text).toContain('已取消固定');
    const forgotten = await tools.memory_forget.execute({ id }, context);
    expect(forgotten.content[0].text).toContain('已删除');
  } finally {
    await cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
