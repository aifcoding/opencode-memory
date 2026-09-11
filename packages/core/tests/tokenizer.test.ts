import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteMemoryManager } from '../src/sqlite/index';

test('uses the same injected tokenizer for memory and summary indexing/querying', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-tokenizer-'));
  const calls: string[] = [];
  const tokenizer = {
    tokenize: (text: string) => {
      calls.push(text);
      return /[\u4e00-\u9fff]/u.test(text) ? '' : 'marker';
    },
  };
  const manager = createSqliteMemoryManager({ dbPath: join(dir, 'test.db'), tokenizer });
  try {
    const memory = await manager.storeMemory({
      title: 'English title',
      content: 'English content',
    });
    expect((await manager.recallMemories({ query: 'English query' })).memories).toHaveLength(1);
    expect((await manager.recallMemories({ query: '中文查询' })).memories).toHaveLength(0);
    await manager.archiveSummary({
      id: 'summary-1',
      contextKey: 'context-1',
      text: 'English summary',
      createdAt: 1,
    });
    expect((await manager.recallSummaries({ query: 'summary query' })).summaries).toHaveLength(1);
    expect(calls).toContain('English title  English content');
    expect(calls).toContain('English query');
    expect(calls).toContain('English summary');
    expect(calls).toContain('summary query');
    expect(memory.id).toBeGreaterThan(0);
  } finally {
    await manager.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty tokenizer makes queries safely return no matches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-tokenizer-empty-'));
  const manager = createSqliteMemoryManager({
    dbPath: join(dir, 'test.db'),
    tokenizer: { tokenize: () => '' },
  });
  try {
    await manager.storeMemory({ title: 'Ignored', content: 'Ignored' });
    expect((await manager.recallMemories({ query: 'anything' })).memories).toEqual([]);
    expect((await manager.recallSummaries({ query: 'anything' })).summaries).toEqual([]);
  } finally {
    await manager.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
