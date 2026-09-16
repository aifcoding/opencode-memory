import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMemoryStore } from '../src/sqlite/SqliteMemoryStore';

test('P1-3 零迁移：db_migrations 最大版本不变且无新增表/索引', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-migration-guard-'));
  const dbPath = join(dir, 'test.db');
  new SqliteMemoryStore(dbPath).close();

  const db = new Database(dbPath, { readonly: true });
  try {
    const version = db.query('SELECT MAX(version) AS v FROM db_migrations').get() as {
      v: number;
    };
    expect(version.v).toBe(3);

    const tables = (
      db.query(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    )
      .map((row) => row.name)
      .filter((name) => !name.startsWith('sqlite_') && !name.includes('_fts_'))
      .sort();
    expect(tables).toEqual([
      'db_migrations',
      'memories',
      'memories_fts',
      'memory_candidates',
      'memory_capture_runs',
      'session_kv',
      'session_summaries',
      'session_summaries_fts',
    ]);

    const indexes = (
      db
        .query(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[]
    )
      .map((row) => row.name)
      .sort();
    expect(indexes).toEqual([
      'idx_candidate_scope',
      'idx_candidate_status',
      'idx_capture_context',
      'idx_mem_dedup',
      'idx_mem_hash',
      'idx_mem_pin',
      'idx_mem_scope',
      'idx_mem_type',
    ]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
