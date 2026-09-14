import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryManager } from '../src/application/MemoryManager';
import { SqliteMemoryStore } from '../src/sqlite/SqliteMemoryStore';

let manager: MemoryManager;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-capture-'));
  manager = new MemoryManager({ store: new SqliteMemoryStore(join(dir, 'test.db')) });
});
afterEach(async () => {
  await manager.close();
  rmSync(dir, { recursive: true, force: true });
});

test('capture is idempotent and approval isolates candidates from recall', async () => {
  const started = await manager.beginCapture({
    contextKey: 'ctx',
    sourceId: 'msg-1',
    trigger: 'manual',
    extractorVersion: 'capture-v1',
  });
  expect(started.status).toBe('started');
  if (started.status !== 'started') return;
  expect(
    (
      await manager.beginCapture({
        contextKey: 'ctx',
        sourceId: 'msg-1',
        trigger: 'manual',
        extractorVersion: 'capture-v1',
      })
    ).status,
  ).toBe('in_progress');
  const completed = await manager.completeCapture({
    captureKey: started.captureKey,
    leaseToken: started.leaseToken,
    candidates: [
      { title: '约定', content: '统一使用 Bun', type: 'convention', suggestedDomain: 'code' },
    ],
  });
  expect(completed.candidateCount).toBe(1);
  const candidate = completed.candidates[0];
  expect((await manager.recallMemories({ query: 'Bun' })).memories).toHaveLength(0);
  const reviewed = await manager.reviewMemoryCandidate({ id: candidate.id, decision: 'approve' });
  expect(reviewed.status).toBe('approved');
  expect((await manager.recallMemories({ query: 'Bun' })).memories).toHaveLength(1);
  expect(
    (await manager.reviewMemoryCandidate({ id: candidate.id, decision: 'reject' })).status,
  ).toBe('already_reviewed');
});

test('capture filters credentials without persisting the candidate', async () => {
  const started = await manager.beginCapture({
    contextKey: 'ctx',
    sourceId: 'msg-2',
    trigger: 'manual',
    extractorVersion: 'capture-v1',
  });
  if (started.status !== 'started') throw new Error('capture did not start');
  const completed = await manager.completeCapture({
    captureKey: started.captureKey,
    leaseToken: started.leaseToken,
    candidates: [
      {
        title: 'secret',
        content: 'api_key=DO_NOT_STORE',
        type: 'fact',
        suggestedDomain: 'uncertain',
      },
    ],
  });
  expect(completed.candidateCount).toBe(0);
  expect(completed.filteredRiskCodes).toContain('credential_detected');
  expect(await manager.listMemoryCandidates()).toEqual([]);
});

test('captures every high-confidence credential and Unicode risk family', async () => {
  const risky = [
    '-----BEGIN PRIVATE KEY-----',
    'Authorization: Bearer abcdefghijklmnop',
    'Cookie: session=abcdef',
    'eyJheader.eyJpayload.signature',
    'AKIA1234567890ABCDEF',
    'bidi \u202e control',
    'zero\u200bwidth',
  ];
  for (const [index, content] of risky.entries()) {
    const started = await manager.beginCapture({
      contextKey: 'risk',
      sourceId: `risk-${index}`,
      trigger: 'manual',
      extractorVersion: 'capture-v1',
    });
    if (started.status !== 'started') throw new Error('capture did not start');
    const result = await manager.completeCapture({
      captureKey: started.captureKey,
      leaseToken: started.leaseToken,
      candidates: [{ title: `risk-${index}`, content, type: 'fact', suggestedDomain: 'uncertain' }],
    });
    expect(result.candidateCount).toBe(0);
    expect(result.filteredRiskCodes.length).toBeGreaterThan(0);
  }
  const safeVariants = [
    'PRIVATE KEY discussion',
    'Bearer placeholder',
    'Cookie policy',
    'eyJ is a token prefix',
    'AKIA is a documented prefix',
  ];
  for (const [index, content] of safeVariants.entries()) {
    const started = await manager.beginCapture({
      contextKey: 'safe',
      sourceId: `safe-${index}`,
      trigger: 'manual',
      extractorVersion: 'capture-v1',
    });
    if (started.status !== 'started') throw new Error('capture did not start');
    const result = await manager.completeCapture({
      captureKey: started.captureKey,
      leaseToken: started.leaseToken,
      candidates: [{ title: `safe-${index}`, content, type: 'fact', suggestedDomain: 'code' }],
    });
    expect(result.candidateCount).toBe(1);
  }
  const safe = await manager.beginCapture({
    contextKey: 'risk',
    sourceId: 'safe',
    trigger: 'manual',
    extractorVersion: 'capture-v1',
  });
  if (safe.status !== 'started') throw new Error('capture did not start');
  const safeResult = await manager.completeCapture({
    captureKey: safe.captureKey,
    leaseToken: safe.leaseToken,
    candidates: [
      {
        title: 'safe',
        content: 'normal engineering convention',
        type: 'fact',
        suggestedDomain: 'code',
      },
    ],
  });
  expect(safeResult.candidateCount).toBe(1);
});

test('supports lease expiry, rejection, duplicate approval, and scope isolation', async () => {
  const expired = await manager.beginCapture({
    contextKey: 'lease',
    sourceId: 'x',
    trigger: 'manual',
    extractorVersion: 'v',
    leaseMs: 1,
  });
  expect(expired.status).toBe('started');
  Bun.sleepSync(5);
  const retried = await manager.beginCapture({
    contextKey: 'lease',
    sourceId: 'x',
    trigger: 'manual',
    extractorVersion: 'v',
    leaseMs: 1000,
  });
  expect(retried.status).toBe('started');
  if (retried.status !== 'started') return;
  const completed = await manager.completeCapture({
    captureKey: retried.captureKey,
    leaseToken: retried.leaseToken,
    candidates: [{ title: '决策', content: '采用 Bun', type: 'decision', suggestedDomain: 'code' }],
  });
  const candidate = completed.candidates[0];
  expect(
    (await manager.reviewMemoryCandidate({ id: candidate.id, decision: 'reject' })).status,
  ).toBe('rejected');
  expect(
    (await manager.reviewMemoryCandidate({ id: candidate.id, decision: 'approve' })).status,
  ).toBe('already_reviewed');

  const project = await manager.beginCapture({
    contextKey: 'project',
    sourceId: 'scope',
    trigger: 'manual',
    extractorVersion: 'v',
    scope: { scope: 'project', scopeKey: '/p' },
  });
  if (project.status !== 'started') return;
  const projectResult = await manager.completeCapture({
    captureKey: project.captureKey,
    leaseToken: project.leaseToken,
    candidates: [{ title: '项目', content: '项目约定', type: 'fact', suggestedDomain: 'code' }],
  });
  const projectCandidate = projectResult.candidates[0];
  expect((await manager.readMemoryCandidate({ id: projectCandidate.id })).status).toBe('not_found');
  expect(
    (
      await manager.readMemoryCandidate({
        id: projectCandidate.id,
        scope: { scope: 'project', scopeKey: '/p' },
      })
    ).status,
  ).toBe('found');
});

test('re-scans candidate before approval', async () => {
  const started = await manager.beginCapture({
    contextKey: 'rescan',
    sourceId: 'x',
    trigger: 'manual',
    extractorVersion: 'v',
  });
  if (started.status !== 'started') throw new Error('capture did not start');
  const completed = await manager.completeCapture({
    captureKey: started.captureKey,
    leaseToken: started.leaseToken,
    candidates: [{ title: 'safe', content: 'normal', type: 'fact', suggestedDomain: 'code' }],
  });
  const candidate = completed.candidates[0];
  const rawStore = (manager as any).store;
  rawStore.db.run('UPDATE memory_candidates SET content=? WHERE id=?', [
    'Cookie: session=abcdef',
    candidate.id,
  ]);
  const result = await manager.reviewMemoryCandidate({ id: candidate.id, decision: 'approve' });
  expect(result.status).toBe('security_rejected');
});

test('filters credential risk found only in candidate tags', async () => {
  const started = await manager.beginCapture({
    contextKey: 'tags',
    sourceId: 'tag-risk',
    trigger: 'manual',
    extractorVersion: 'v',
  });
  if (started.status !== 'started') throw new Error('capture did not start');
  const result = await manager.completeCapture({
    captureKey: started.captureKey,
    leaseToken: started.leaseToken,
    candidates: [
      {
        title: 'safe',
        content: 'normal',
        tags: ['-----BEGIN PRIVATE KEY-----'],
        type: 'fact',
        suggestedDomain: 'code',
      },
    ],
  });
  expect(result.candidateCount).toBe(0);
  expect(result.filteredRiskCodes).toContain('credential_detected');
});

test('rejects a candidate when its tags become risky before approval', async () => {
  const started = await manager.beginCapture({
    contextKey: 'tags-approve',
    sourceId: 'tag-approve',
    trigger: 'manual',
    extractorVersion: 'v',
  });
  if (started.status !== 'started') throw new Error('capture did not start');
  const result = await manager.completeCapture({
    captureKey: started.captureKey,
    leaseToken: started.leaseToken,
    candidates: [
      { title: 'safe', content: 'normal', tags: ['normal'], type: 'fact', suggestedDomain: 'code' },
    ],
  });
  const store = (manager as any).store;
  store.db.run('UPDATE memory_candidates SET tags=? WHERE id=?', [
    JSON.stringify(['Bearer abcdefghijklmnop']),
    result.candidates[0].id,
  ]);
  const reviewed = await manager.reviewMemoryCandidate({
    id: result.candidates[0].id,
    decision: 'approve',
  });
  expect(reviewed.status).toBe('security_rejected');
});

test('approval rollback keeps candidate pending when FTS write fails', async () => {
  const started = await manager.beginCapture({
    contextKey: 'rollback',
    sourceId: 'x',
    trigger: 'manual',
    extractorVersion: 'v',
  });
  if (started.status !== 'started') throw new Error('capture did not start');
  const completed = await manager.completeCapture({
    captureKey: started.captureKey,
    leaseToken: started.leaseToken,
    candidates: [{ title: '回滚', content: '事务约定', type: 'fact', suggestedDomain: 'code' }],
  });
  const store = (manager as any).store;
  const original = store.syncFts;
  store.syncFts = () => {
    throw new Error('injected fts failure');
  };
  await expect(
    manager.reviewMemoryCandidate({ id: completed.candidates[0].id, decision: 'approve' }),
  ).rejects.toThrow('injected fts failure');
  store.syncFts = original;
  const reread = await manager.readMemoryCandidate({ id: completed.candidates[0].id });
  expect(reread.status).toBe('found');
  if (reread.status === 'found') expect(reread.candidate.status).toBe('pending');
  expect((await manager.recallMemories({ query: '事务约定' })).memories).toHaveLength(0);
});
