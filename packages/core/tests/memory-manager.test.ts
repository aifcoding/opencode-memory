import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryManager } from '../src/application/MemoryManager';
import { DuplicateMemoryError, MemoryValidationError } from '../src/errors';
import { SqliteMemoryStore } from '../src/sqlite/SqliteMemoryStore';

let manager: MemoryManager;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-manager-'));
  manager = new MemoryManager({
    store: new SqliteMemoryStore(join(dir, 'test.db')),
    pinQuota: 2000,
  });
});
afterEach(async () => {
  await manager.close();
  rmSync(dir, { recursive: true, force: true });
});

test('stores, recalls, reads and explains deletion', async () => {
  const entry = await manager.storeMemory({ title: '偏好', content: '用 bun', summary: 'bun' });
  expect(entry.scope).toBe('global');
  expect(entry.scopeKey).toBe('default');
  expect((await manager.recallMemories({ query: 'bun' })).memories[0]?.memory.id).toBe(entry.id);
  expect((await manager.readMemory({ id: entry.id })).status).toBe('found');
  expect((await manager.readMemory({ id: 999 })).status).toBe('not_found');
  expect((await manager.forgetMemory({ id: entry.id })).status).toBe('deleted');
  expect((await manager.readMemory({ id: entry.id })).status).toBe('deleted');
  expect((await manager.forgetMemory({ id: entry.id })).status).toBe('already_deleted');
});

test('pins, enforces summary and quota, and renders context', async () => {
  const e = await manager.storeMemory({ title: '无摘要', content: '内容' });
  expect((await manager.pinMemory({ id: e.id })).status).toBe('summary_required');
  expect((await manager.pinMemory({ id: e.id, pinMode: 'full' })).status).toBe('pinned');
  expect((await manager.getPinnedContext()).entries).toHaveLength(1);
  expect((await manager.unpinMemory({ id: e.id })).status).toBe('unpinned');
  const huge = await manager.storeMemory({
    title: '大',
    content: 'x'.repeat(3000),
    summary: 'x'.repeat(3000),
  });
  expect((await manager.pinMemory({ id: huge.id, pinMode: 'full' })).status).toBe('quota_exceeded');
});

test('archives summaries and manages context values', async () => {
  expect(
    (await manager.archiveSummary({ id: 'evt', contextKey: 's', text: '完成检索', createdAt: 1 }))
      .status,
  ).toBe('inserted');
  expect(
    (await manager.archiveSummary({ id: 'evt', contextKey: 's', text: '完成检索', createdAt: 1 }))
      .status,
  ).toBe('duplicate');
  expect((await manager.recallSummaries({ query: '检索' })).summaries).toHaveLength(1);
  await manager.setContextValue({ contextKey: 's', key: 'k', value: 'v' });
  expect(await manager.getContextValue({ contextKey: 's', key: 'k' })).toBe('v');
  expect(await manager.listContextValues({ contextKey: 's' })).toEqual({ k: 'v' });
  expect((await manager.deleteContextValue({ contextKey: 's', key: 'k' })).status).toBe('deleted');
  expect((await manager.deleteContextValue({ contextKey: 's', key: 'k' })).status).toBe(
    'not_found',
  );
});

test('validates required inputs', async () => {
  await expect(manager.storeMemory({ title: '', content: 'x' })).rejects.toBeInstanceOf(
    MemoryValidationError,
  );
  await expect(manager.recallMemories({ query: ' ' })).rejects.toBeInstanceOf(
    MemoryValidationError,
  );
  await expect(manager.listMemories({ limit: 0 })).rejects.toBeInstanceOf(MemoryValidationError);
  await expect(manager.getContextValue({ contextKey: '', key: 'k' })).rejects.toBeInstanceOf(
    MemoryValidationError,
  );
  await manager.storeMemory({ title: '重复', content: 'same' });
  await expect(manager.storeMemory({ title: '重复', content: 'same' })).rejects.toBeInstanceOf(
    DuplicateMemoryError,
  );
});

test('uses default scope for targeted operations and denies low-trust pins', async () => {
  const project = await manager.storeMemory({
    title: '项目',
    content: '项目内容',
    scope: { scope: 'project', scopeKey: '/project' },
  });
  expect((await manager.readMemory({ id: project.id })).status).toBe('not_found');
  expect(
    (
      await manager.readMemory({
        id: project.id,
        scope: { scope: 'project', scopeKey: '/project' },
      })
    ).status,
  ).toBe('found');
  expect((await manager.forgetMemory({ id: project.id })).status).toBe('not_found');
  expect((await manager.pinMemory({ id: project.id })).status).toBe('not_found');
  const low = await manager.storeMemory({ title: '低信任', content: '内容', trust: 'low' });
  expect((await manager.pinMemory({ id: low.id })).status).toBe('trust_denied');
});
