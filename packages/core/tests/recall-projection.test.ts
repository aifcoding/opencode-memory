import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryManager } from '../src/application/MemoryManager';
import { SqliteMemoryStore } from '../src/sqlite/SqliteMemoryStore';

let manager: MemoryManager;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'recall-projection-'));
  manager = new MemoryManager({ store: new SqliteMemoryStore(join(dir, 'test.db')) });
});

afterEach(async () => {
  await manager.close();
  rmSync(dir, { recursive: true, force: true });
});

test('9.1 默认 projection=summary', async () => {
  await manager.storeMemory({ title: 'alpha', content: 'alpha body', summary: 'alpha summary' });
  const result = await manager.recallMemories({ query: 'alpha' });
  expect(result.requestedProjection).toBe('summary');
  expect(result.memories).toHaveLength(1);
  const memory = result.memories[0].memory;
  expect(memory.projection).toBe('summary');
  expect(memory).not.toHaveProperty('content');
  if (memory.projection !== 'summary') throw new Error('expected summary projection');
  expect(memory.summary).toBe('alpha summary');
});

test('9.2 title 不包含 summary/content', async () => {
  await manager.storeMemory({ title: 'alpha', content: 'alpha body', summary: 'alpha summary' });
  const result = await manager.recallMemories({ query: 'alpha', projection: 'title' });
  expect(result.requestedProjection).toBe('title');
  const memory = result.memories[0].memory;
  expect(memory.projection).toBe('title');
  expect(memory).not.toHaveProperty('summary');
  expect(memory).not.toHaveProperty('content');
  expect(memory.title).toBe('alpha');
});

test('9.3 summary 使用已存摘要', async () => {
  await manager.storeMemory({ title: 'alpha', content: 'alpha body', summary: 'alpha summary' });
  const result = await manager.recallMemories({ query: 'alpha' });
  const memory = result.memories[0].memory;
  if (memory.projection !== 'summary') throw new Error('expected summary projection');
  expect(memory.summary).toBe('alpha summary');
  expect(memory.summarySource).toBe('stored');
});

test('9.4 空 summary 回退 200 字符', async () => {
  const content = `beta ${'b'.repeat(300)}`;
  await manager.storeMemory({ title: 'beta', content });
  const result = await manager.recallMemories({ query: 'beta' });
  const memory = result.memories[0].memory;
  if (memory.projection !== 'summary') throw new Error('expected summary projection');
  expect(memory.summarySource).toBe('content_preview');
  expect(memory.summary).toBe(content.slice(0, 200));
  expect(memory.summary).toHaveLength(200);
});

test('9.5 full 返回完整正文', async () => {
  await manager.storeMemory({ title: 'alpha', content: 'alpha body', summary: 'alpha summary' });
  const result = await manager.recallMemories({ query: 'alpha', projection: 'full' });
  expect(result.requestedProjection).toBe('full');
  const memory = result.memories[0].memory;
  if (memory.projection !== 'full') throw new Error('expected full projection');
  expect(memory.content).toBe('alpha body');
  expect(memory.summary).toBe('alpha summary');
  expect(memory.projection).toBe('full');
});

test('9.6 回退不修改数据库', async () => {
  const content = `gamma ${'x'.repeat(300)}`;
  const entry = await manager.storeMemory({ title: 'gamma', content });
  const before = await manager.readMemory({ id: entry.id });
  const result = await manager.recallMemories({ query: 'gamma' });
  const memory = result.memories[0].memory;
  if (memory.projection !== 'summary') throw new Error('expected summary projection');
  expect(memory.summarySource).toBe('content_preview');
  const after = await manager.readMemory({ id: entry.id });
  if (before.status !== 'found' || after.status !== 'found') throw new Error('expected found');
  expect(after.memory.summary).toBe('');
  expect(after.memory.summary).toBe(before.memory.summary);
  expect(after.memory.revision).toBe(before.memory.revision);
  expect(after.memory.content).toBe(before.memory.content);
});

test('9.7 Detail DTO 无内部字段', async () => {
  await manager.storeMemory({ title: 'alpha', content: 'alpha body', summary: 'alpha summary' });
  const result = await manager.recallMemories({ query: 'alpha' });
  const memory = result.memories[0].memory as unknown as Record<string, unknown>;
  for (const key of [
    'embedding',
    'embedModel',
    'embedDim',
    'contentHash',
    'revision',
    'deletedAt',
    'pinnedAt',
    'pinMode',
  ])
    expect(memory).not.toHaveProperty(key);
  expect(memory).toHaveProperty('id');
  expect(memory).toHaveProperty('ref');
  expect(memory).toHaveProperty('scope');
});
