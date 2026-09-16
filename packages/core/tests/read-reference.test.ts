import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryManager } from '../src/application/MemoryManager';
import { candidateRef, memoryRef, summaryRef } from '../src/domain/ref';
import { SqliteMemoryStore } from '../src/sqlite/SqliteMemoryStore';
import { withoutCapabilities } from './support/recall-fixtures';

const SCOPE_A = { scope: 'project', scopeKey: '/project-a' } as const;
const SCOPE_B = { scope: 'project', scopeKey: '/project-b' } as const;

let manager: MemoryManager;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'read-reference-'));
  manager = new MemoryManager({ store: new SqliteMemoryStore(join(dir, 'test.db')) });
});

afterEach(async () => {
  await manager.close();
  rmSync(dir, { recursive: true, force: true });
});

test('9.24 Ref Scope 隔离', async () => {
  const entry = await manager.storeMemory({
    title: 'scope token',
    content: 'scope token body',
    scope: SCOPE_A,
  });
  const ref = memoryRef(entry.id);
  expect((await manager.readReference({ ref, scope: SCOPE_A })).status).toBe('found');
  expect((await manager.readReference({ ref, scope: SCOPE_B })).status).toBe('not_found');

  const begun = await manager.beginCapture({
    contextKey: 'ctx',
    sourceId: 'msg-1',
    trigger: 'manual',
    extractorVersion: 'v1',
    scope: SCOPE_A,
  });
  if (begun.status !== 'started') throw new Error('capture did not start');
  const completed = await manager.completeCapture({
    captureKey: begun.captureKey,
    leaseToken: begun.leaseToken,
    candidates: [
      { title: 'candidate', content: 'candidate body', type: 'fact', suggestedDomain: 'code' },
    ],
  });
  const candidateId = completed.candidates[0].id;
  expect(
    (await manager.readReference({ ref: candidateRef(candidateId), scope: SCOPE_A })).status,
  ).toBe('found');
  expect(
    (await manager.readReference({ ref: candidateRef(candidateId), scope: SCOPE_B })).status,
  ).toBe('not_found');
});

test('9.25 deleted/unsupported Ref', async () => {
  const entry = await manager.storeMemory({ title: 'gone', content: 'gone body' });
  await manager.forgetMemory({ id: entry.id });
  const deleted = await manager.readReference({ ref: memoryRef(entry.id) });
  expect(deleted.status).toBe('deleted');
  if (deleted.status === 'deleted') expect(deleted.reference.ref).toBe(memoryRef(entry.id));

  const notFound = await manager.readReference({ ref: memoryRef(999999) });
  expect(notFound.status).toBe('not_found');
  if (notFound.status === 'not_found')
    expect(notFound.reference).toEqual({
      kind: 'memory',
      ref: 'memory://local/memories/999999',
      id: 999999,
    });

  await manager.archiveSummary({
    id: 'sum-1',
    contextKey: 'ctx',
    text: 'summary text',
    createdAt: 1,
  });
  const summaryResult = await manager.readReference({ ref: summaryRef('sum-1') });
  expect(summaryResult.status).toBe('found');
  if (summaryResult.status === 'found')
    expect(summaryResult.value).toEqual({
      kind: 'summary',
      value: { id: 'sum-1', contextKey: 'ctx', text: 'summary text', createdAt: 1 },
    });

  const rawStore = new SqliteMemoryStore(join(dir, 'no-capability.db'));
  const limited = new MemoryManager({
    store: withoutCapabilities(rawStore, ['getSummary', 'readMemoryCandidate']),
  });
  const unsupportedSummary = await limited.readReference({ ref: summaryRef('sum-1') });
  expect(unsupportedSummary.status).toBe('unsupported');
  if (unsupportedSummary.status === 'unsupported')
    expect(unsupportedSummary.reference.kind).toBe('summary');
  const unsupportedCandidate = await limited.readReference({ ref: candidateRef(1) });
  expect(unsupportedCandidate.status).toBe('unsupported');
  if (unsupportedCandidate.status === 'unsupported')
    expect(unsupportedCandidate.reference).toEqual({
      kind: 'candidate',
      ref: 'memory://local/candidates/1',
      id: 1,
    });
  await limited.close();
});

test('P1-3 getSummary 未知 ID 返回 null，已知 ID 返回条目', () => {
  const store = new SqliteMemoryStore(join(dir, 'summary-lookup.db'));
  try {
    expect(store.getSummary('missing')).toBeNull();
    expect(
      store.archiveSummary({ id: 'known', contextKey: 'ctx', text: 'known text', createdAt: 1 }),
    ).toBe(true);
    expect(store.getSummary('known')).toEqual({
      id: 'known',
      contextKey: 'ctx',
      text: 'known text',
      createdAt: 1,
    });
  } finally {
    store.close();
  }
});

test('9.26 数据库重开后 Ref 稳定', async () => {
  const dbPath = join(dir, 'stable.db');
  const first = new MemoryManager({ store: new SqliteMemoryStore(dbPath) });
  const entry = await first.storeMemory({ title: 'stable token', content: 'stable token body' });
  const before = (await first.recallMemories({ query: 'stable' })).memories[0]?.memory.ref;
  await first.close();

  const second = new MemoryManager({ store: new SqliteMemoryStore(dbPath) });
  const after = (await second.recallMemories({ query: 'stable' })).memories[0]?.memory.ref;
  await second.close();

  expect(before).toBe(memoryRef(entry.id));
  expect(after).toBe(before);
});
