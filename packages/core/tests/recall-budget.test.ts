import { expect, test } from 'bun:test';
import { MemoryManager } from '../src/application/MemoryManager';
import { overflowText, type RecallBudgetInput } from '../src/domain/recall';
import { DEFAULT_RECALL_BUDGET } from '../src/domain/recall';
import { MemoryValidationError } from '../src/errors';
import { FakeStore, fixtureEntries, fixtureHits, makeMemory } from './support/recall-fixtures';

function managerWith(
  entries = fixtureEntries(4),
  hits = fixtureHits(entries.length),
): MemoryManager {
  return new MemoryManager({ store: new FakeStore(entries, hits) });
}

test('9.8 Detail 精确预算边界', async () => {
  // fixture detailText = "T1\nx" (4 characters)
  const manager = managerWith(fixtureEntries(1));
  const exact = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 4 } });
  expect(exact.memories).toHaveLength(1);
  expect(exact.usedCharacters).toBe(4);
  expect(exact.truncated).toBe(false);

  const over = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 3 } });
  expect(over.memories).toHaveLength(0);
  expect(over.truncated).toBe(true);
  expect(over.overflow).toHaveLength(1);
});

test('9.9 首条放不下进入 Overflow', async () => {
  const manager = managerWith();
  const result = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 1 } });
  expect(result.memories).toHaveLength(0);
  expect(result.truncated).toBe(true);
  expect(result.usedCharacters).toBe(0);
  expect(result.overflow.map((item) => item.id)).toEqual([1, 2, 3, 4]);
});

test('9.10 多条 Detail 分隔符计数', async () => {
  // 3 items * 4 chars + 2 separators * 2 chars = 16
  const manager = managerWith(fixtureEntries(3));
  const exact = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 16 } });
  expect(exact.memories).toHaveLength(3);
  expect(exact.usedCharacters).toBe(16);
  expect(exact.truncated).toBe(false);

  const short = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 15 } });
  expect(short.memories).toHaveLength(2);
  expect(short.usedCharacters).toBe(10);
  expect(short.overflow).toHaveLength(1);
});

test('9.11 full→summary 降级', async () => {
  const manager = managerWith([
    makeMemory({ id: 1, title: 'T1', summary: 'x', content: 'CCCCCC' }),
  ]);
  const result = await manager.recallMemories({
    query: 'q',
    projection: 'full',
    budget: { maxCharacters: 4 },
  });
  expect(result.requestedProjection).toBe('full');
  expect(result.memories).toHaveLength(1);
  expect(result.memories[0].memory.projection).toBe('summary');
  expect(result.memories[0].characterCount).toBe(4);
  expect(result.usedCharacters).toBe(4);
  expect(result.degradedCount).toBe(1);
  expect(result.truncated).toBe(false);
  expect(result.overflow).toHaveLength(0);
});

test('9.12 preferSummary=false 不降级', async () => {
  const manager = managerWith([
    makeMemory({ id: 1, title: 'T1', summary: 'x', content: 'CCCCCC' }),
  ]);
  const result = await manager.recallMemories({
    query: 'q',
    projection: 'full',
    budget: { maxCharacters: 4, preferSummary: false },
  });
  expect(result.memories).toHaveLength(0);
  expect(result.degradedCount).toBe(0);
  expect(result.truncated).toBe(true);
  expect(result.overflow).toHaveLength(1);
});

test('9.13 limit 不触发 truncated', async () => {
  const manager = managerWith();
  const result = await manager.recallMemories({ query: 'q', limit: 1 });
  expect(result.memories).toHaveLength(1);
  expect(result.consideredCount).toBe(1);
  expect(result.truncated).toBe(false);
  expect(result.omittedCount).toBe(0);
});

test('9.14 空结果元数据', async () => {
  const manager = managerWith([], []);
  const result = await manager.recallMemories({ query: 'q' });
  expect(result).toEqual({
    memories: [],
    overflow: [],
    requestedProjection: 'summary',
    consideredCount: 0,
    usedCharacters: 0,
    overflowUsedCharacters: 0,
    truncated: false,
    degradedCount: 0,
    omittedCount: 0,
  });
});

test('9.15 Overflow 条数边界', async () => {
  const manager = managerWith();
  const result = await manager.recallMemories({
    query: 'q',
    budget: { maxCharacters: 1, maxOverflowItems: 2 },
  });
  expect(result.memories).toHaveLength(0);
  expect(result.overflow).toHaveLength(2);
  expect(result.consideredCount).toBe(4);
  expect(result.omittedCount).toBe(2);
  expect(result.truncated).toBe(true);
});

test('9.16 Overflow 字符边界', async () => {
  const manager = managerWith();
  const base = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 1 } });
  const firstLength = overflowText(base.overflow[0]).length;

  const exact = await manager.recallMemories({
    query: 'q',
    budget: { maxCharacters: 1, maxOverflowCharacters: firstLength },
  });
  expect(exact.overflow).toHaveLength(1);
  expect(exact.overflowUsedCharacters).toBe(firstLength);

  const over = await manager.recallMemories({
    query: 'q',
    budget: { maxCharacters: 1, maxOverflowCharacters: firstLength - 1 },
  });
  expect(over.overflow).toHaveLength(0);
  expect(over.overflowUsedCharacters).toBe(0);
});

test('9.17 Overflow 关闭', async () => {
  const manager = managerWith();
  const noItems = await manager.recallMemories({
    query: 'q',
    budget: { maxCharacters: 1, maxOverflowItems: 0 },
  });
  expect(noItems.overflow).toHaveLength(0);
  expect(noItems.omittedCount).toBe(4);

  const noCharacters = await manager.recallMemories({
    query: 'q',
    budget: { maxCharacters: 1, maxOverflowCharacters: 0 },
  });
  expect(noCharacters.overflow).toHaveLength(0);
  expect(noCharacters.omittedCount).toBe(4);
  expect(noCharacters.overflowUsedCharacters).toBe(0);
});

test('9.18 Overflow Score 顺序与说明', async () => {
  const manager = managerWith();
  const result = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 1 } });
  expect(result.overflow).toEqual([
    {
      projection: 'title',
      id: 1,
      ref: 'memory://local/memories/1',
      title: 'T1',
      trust: 'high',
      score: 4,
    },
    {
      projection: 'title',
      id: 2,
      ref: 'memory://local/memories/2',
      title: 'T2',
      trust: 'high',
      score: 3,
    },
    {
      projection: 'title',
      id: 3,
      ref: 'memory://local/memories/3',
      title: 'T3',
      trust: 'high',
      score: 2,
    },
    {
      projection: 'title',
      id: 4,
      ref: 'memory://local/memories/4',
      title: 'T4',
      trust: 'high',
      score: 1,
    },
  ]);
  const scores = result.overflow.map((item) => item.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
});

test('9.19 omittedCount 与计数恒等关系', async () => {
  const manager = managerWith();
  const result = await manager.recallMemories({
    query: 'q',
    budget: { maxCharacters: 4, maxOverflowItems: 2 },
  });
  expect(result.memories).toHaveLength(1);
  expect(result.overflow).toHaveLength(2);
  expect(result.omittedCount).toBe(1);
  expect(result.consideredCount).toBe(
    result.memories.length + result.overflow.length + result.omittedCount,
  );

  const allEmpty = await managerWith([], []).recallMemories({ query: 'q' });
  expect(allEmpty.consideredCount).toBe(
    allEmpty.memories.length + allEmpty.overflow.length + allEmpty.omittedCount,
  );
});

test('9.20 非法预算拒绝', async () => {
  const manager = managerWith(fixtureEntries(1), fixtureHits(1));
  const invalid: RecallBudgetInput[] = [
    { maxCharacters: 0 },
    { maxCharacters: 20001 },
    { maxCharacters: 1.5 },
    { maxOverflowItems: -1 },
    { maxOverflowItems: 21 },
    { maxOverflowItems: 0.5 },
    { maxOverflowCharacters: -1 },
    { maxOverflowCharacters: 10001 },
    { preferSummary: 'yes' as unknown as boolean },
  ];
  for (const budget of invalid)
    await expect(manager.recallMemories({ query: 'q', budget })).rejects.toBeInstanceOf(
      MemoryValidationError,
    );

  await expect(
    manager.recallMemories({ query: 'q', budget: { maxCharacters: 1, maxOverflowItems: 0 } }),
  ).resolves.toBeDefined();
  await expect(
    manager.recallMemories({ query: 'q', budget: { maxCharacters: 20000 } }),
  ).resolves.toBeDefined();
});

test('P1-3 预算按 UTF-16 code unit 计算（emoji）', async () => {
  const emoji = '😀';
  expect(emoji.length).toBe(2);
  const manager = managerWith([makeMemory({ id: 1, title: emoji, summary: 'x', content: 'C1' })]);
  // detailText = "😀\nx" => 2 + 1 + 1 = 4 UTF-16 code units
  const exact = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 4 } });
  expect(exact.memories).toHaveLength(1);
  expect(exact.usedCharacters).toBe(4);

  const over = await manager.recallMemories({ query: 'q', budget: { maxCharacters: 3 } });
  expect(over.memories).toHaveLength(0);
  expect(over.truncated).toBe(true);
});

test('P1-1 DEFAULT_RECALL_BUDGET 不可被修改（Object.freeze）', () => {
  expect(Object.isFrozen(DEFAULT_RECALL_BUDGET)).toBe(true);
  expect(() => {
    (DEFAULT_RECALL_BUDGET as { maxCharacters: number }).maxCharacters = 1;
  }).toThrow();
  expect(DEFAULT_RECALL_BUDGET.maxCharacters).toBe(3000);
});
