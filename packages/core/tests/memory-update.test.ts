import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteMemoryManager } from '../src/sqlite/index';

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-update-'));
  return createSqliteMemoryManager({ dbPath: join(dir, 'm.db') });
};
const scope = { scope: 'global' as const, scopeKey: 'default' };

test('updates content in place and bumps revision', async () => {
  const manager = fresh();
  const memory = await manager.storeMemory({
    title: 'atlas 仓库路径',
    content: '原路径 /srv/a',
    summary: '原摘要',
    scope,
    origin: 'user',
    trust: 'high',
  });
  const result = await manager.updateMemory({ id: memory.id, content: '新路径 /srv/b', scope });
  expect(result.status).toBe('updated');
  expect(result.memory?.id).toBe(memory.id);
  expect(result.memory?.content).toBe('新路径 /srv/b');
  expect(result.memory?.revision).toBe(memory.revision + 1);
  expect(result.memory?.origin).toBe('user');
  expect(result.memory?.trust).toBe('high');
  manager.close();
});

test('metadata-only update keeps revision and content', async () => {
  const manager = fresh();
  const memory = await manager.storeMemory({
    title: '配置项',
    content: 'API_PORT=8080',
    summary: '旧摘要',
    scope,
  });
  const result = await manager.updateMemory({ id: memory.id, summary: '新摘要', scope });
  expect(result.status).toBe('updated');
  expect(result.memory?.summary).toBe('新摘要');
  expect(result.memory?.content).toBe('API_PORT=8080');
  expect(result.memory?.revision).toBe(memory.revision);
  manager.close();
});

test('updating a pinned memory keeps the pin', async () => {
  const manager = fresh();
  const memory = await manager.storeMemory({
    title: '固定条目',
    content: 'v1',
    scope,
    origin: 'user',
    trust: 'high',
  });
  await manager.pinMemory({ id: memory.id, pinMode: 'summary', summary: '固定摘要' });
  const result = await manager.updateMemory({ id: memory.id, content: 'v2', scope });
  expect(result.status).toBe('updated');
  expect(result.memory?.pinnedAt).not.toBeNull();
  expect(result.memory?.pinMode).toBe('summary');
  manager.close();
});

test('stale expectedRevision conflicts without writing', async () => {
  const manager = fresh();
  const memory = await manager.storeMemory({ title: '并发条目', content: 'v1', scope });
  const result = await manager.updateMemory({
    id: memory.id,
    content: 'v2',
    expectedRevision: memory.revision + 5,
    scope,
  });
  expect(result.status).toBe('conflict');
  expect(result.memory?.content).toBe('v1');
  manager.close();
});

test('unknown id returns not_found', async () => {
  const manager = fresh();
  const result = await manager.updateMemory({ id: 9999, content: 'x', scope });
  expect(result.status).toBe('not_found');
  manager.close();
});

test('title-only update bumps revision and respects expectedRevision', async () => {
  const manager = fresh();
  const memory = await manager.storeMemory({ title: '旧标题', content: 'body', scope });
  const renamed = await manager.updateMemory({
    id: memory.id,
    title: '新标题',
    expectedRevision: memory.revision,
    scope,
  });
  expect(renamed.status).toBe('updated');
  expect(renamed.memory?.title).toBe('新标题');
  expect(renamed.memory?.revision).toBe(memory.revision + 1);

  const stale = await manager.updateMemory({
    id: memory.id,
    title: '过期标题',
    expectedRevision: memory.revision,
    scope,
  });
  expect(stale.status).toBe('conflict');
  expect(stale.memory?.title).toBe('新标题');
  manager.close();
});
