import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryEntry, PinMode, Scope } from '../domain/types.js';
import { renderPinnedBlock } from '../render/pinned-context.js';
import { defaultTokenizer, type Tokenizer } from '../retrieval/tokenizer.js';
import { migrate } from './migrations.js';
import { checkCapabilities } from './capability.js';
import { DuplicateMemoryError } from '../errors.js';
import type {
  CreateMemoryInput,
  ListByScopeOptions,
  MemoryStore,
  MetaPatch,
  SearchHit,
  SearchOptions,
  SummaryArchiveInput,
  SummaryResult,
  UpdateContentResult,
} from '../ports/MemoryStore.js';

interface MemoryRow {
  id: number;
  scope: string;
  scope_key: string;
  origin: string;
  trust: string;
  title: string;
  content: string;
  summary: string;
  type: string;
  tags: string;
  pinned_at: number | null;
  pin_mode: string;
  embedding: Uint8Array | null;
  embed_model: string | null;
  embed_dim: number | null;
  content_hash: string;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const hashContent = (content: string) => createHash('sha256').update(content).digest('hex');

function mapRow(r: MemoryRow): MemoryEntry {
  return {
    id: r.id,
    scope: r.scope as Scope,
    scopeKey: r.scope_key,
    origin: r.origin as MemoryEntry['origin'],
    trust: r.trust as MemoryEntry['trust'],
    title: r.title,
    content: r.content,
    summary: r.summary,
    type: r.type as MemoryEntry['type'],
    tags: JSON.parse(r.tags || '[]') as string[],
    pinnedAt: r.pinned_at,
    pinMode: r.pin_mode as MemoryEntry['pinMode'],
    embedding: r.embedding,
    embedModel: r.embed_model,
    embedDim: r.embed_dim,
    contentHash: r.content_hash,
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

const isBusyError = (error: unknown) => {
  const code = String((error as { code?: unknown })?.code ?? '');
  const message = String((error as { message?: unknown })?.message ?? '');
  return /SQLITE_BUSY|SQLITE_LOCKED/i.test(code) || /locked|busy/i.test(message);
};

export class SqliteMemoryStore implements MemoryStore {
  private db: Database;
  private readonly tokenizer: Tokenizer;

  /**
   * Open a SQLite store with a tokenizer. The tokenizer is part of the database index format:
   * an existing database must continue using a compatible tokenizer or records may be missed.
   * This version has no automatic re-indexing; export and re-import into a new database to
   * change tokenizers.
   */
  constructor(dbPath: string, tokenizer: Tokenizer = defaultTokenizer) {
    this.tokenizer = tokenizer;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    try {
      this.db.run('PRAGMA busy_timeout=5000');
      checkCapabilities(this.db);
      this.withRetry(() => {
        this.db.run('PRAGMA journal_mode=WAL');
        migrate(this.db);
      });
    } catch (e) {
      this.db.close();
      throw e;
    }
  }

  private syncFts(id: number, entry: { title: string; summary: string; content: string }) {
    const body = this.tokenizer.tokenize(`${entry.title} ${entry.summary} ${entry.content}`);
    this.db.run('DELETE FROM memories_fts WHERE id = ?', [id]);
    this.db.run('INSERT INTO memories_fts (id, body) VALUES (?, ?)', [id, body]);
  }

  private withRetry<T>(fn: () => T): T {
    let attempt = 0;
    for (;;) {
      try {
        return fn();
      } catch (e) {
        if (isBusyError(e) && attempt < 5) {
          attempt++;
          Bun.sleepSync(Math.min(1000, 20 * 2 ** attempt + Math.random() * 10));
          continue;
        }
        throw e;
      }
    }
  }

  create(input: CreateMemoryInput): MemoryEntry {
    const now = Date.now();
    const contentHash = hashContent(input.content);
    const tags = JSON.stringify(input.tags ?? []);
    try {
      return this.withRetry(() =>
        this.db.transaction(() => {
          const res = this.db.run(
            `INSERT INTO memories
             (scope, scope_key, origin, trust, title, content, summary, type, tags,
              pinned_at, pin_mode, embedding, embed_model, embed_dim, content_hash, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              input.scope.scope,
              input.scope.scopeKey,
              input.origin,
              input.trust,
              input.title,
              input.content,
              input.summary ?? '',
              input.type ?? 'fact',
              tags,
              input.pinnedAt ?? null,
              input.pinMode ?? 'summary',
              input.embedding ?? null,
              input.embedModel ?? null,
              input.embedDim ?? null,
              contentHash,
              now,
              now,
            ],
          );
          const id = Number(res.lastInsertRowid);
          this.syncFts(id, {
            title: input.title,
            summary: input.summary ?? '',
            content: input.content,
          });
          return this.get(id)!;
        })(),
      );
    } catch (error) {
      if (
        /UNIQUE constraint failed.*memories/i.test(
          String((error as { message?: unknown })?.message ?? error),
        )
      ) {
        throw new DuplicateMemoryError();
      }
      throw error;
    }
  }

  get(id: number): MemoryEntry | null {
    const row = this.db.query(`SELECT * FROM memories WHERE id = ?`).get(id) as
      | MemoryRow
      | undefined;
    return row ? mapRow(row) : null;
  }

  updateMeta(id: number, patch: MetaPatch): MemoryEntry | null {
    const touchesFts = patch.title !== undefined || patch.summary !== undefined;
    const cols: string[] = [];
    const vals: SQLQueryBindings[] = [];
    if (patch.title !== undefined) {
      cols.push('title = ?');
      vals.push(patch.title);
    }
    if (patch.summary !== undefined) {
      cols.push('summary = ?');
      vals.push(patch.summary);
    }
    if (patch.type !== undefined) {
      cols.push('type = ?');
      vals.push(patch.type);
    }
    if (patch.tags !== undefined) {
      cols.push('tags = ?');
      vals.push(JSON.stringify(patch.tags));
    }
    if (patch.pinnedAt !== undefined) {
      cols.push('pinned_at = ?');
      vals.push(patch.pinnedAt);
    }
    if (patch.pinMode !== undefined) {
      cols.push('pin_mode = ?');
      vals.push(patch.pinMode);
    }
    if (cols.length === 0) return this.get(id);
    cols.push('updated_at = ?');
    vals.push(Date.now());
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(`UPDATE memories SET ${cols.join(', ')} WHERE id = ?`, [
          ...vals,
          id,
        ]);
        if (res.changes === 0) return null;
        if (touchesFts) {
          const entry = this.get(id)!;
          this.syncFts(id, { title: entry.title, summary: entry.summary, content: entry.content });
        }
        return this.get(id);
      })(),
    );
  }

  updateContent(
    id: number,
    content: string,
    expectedRevision: number,
    title?: string,
  ): UpdateContentResult {
    const now = Date.now();
    const contentHash = hashContent(content);
    return this.withRetry(() =>
      this.db.transaction(() => {
        const hasTitle = title !== undefined;
        const res = this.db.run(
          `UPDATE memories SET content=?, content_hash=?, updated_at=?, revision=revision+1
             ${hasTitle ? ', title=?' : ''} WHERE id=? AND revision=? AND deleted_at IS NULL`,
          hasTitle
            ? [content, contentHash, now, title, id, expectedRevision]
            : [content, contentHash, now, id, expectedRevision],
        );
        if (res.changes === 0) return { memory: null, conflict: true };
        const memory = this.get(id)!;
        this.syncFts(id, { title: memory.title, summary: memory.summary, content });
        return { memory: this.get(id), conflict: false };
      })(),
    );
  }

  softDelete(id: number): boolean {
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(
          `UPDATE memories SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`,
          [Date.now(), Date.now(), id],
        );
        if (res.changes === 0) return false;
        this.db.run('DELETE FROM memories_fts WHERE id = ?', [id]);
        return true;
      })(),
    );
  }

  restore(id: number): boolean {
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(
          `UPDATE memories SET deleted_at=NULL, updated_at=? WHERE id=? AND deleted_at IS NOT NULL`,
          [Date.now(), id],
        );
        if (res.changes === 0) return false;
        const entry = this.get(id)!;
        this.syncFts(id, { title: entry.title, summary: entry.summary, content: entry.content });
        return true;
      })(),
    );
  }

  listByScope(scope: Scope, scopeKey: string, options?: ListByScopeOptions): MemoryEntry[] {
    let sql = `SELECT * FROM memories WHERE scope = ? AND scope_key = ? AND deleted_at IS NULL`;
    const vals: SQLQueryBindings[] = [scope, scopeKey];
    if (options?.type) {
      sql += ' AND type = ?';
      vals.push(options.type);
    }
    sql += ' ORDER BY updated_at DESC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      vals.push(options.limit);
    }
    const rows = this.db.query(sql).all(...vals) as MemoryRow[];
    return rows.map(mapRow);
  }

  listPinned(scope: Scope, scopeKey: string): MemoryEntry[] {
    const rows = this.db
      .query(
        `SELECT * FROM memories WHERE scope=? AND scope_key=? AND deleted_at IS NULL AND pinned_at IS NOT NULL ORDER BY pinned_at DESC`,
      )
      .all(scope, scopeKey) as MemoryRow[];
    return rows.map(mapRow);
  }

  // 在单个写事务内完成「读固定项 → 按最终渲染长度校验配额 → 更新」，避免多进程并发突破配额
  pinWithinQuota(
    id: number,
    pinMode: PinMode,
    summary: string,
    quota: number,
  ): { ok: boolean; size: number } {
    return this.withRetry(() => {
      this.db.run('BEGIN IMMEDIATE');
      try {
        const target = this.db.query(`SELECT * FROM memories WHERE id = ?`).get(id) as
          | MemoryRow
          | undefined;
        if (!target || target.deleted_at != null) {
          this.db.run('ROLLBACK');
          return { ok: false, size: 0 };
        }
        const others = this.db
          .query(
            `SELECT * FROM memories WHERE scope = ? AND scope_key = ? AND deleted_at IS NULL AND pinned_at IS NOT NULL AND id != ?`,
          )
          .all(target.scope, target.scope_key, id) as MemoryRow[];
        const targetEntry: MemoryEntry = { ...mapRow(target), pinMode, summary };
        const size = renderPinnedBlock([...others.map(mapRow), targetEntry]).length;
        if (size > quota) {
          this.db.run('ROLLBACK');
          return { ok: false, size };
        }
        this.db.run(
          `UPDATE memories SET pinned_at = ?, pin_mode = ?, summary = ?, updated_at = ? WHERE id = ?`,
          [Date.now(), pinMode, summary, Date.now(), id],
        );
        // summary 属于 FTS body，须在同一事务内同步索引
        this.syncFts(id, { title: target.title, summary, content: target.content });
        this.db.run('COMMIT');
        return { ok: true, size };
      } catch (error) {
        try {
          // 保留触发回滚的原始异常。
          this.db.run('ROLLBACK');
        } catch {
          // 保留触发回滚的原始异常。
        }
        throw error;
      }
    });
  }

  search(query: string, options?: SearchOptions): SearchHit[] {
    const tokens = this.tokenizeQuery(query);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    let sql = `SELECT m.id AS id, bm25(memories_fts) AS bm
               FROM memories_fts
               JOIN memories m ON m.id = memories_fts.id
               WHERE memories_fts MATCH ?`;
    const params: SQLQueryBindings[] = [match];
    if (options?.scope) {
      sql += ' AND m.scope = ? AND m.scope_key = ?';
      params.push(options.scope.scope, options.scope.scopeKey);
    }
    sql += ' AND m.deleted_at IS NULL ORDER BY bm25(memories_fts) LIMIT ?';
    params.push(options?.limit ?? 20);
    const rows = this.db.query(sql).all(...params) as { id: number; bm: number }[];
    return rows.map((r) => ({ id: r.id, score: -r.bm }));
  }

  // 最小 FTS 查询（此处用于验证 FTS 同步；正式检索走 search）
  ftsMatch(query: string): number[] {
    const tokens = this.tokenizeQuery(query);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    const rows = this.db
      .query(`SELECT id FROM memories_fts WHERE memories_fts MATCH ?`)
      .all(match) as { id: number }[];
    return rows.map((r) => r.id);
  }

  setKv(contextKey: string, key: string, value: string): void {
    const now = Date.now();
    this.withRetry(() =>
      this.db.run(
        `INSERT INTO session_kv (session_key, kv_key, kv_value, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(session_key, kv_key) DO UPDATE SET kv_value=excluded.kv_value, updated_at=excluded.updated_at`,
        [contextKey, key, value, now],
      ),
    );
  }

  getKv(contextKey: string, key: string): string | null {
    const row = this.db
      .query(`SELECT kv_value FROM session_kv WHERE session_key=? AND kv_key=?`)
      .get(contextKey, key) as { kv_value: string } | undefined;
    return row ? row.kv_value : null;
  }

  listKv(contextKey: string): Record<string, string> {
    const rows = this.db
      .query(`SELECT kv_key, kv_value FROM session_kv WHERE session_key=? ORDER BY kv_key`)
      .all(contextKey) as { kv_key: string; kv_value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.kv_key] = r.kv_value;
    return out;
  }

  deleteKv(contextKey: string, key: string): boolean {
    return this.withRetry(
      () =>
        this.db.run(`DELETE FROM session_kv WHERE session_key=? AND kv_key=?`, [contextKey, key])
          .changes > 0,
    );
  }

  archiveSummary(input: SummaryArchiveInput): boolean {
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(
          `INSERT OR IGNORE INTO session_summaries (id, session_id, summary_text, created_at) VALUES (?,?,?,?)`,
          [input.id, input.contextKey, input.text, input.createdAt],
        );
        // 重复 ID 时忽略（保持主表与 FTS 一致），仅在真正插入时建 FTS 索引
        if (res.changes === 0) return false;
        const body = this.tokenizer.tokenize(input.text);
        this.db.run(`INSERT INTO session_summaries_fts (id, body) VALUES (?, ?)`, [input.id, body]);
        return true;
      })(),
    );
  }

  searchSummaries(query: string, limit = 10): SummaryResult[] {
    const tokens = this.tokenizeQuery(query);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    const rows = this.db
      .query(
        `SELECT s.id, s.session_id, s.summary_text, s.created_at, bm25(session_summaries_fts) AS bm
       FROM session_summaries_fts
       JOIN session_summaries s ON s.id = session_summaries_fts.id
       WHERE session_summaries_fts MATCH ?
       ORDER BY bm25(session_summaries_fts) LIMIT ?`,
      )
      .all(match, limit) as {
      id: string;
      session_id: string;
      summary_text: string;
      created_at: number;
      bm?: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      contextKey: r.session_id,
      text: r.summary_text,
      createdAt: r.created_at,
      score: -(r.bm ?? 0),
    }));
  }

  close(): void {
    this.db.close();
  }

  private tokenizeQuery(query: string): string[] {
    return this.tokenizer.tokenize(query).split(/\s+/u).filter(Boolean);
  }
}
