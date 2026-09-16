import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin from '../src/plugin';

let hooks: any;
let dir: string;
const ctx = { sessionID: 'ses_recall' };

function idOf(result: string): number {
  return Number(result.match(/id=(\d+)/)?.[1]);
}

async function store(title: string, content: string): Promise<number> {
  return idOf(
    await hooks.tool.memory_store.execute({ title, content, type: 'fact', tags: [] }, ctx),
  );
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'opencode-recall-'));
  hooks = await plugin({ client: undefined }, { dbPath: join(dir, 'test.db'), autoUpdate: false });
});

afterEach(async () => {
  try {
    await hooks.dispose();
  } catch {}
  rmSync(dir, { recursive: true, force: true });
});

test('10.1 memory_recall 默认输出 Summary 与 Ref（不返回全文）', async () => {
  const id = await store('alpha title', 'alpha body');
  await hooks.tool.memory_pin.execute(
    { id, pinned: true, pinMode: 'summary', summary: 'alpha stored summary' },
    ctx,
  );
  const output = await hooks.tool.memory_recall.execute({ query: 'alpha' }, ctx);
  expect(output).toContain('alpha stored summary');
  expect(output).toContain(`memory://local/memories/${id}`);
  expect(output).toContain('<memory-context source="memory"');
  expect(output).not.toContain('alpha body');
});

test('10.2 memory_recall 无摘要时输出正文预览', async () => {
  const id = await store('beta title', 'beta preview body');
  const output = await hooks.tool.memory_recall.execute({ query: 'beta' }, ctx);
  expect(output).toContain('beta preview body');
  expect(output).toContain(`memory://local/memories/${id}`);
});

test('10.3 memory_recall 输出 Overflow（id/ref/title/trust/score）', async () => {
  await store('overflow one', 'tok one body');
  await store('overflow two', 'tok two body');
  await store('overflow three', 'tok three body');
  const output = await hooks.tool.memory_recall.execute({ query: 'tok', maxCharacters: 10 }, ctx);
  expect(output).toContain('预算外候选');
  expect(output).toContain('memory://local/memories/');
  expect(output).toContain('trust=high');
  expect(output).toContain('score=');
});

test('10.4 memory_recall 输出 Score 说明文案', async () => {
  await store('note one', 'note tok one');
  await store('note two', 'note tok two');
  const output = await hooks.tool.memory_recall.execute({ query: 'note', maxCharacters: 10 }, ctx);
  expect(output).toContain('不能跨查询比较');
});

test('10.5 memory_recall 输出截断与完全省略提示', async () => {
  const h = await plugin(
    { client: undefined },
    {
      dbPath: join(dir, 'truncated.db'),
      autoUpdate: false,
      recall: { maxOverflowItems: 1 },
    },
  );
  try {
    for (const n of [1, 2, 3])
      await h.tool.memory_store.execute(
        { title: `trunc ${n}`, content: `trunc tok ${n}`, type: 'fact', tags: [] },
        ctx,
      );
    const output = await h.tool.memory_recall.execute({ query: 'trunc', maxCharacters: 10 }, ctx);
    expect(output).toContain('已截断');
    expect(output).toContain('完全省略');
    expect(output).toContain('另有');
  } finally {
    await h.dispose();
  }
});

test('10.6 memory_read 保持全文行为', async () => {
  const content = `read-all ${'y'.repeat(400)}`;
  const id = await store('read title', content);
  const output = await hooks.tool.memory_read.execute({ id }, ctx);
  expect(output).toContain(content);
  expect(output).toContain('<memory-context source="memory"');
});

test('10.7 插件模块可被 legacy loader 加载且仅 default 导出', async () => {
  const mod = await import('../src/plugin');
  expect(Object.keys(mod)).toEqual(['default']);
  expect(typeof mod.default).toBe('function');
  const h = await (mod.default as typeof plugin)({ client: undefined } as any, {
    dbPath: join(dir, 'legacy.db'),
    autoUpdate: false,
  });
  expect(typeof h.tool.memory_recall.execute).toBe('function');
  await h.dispose();
});

test('P0-1 命中但全被预算省略时不报「无匹配」', async () => {
  const h = await plugin(
    { client: undefined },
    { dbPath: join(dir, 'omitted.db'), autoUpdate: false, recall: { maxOverflowItems: 0 } },
  );
  try {
    await h.tool.memory_store.execute(
      { title: 'omit one', content: 'omit tok one', type: 'fact', tags: [] },
      ctx,
    );
    const omitted = await h.tool.memory_recall.execute({ query: 'omit', maxCharacters: 1 }, ctx);
    expect(omitted).not.toBe('无匹配记忆。');
    expect(omitted).toContain('存在 1 条匹配记忆');

    const empty = await h.tool.memory_recall.execute({ query: 'zzz-no-match' }, ctx);
    expect(empty).toBe('无匹配记忆。');
  } finally {
    await h.dispose();
  }
});

test('recall 配置：文件配置生效且 Tuple Options 按字段覆盖', async () => {
  const xdg = join(dir, 'xdg-config');
  mkdirSync(join(xdg, 'opencode'), { recursive: true });
  writeFileSync(
    join(xdg, 'opencode', 'opencode-memory.jsonc'),
    JSON.stringify({
      dbPath: join(dir, 'file-config.db'),
      recall: { maxCharacters: 3000, maxOverflowItems: 1, maxOverflowCharacters: 1500 },
    }),
  );
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    const fromFile = await plugin({ client: undefined }, { autoUpdate: false });
    for (const n of [1, 2, 3])
      await fromFile.tool.memory_store.execute(
        { title: `cfg ${n}`, content: `cfg tok ${n}`, type: 'fact', tags: [] },
        ctx,
      );
    const fromFileOutput = await fromFile.tool.memory_recall.execute(
      { query: 'cfg', maxCharacters: 10 },
      ctx,
    );
    expect(fromFileOutput).toContain('完全省略');
    await fromFile.dispose();

    const overridden = await plugin(
      { client: undefined },
      { autoUpdate: false, recall: { maxOverflowItems: 3 } },
    );
    const overriddenOutput = await overridden.tool.memory_recall.execute(
      { query: 'cfg', maxCharacters: 10 },
      ctx,
    );
    expect(overriddenOutput).toContain('预算外候选');
    expect(overriddenOutput).not.toContain('完全省略');
    await overridden.dispose();
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
  }
});
