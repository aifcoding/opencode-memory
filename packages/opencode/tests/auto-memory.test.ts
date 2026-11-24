import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
import { lastUserText, resetAutoMemoryCache, runAutoMemory } from '../src/context/auto-memory';

let manager: ReturnType<typeof createSqliteMemoryManager>;
let dir: string;
const scope = { scope: 'project' as const, scopeKey: 'iam' };
const config = {
  capture: { enabled: true, mode: 'on' as const, maxWritesPerTurn: 3 },
  recall: { mode: 'hint' as const, maxItems: 3, maxCharacters: 300 },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auto-memory-orch-'));
  manager = createSqliteMemoryManager({ dbPath: join(dir, 'memory.db') });
  resetAutoMemoryCache();
});

afterEach(async () => {
  await manager.close();
  rmSync(dir, { recursive: true, force: true });
});

test('skips our own mem_block when finding the user message', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '<mem_block>pin</mem_block>' }] },
    { role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] },
  ];
  expect(lastUserText(messages)).toBe('记住 test db 10.0.0.5:3306');
});

test('injects hint block and captures once', async () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] }];
  const result = await runAutoMemory({
    manager,
    config,
    scope,
    sessionID: 'ses_a',
    messages,
  });
  expect(result.inject ?? '').toContain('auto-recall-hint');
  expect(result.captured).toBe(1);
});

test('does not capture the same message twice', async () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] }];
  await runAutoMemory({ manager, config, scope, sessionID: 'ses_a', messages });
  const second = await runAutoMemory({ manager, config, scope, sessionID: 'ses_a', messages });

  expect(second.captured).toBe(0);
  expect(await manager.listMemories({ scope })).toHaveLength(1);
});

test('skips capture sessions', async () => {
  const result = await runAutoMemory({
    manager,
    config,
    scope,
    sessionID: 'ses_capture',
    messages: [{ role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] }],
    skipSessionIDs: new Set(['ses_capture']),
  });

  expect(result.captured).toBe(0);
  expect(await manager.listMemories({ scope })).toHaveLength(0);
});

test('does not recall the memory written in the same pass', async () => {
  const autoConfig = {
    ...config,
    recall: { ...config.recall, mode: 'auto' as const },
  };
  const result = await runAutoMemory({
    manager,
    config: autoConfig,
    scope,
    sessionID: 'ses_self',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '记住 probe-self 地址 http://127.0.0.1:18099' }] },
    ],
  });

  expect(result.captured).toBe(1);
  expect(result.inject).toBeUndefined();
});

test('auto mode injects recalled memory on reference request', async () => {
  await runAutoMemory({
    manager,
    config,
    scope,
    sessionID: 'ses_a',
    messages: [{ role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] }],
  });

  const autoConfig = {
    ...config,
    recall: { ...config.recall, mode: 'auto' as const },
  };
  const result = await runAutoMemory({
    manager,
    config: autoConfig,
    scope,
    sessionID: 'ses_b',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '上次那个 test db 是什么' }] },
    ],
  });

  expect(result.inject ?? '').toContain('source="auto-recall"');
  expect(result.recalled).toBeGreaterThan(0);
});

test('skips subagent sessions entirely', async () => {
  const result = await runAutoMemory({
    manager,
    config,
    scope,
    sessionID: 'ses_sub',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'You are a subagent spawned by another session.\n\n记住 probe-sub 地址 http://127.0.0.1:18093',
          },
        ],
      },
    ],
  });

  expect(result.captured).toBe(0);
  expect(result.inject).toBeUndefined();
  expect(await manager.listMemories({ scope })).toHaveLength(0);
});

test('hint mode ignores maxCharacters', async () => {
  const hintConfig = {
    capture: { ...config.capture, enabled: false },
    recall: { mode: 'hint' as const, maxItems: 3, maxCharacters: 50 },
  };
  const result = await runAutoMemory({
    manager,
    config: hintConfig,
    scope,
    sessionID: 'ses_hint',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });

  expect(result.inject ?? '').toContain('auto-recall-hint');
  expect((result.inject ?? '').length).toBeGreaterThan(50);
});

type TestManager = ReturnType<typeof createSqliteMemoryManager>;

/** 只替换指定方法，其余调用仍走真实 SQLite manager。 */
function withOverrides(overrides: Record<string, (...args: any[]) => any>): TestManager {
  return new Proxy(manager, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as TestManager;
}

test('same-turn update is not echoed but other related memories still recall', async () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] },
  ];
  const captureOnly = {
    ...config,
    recall: { ...config.recall, mode: 'off' as const },
  };
  const preset = await runAutoMemory({
    manager,
    config: captureOnly,
    scope,
    sessionID: 'ses_preset',
    messages,
  });
  expect(preset.captured).toBe(1);

  const [updated] = await manager.listMemories({ scope });
  const other = await manager.storeMemory({
    title: 'test db 备用连接',
    content: 'test db 备用连接 10.0.0.9:3306',
    summary: 'test db 备用连接 10.0.0.9:3306',
    scope,
    origin: 'user',
    trust: 'high',
  });

  // 与预置轮不同、但结构化值/实体名相同 → 生成同一 title，走 CAS 更新而非 unchanged 跳过。
  const updateMessages = [
    {
      role: 'user',
      content: [{ type: 'text', text: '记住 test db 还在 10.0.0.5:3306，已确认' }],
    },
  ];
  const autoConfig = { ...config, recall: { ...config.recall, mode: 'auto' as const } };
  const result = await runAutoMemory({
    manager,
    config: autoConfig,
    scope,
    sessionID: 'ses_update',
    messages: updateMessages,
  });

  expect(result.captured).toBe(1);
  expect(result.recalled).toBe(1);
  const inject = result.inject ?? '';
  expect(inject).toContain(`[id=${other.id} |`);
  expect(inject).not.toContain(`[id=${updated!.id} |`);
  expect(await manager.listMemories({ scope })).toHaveLength(2);
});

test('capture failure does not block recall', async () => {
  await manager.storeMemory({
    title: 'test db 10.0.0.5:3306',
    content: 'test db 10.0.0.5:3306',
    summary: 'test db 10.0.0.5:3306',
    scope,
    origin: 'user',
    trust: 'high',
  });
  const failingCapture = withOverrides({
    getContextValue: async () => {
      throw new Error('capture exploded');
    },
  });
  const autoConfig = { ...config, recall: { ...config.recall, mode: 'auto' as const } };

  const result = await runAutoMemory({
    manager: failingCapture,
    config: autoConfig,
    scope,
    sessionID: 'ses_capture_fail',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] },
    ],
  });

  expect(result.captured).toBe(0);
  expect(result.recalled).toBe(1);
  expect(result.inject ?? '').toContain('source="auto-recall"');
});

test('recall failure does not undo capture', async () => {
  const failingRecall = withOverrides({
    recallMemories: async () => {
      throw new Error('recall exploded');
    },
  });
  const autoConfig = { ...config, recall: { ...config.recall, mode: 'auto' as const } };

  const result = await runAutoMemory({
    manager: failingRecall,
    config: autoConfig,
    scope,
    sessionID: 'ses_recall_fail',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] },
    ],
  });

  expect(result.captured).toBe(1);
  expect(result.inject).toBeUndefined();
  expect(await manager.listMemories({ scope })).toHaveLength(1);
});

test('caches recall per session, text, and tool output', async () => {
  let recallCalls = 0;
  const counted = withOverrides({
    recallMemories: (...args: Parameters<TestManager['recallMemories']>) => {
      recallCalls += 1;
      return manager.recallMemories(...args);
    },
  });
  const recallOnly = {
    capture: { ...config.capture, enabled: false },
    recall: { ...config.recall, mode: 'auto' as const },
  };
  const messages = [{ role: 'user', content: [{ type: 'text', text: '上次那个 test db 是什么' }] }];
  const run = (sessionID: string, input = messages) =>
    runAutoMemory({ manager: counted, config: recallOnly, scope, sessionID, messages: input });

  const first = await run('ses_cache');
  expect(recallCalls).toBe(2); // project + global 两个 scope 各查一次
  const second = await run('ses_cache');
  expect(recallCalls).toBe(2);
  expect(second.recalled).toBe(first.recalled);

  await run('ses_cache', [
    ...messages,
    { role: 'tool', content: [{ type: 'text', text: 'tool result A' }] },
  ]);
  expect(recallCalls).toBe(4);

  await run('ses_cache', [
    ...messages,
    { role: 'tool', content: [{ type: 'text', text: 'tool result B' }] },
  ]);
  expect(recallCalls).toBe(6);

  await run('ses_cache_other');
  expect(recallCalls).toBe(8);
});

test('excludeIds removes only the excluded memory', async () => {
  const keep = await manager.storeMemory({
    title: 'test db 主库',
    content: 'test db 主库 10.0.0.5:3306',
    summary: 'test db 主库',
    scope,
    origin: 'user',
    trust: 'high',
  });
  const drop = await manager.storeMemory({
    title: 'test db 备用库',
    content: 'test db 备用库 10.0.0.6:3306',
    summary: 'test db 备用库',
    scope,
    origin: 'user',
    trust: 'high',
  });
  const recallOnly = {
    capture: { ...config.capture, enabled: false },
    recall: { ...config.recall, mode: 'auto' as const },
  };

  const result = await runAutoMemory({
    manager,
    config: recallOnly,
    scope,
    sessionID: 'ses_exclude',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'test db 用哪个' }] }],
    excludeIds: [drop.id],
  });

  const inject = result.inject ?? '';
  expect(result.recalled).toBe(1);
  expect(inject).toContain(`[id=${keep.id} |`);
  expect(inject).not.toContain(`[id=${drop.id} |`);
});

test('dedupes the same id returned by multiple scopes', async () => {
  const entry = await manager.storeMemory({
    title: 'test db 主库',
    content: 'test db 主库 10.0.0.5:3306',
    summary: 'test db 主库 10.0.0.5:3306',
    scope,
    origin: 'user',
    trust: 'high',
  });
  const projected = {
    ...entry,
    ref: `memory://local/memories/${entry.id}` as const,
    projection: 'summary' as const,
    summary: entry.summary,
    summarySource: 'stored' as const,
  };
  const duplicated = withOverrides({
    recallMemories: async () => ({
      memories: [{ memory: projected, score: 1, characterCount: 10 }],
      overflow: [],
      requestedProjection: 'summary' as const,
      consideredCount: 1,
      usedCharacters: 10,
      overflowUsedCharacters: 0,
      truncated: false,
      degradedCount: 0,
      omittedCount: 0,
    }),
  });
  const recallOnly = {
    capture: { ...config.capture, enabled: false },
    recall: { ...config.recall, mode: 'auto' as const },
  };

  const result = await runAutoMemory({
    manager: duplicated,
    config: recallOnly,
    scope,
    sessionID: 'ses_dedupe',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'test db 用哪个' }] }],
  });

  const inject = result.inject ?? '';
  expect(result.recalled).toBe(1);
  expect(inject.split(`[id=${entry.id} |`).length - 1).toBe(1);
});

test('empty, blank, or synthetic-only input is ignored', async () => {
  const autoConfig = { ...config, recall: { ...config.recall, mode: 'auto' as const } };
  const cases: Array<Array<{ role?: string; content?: unknown }>> = [
    [],
    [{ role: 'user', content: [{ type: 'text', text: '   \n\t  ' }] }],
    [
      {
        role: 'user',
        content: [{ type: 'text', text: '<mem_block role="reference">x</mem_block>' }],
      },
    ],
  ];

  for (const messages of cases) {
    expect(lastUserText(messages)).toBeUndefined();
    const result = await runAutoMemory({
      manager,
      config: autoConfig,
      scope,
      sessionID: 'ses_empty',
      messages,
    });
    expect(result.captured).toBe(0);
    expect(result.inject).toBeUndefined();
  }
  expect(await manager.listMemories({ scope })).toHaveLength(0);
});

test('hint mode neither stores nor queries memory', async () => {
  let recallCalls = 0;
  let listCalls = 0;
  const counted = withOverrides({
    recallMemories: (...args: Parameters<TestManager['recallMemories']>) => {
      recallCalls += 1;
      return manager.recallMemories(...args);
    },
    listMemories: (...args: Parameters<TestManager['listMemories']>) => {
      listCalls += 1;
      return manager.listMemories(...args);
    },
  });
  const hintConfig = {
    capture: { ...config.capture, enabled: false },
    recall: { mode: 'hint' as const, maxItems: 3, maxCharacters: 300 },
  };

  const result = await runAutoMemory({
    manager: counted,
    config: hintConfig,
    scope,
    sessionID: 'ses_hint_only',
    messages: [
      { role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] },
    ],
  });

  expect(result.captured).toBe(0);
  expect(result.inject ?? '').toContain('auto-recall-hint');
  expect(recallCalls).toBe(0);
  expect(listCalls).toBe(0);
  expect(await manager.listMemories({ scope })).toHaveLength(0);
});

test('capture and recall switches are independent', async () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '记住 test db 10.0.0.5:3306' }] },
  ];
  const bothOff = {
    capture: { ...config.capture, enabled: false },
    recall: { ...config.recall, mode: 'off' as const },
  };

  const off = await runAutoMemory({
    manager,
    config: bothOff,
    scope,
    sessionID: 'ses_all_off',
    messages,
  });
  expect(off.captured).toBe(0);
  expect(off.inject).toBeUndefined();
  expect(await manager.listMemories({ scope })).toHaveLength(0);

  const captureOnly = {
    capture: { ...config.capture, enabled: true },
    recall: { ...config.recall, mode: 'off' as const },
  };
  const captured = await runAutoMemory({
    manager,
    config: captureOnly,
    scope,
    sessionID: 'ses_capture_off',
    messages,
  });
  expect(captured.captured).toBe(1);
  expect(captured.inject).toBeUndefined();
  expect(await manager.listMemories({ scope })).toHaveLength(1);
});
