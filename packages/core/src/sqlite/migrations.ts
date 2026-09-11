import type { Database } from 'bun:sqlite';

export interface Migration {
  version: number;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.run(`
        CREATE TABLE memories (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          scope         TEXT NOT NULL,
          scope_key     TEXT NOT NULL,
          origin        TEXT NOT NULL,
          trust         TEXT NOT NULL DEFAULT 'low',
          title         TEXT NOT NULL,
          content       TEXT NOT NULL,
          summary       TEXT NOT NULL DEFAULT '',
          type          TEXT NOT NULL DEFAULT 'fact',
          tags          TEXT NOT NULL DEFAULT '[]',
          pinned_at     INTEGER,
          pin_mode      TEXT NOT NULL DEFAULT 'summary',
          embedding     BLOB,
          embed_model   TEXT,
          embed_dim     INTEGER,
          content_hash  TEXT NOT NULL,
          revision      INTEGER NOT NULL DEFAULT 1,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL,
          deleted_at    INTEGER,
          CHECK(scope    IN ('global','user','project','session')),
          CHECK(origin   IN ('user','agent','compact')),
          CHECK(trust    IN ('high','low')),
          CHECK(pin_mode IN ('full','summary')),
          CHECK(pinned_at IS NULL OR trust = 'high'),
          CHECK(revision >= 1),
          CHECK(embed_dim IS NULL OR embed_dim > 0)
        )
      `);
      db.run(`CREATE INDEX idx_mem_scope ON memories(scope, scope_key)`);
      db.run(`CREATE INDEX idx_mem_type  ON memories(type)`);
      db.run(`CREATE INDEX idx_mem_pin   ON memories(pinned_at) WHERE pinned_at IS NOT NULL`);
      db.run(`CREATE INDEX idx_mem_hash  ON memories(content_hash)`);
      db.run(
        `CREATE UNIQUE INDEX idx_mem_dedup ON memories(scope, scope_key, content_hash) WHERE deleted_at IS NULL`,
      );
      db.run(
        `CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, body, tokenize='unicode61')`,
      );
      db.run(`
        CREATE TABLE session_kv (
          session_key TEXT NOT NULL,
          kv_key      TEXT NOT NULL,
          kv_value    TEXT NOT NULL,
          updated_at  INTEGER NOT NULL,
          UNIQUE(session_key, kv_key)
        )
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.run(`
        CREATE TABLE session_summaries (
          id           TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL,
          summary_text TEXT NOT NULL,
          created_at   INTEGER NOT NULL
        )
      `);
      db.run(
        `CREATE VIRTUAL TABLE session_summaries_fts USING fts5(id UNINDEXED, body, tokenize='unicode61')`,
      );
    },
  },
];

export function migrate(db: Database): void {
  // 先取写锁，再读已应用版本并执行迁移，避免多个实例并发初始化时同时迁移导致 table already exists
  db.run('BEGIN IMMEDIATE');
  try {
    db.run(
      `CREATE TABLE IF NOT EXISTS db_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );
    const maxVersion = Math.max(0, ...migrations.map((m) => m.version));
    const applied = new Set(
      (db.query(`SELECT version FROM db_migrations`).all() as { version: number }[]).map(
        (r) => r.version,
      ),
    );
    for (const v of applied) {
      if (v > maxVersion) {
        throw new Error(`Database version ${v} is newer than code max version ${maxVersion}`);
      }
    }
    // 校验已应用版本连续（从 1 起无缺口）
    for (const v of applied) {
      if (v > 1 && !applied.has(v - 1)) {
        throw new Error(`Migration gap detected: version ${v} applied but ${v - 1} is missing`);
      }
    }
    for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
      if (applied.has(m.version)) continue;
      const prev = m.version - 1;
      if (prev > 0 && !applied.has(prev)) {
        throw new Error(
          `Migration out of order: version ${m.version} requires ${prev} which is not applied`,
        );
      }
      m.up(db);
      db.run(`INSERT INTO db_migrations (version, applied_at) VALUES (?, ?)`, [
        m.version,
        Date.now(),
      ]);
      applied.add(m.version);
    }
    db.run('COMMIT');
  } catch (error) {
    try {
      // 保留触发回滚的原始异常。
      db.run('ROLLBACK');
    } catch {
      // 保留触发回滚的原始异常。
    }
    throw error;
  }
}
