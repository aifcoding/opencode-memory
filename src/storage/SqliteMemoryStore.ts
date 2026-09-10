import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryEntry, PinMode, Scope } from "../types.js";
import { renderPinnedBlock } from "../render.js";
import { tokenize } from "./tokenizer.js";
import { migrate } from "./migrations.js";
import { checkCapabilities } from "./capability.js";
import type { CreateMemoryInput, MemoryStore, MetaPatch, SearchHit, SearchOptions, SummaryArchiveInput, SummaryResult, UpdateContentResult } from "./MemoryStore.js";

interface Row {
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

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

function mapRow(r: Row): MemoryEntry {
  return {
    id: r.id,
    scope: r.scope as Scope,
    scopeKey: r.scope_key,
    origin: r.origin as MemoryEntry["origin"],
    trust: r.trust as MemoryEntry["trust"],
    title: r.title,
    content: r.content,
    summary: r.summary,
    type: r.type,
    tags: JSON.parse(r.tags || "[]") as string[],
    pinnedAt: r.pinned_at,
    pinMode: r.pin_mode as MemoryEntry["pinMode"],
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

const isBusy = (e: unknown) => {
  const code = String((e as any)?.code ?? "");
  const msg = String((e as any)?.message ?? "");
  return /SQLITE_BUSY|SQLITE_LOCKED/i.test(code) || /locked|busy/i.test(msg);
};

export class SqliteMemoryStore implements MemoryStore {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    try {
      this.db.run("PRAGMA busy_timeout=5000");
      checkCapabilities(this.db);
      this.withRetry(() => {
        this.db.run("PRAGMA journal_mode=WAL");
        migrate(this.db);
      });
    } catch (e) {
      this.db.close();
      throw e;
    }
  }

  private syncFts(id: number, entry: { title: string; summary: string; content: string }) {
    const body = tokenize(`${entry.title} ${entry.summary} ${entry.content}`);
    this.db.run("DELETE FROM memories_fts WHERE id = ?", [id]);
    this.db.run("INSERT INTO memories_fts (id, body) VALUES (?, ?)", [id, body]);
  }

  private withRetry<T>(fn: () => T): T {
    let attempt = 0;
    for (;;) {
      try {
        return fn();
      } catch (e) {
        if (isBusy(e) && attempt < 5) {
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
    const contentHash = hash(input.content);
    const tags = JSON.stringify(input.tags ?? []);
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(
          `INSERT INTO memories
             (scope, scope_key, origin, trust, title, content, summary, type, tags,
              pinned_at, pin_mode, embedding, embed_model, embed_dim, content_hash, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            input.scope, input.scopeKey, input.origin, input.trust, input.title, input.content,
            input.summary ?? "", input.type ?? "fact", tags,
            input.pinnedAt ?? null, input.pinMode ?? "summary",
            input.embedding ?? null, input.embedModel ?? null, input.embedDim ?? null,
            contentHash, now, now,
          ]
        );
        const id = Number(res.lastInsertRowid);
        this.syncFts(id, { title: input.title, summary: input.summary ?? "", content: input.content });
        return this.get(id)!;
      })()
    );
  }

  get(id: number): MemoryEntry | null {
    const r = this.db.query(`SELECT * FROM memories WHERE id = ?`).get(id) as Row | undefined;
    return r ? mapRow(r) : null;
  }

  updateMeta(id: number, patch: MetaPatch): MemoryEntry | null {
    const touchesFts = patch.title !== undefined || patch.summary !== undefined;
    const cols: string[] = [];
    const vals: unknown[] = [];
    if (patch.title !== undefined) { cols.push("title = ?"); vals.push(patch.title); }
    if (patch.summary !== undefined) { cols.push("summary = ?"); vals.push(patch.summary); }
    if (patch.type !== undefined) { cols.push("type = ?"); vals.push(patch.type); }
    if (patch.tags !== undefined) { cols.push("tags = ?"); vals.push(JSON.stringify(patch.tags)); }
    if (patch.pinnedAt !== undefined) { cols.push("pinned_at = ?"); vals.push(patch.pinnedAt); }
    if (patch.pinMode !== undefined) { cols.push("pin_mode = ?"); vals.push(patch.pinMode); }
    if (cols.length === 0) return this.get(id);
    cols.push("updated_at = ?");
    vals.push(Date.now());
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(`UPDATE memories SET ${cols.join(", ")} WHERE id = ?`, [...vals, id]);
        if (res.changes === 0) return null;
        if (touchesFts) {
          const entry = this.get(id)!;
          this.syncFts(id, { title: entry.title, summary: entry.summary, content: entry.content });
        }
        return this.get(id);
      })()
    );
  }

  updateContent(id: number, content: string, expectedRevision: number, title?: string): UpdateContentResult {
    const now = Date.now();
    const contentHash = hash(content);
    return this.withRetry(() =>
      this.db.transaction(() => {
        const hasTitle = title !== undefined;
        const res = this.db.run(
          `UPDATE memories SET content=?, content_hash=?, updated_at=?, revision=revision+1
             ${hasTitle ? ", title=?" : ""} WHERE id=? AND revision=? AND deleted_at IS NULL`,
          hasTitle
            ? [content, contentHash, now, title, id, expectedRevision]
            : [content, contentHash, now, id, expectedRevision]
        );
        if (res.changes === 0) return { entry: null, conflict: true };
        const entry = this.get(id)!;
        this.syncFts(id, { title: entry.title, summary: entry.summary, content });
        return { entry: this.get(id), conflict: false };
      })()
    );
  }

  softDelete(id: number): boolean {
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(
          `UPDATE memories SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`,
          [Date.now(), Date.now(), id]
        );
        if (res.changes === 0) return false;
        this.db.run("DELETE FROM memories_fts WHERE id = ?", [id]);
        return true;
      })()
    );
  }

  restore(id: number): boolean {
    return this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(`UPDATE memories SET deleted_at=NULL, updated_at=? WHERE id=? AND deleted_at IS NOT NULL`, [Date.now(), id]);
        if (res.changes === 0) return false;
        const entry = this.get(id)!;
        this.syncFts(id, { title: entry.title, summary: entry.summary, content: entry.content });
        return true;
      })()
    );
  }

  listByScope(scope: Scope, scopeKey: string, opts?: { type?: string; limit?: number }): MemoryEntry[] {
    let sql = `SELECT * FROM memories WHERE scope = ? AND scope_key = ? AND deleted_at IS NULL`;
    const vals: unknown[] = [scope, scopeKey];
    if (opts?.type) { sql += " AND type = ?"; vals.push(opts.type); }
    sql += " ORDER BY updated_at DESC";
    if (opts?.limit) { sql += " LIMIT ?"; vals.push(opts.limit); }
    const rows = this.db.query(sql).all(...vals) as Row[];
    return rows.map(mapRow);
  }

  listPinned(scope: Scope, scopeKey: string): MemoryEntry[] {
    const rows = this.db.query(
      `SELECT * FROM memories WHERE scope=? AND scope_key=? AND deleted_at IS NULL AND pinned_at IS NOT NULL ORDER BY pinned_at DESC`
    ).all(scope, scopeKey) as Row[];
    return rows.map(mapRow);
  }

  // 在单个写事务内完成「读固定项 → 按最终渲染长度校验配额 → 更新」，避免多进程并发突破配额
  pinWithinQuota(id: number, pinMode: PinMode, summary: string, quota: number): { ok: boolean; size: number } {
    return this.withRetry(() => {
      this.db.run("BEGIN IMMEDIATE");
      try {
        const target = this.db.query(`SELECT * FROM memories WHERE id = ?`).get(id) as Row | undefined;
        if (!target || target.deleted_at != null) {
          this.db.run("ROLLBACK");
          return { ok: false, size: 0 };
        }
        const others = this.db.query(
          `SELECT * FROM memories WHERE scope = ? AND scope_key = ? AND deleted_at IS NULL AND pinned_at IS NOT NULL AND id != ?`
        ).all(target.scope, target.scope_key, id) as Row[];
        const targetEntry: MemoryEntry = { ...mapRow(target), pinMode, summary };
        const size = renderPinnedBlock([...others.map(mapRow), targetEntry]).length;
        if (size > quota) {
          this.db.run("ROLLBACK");
          return { ok: false, size };
        }
        this.db.run(
          `UPDATE memories SET pinned_at = ?, pin_mode = ?, summary = ?, updated_at = ? WHERE id = ?`,
          [Date.now(), pinMode, summary, Date.now(), id]
        );
        // summary 属于 FTS body，须在同一事务内同步索引
        this.syncFts(id, { title: target.title, summary, content: target.content });
        this.db.run("COMMIT");
        return { ok: true, size };
      } catch (e) {
        try { this.db.run("ROLLBACK"); } catch {}
        throw e;
      }
    });
  }

  search(query: string, opts?: SearchOptions): SearchHit[] {
    const tokens = tokenize(query).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
    let sql = `SELECT m.id AS id, bm25(memories_fts) AS bm
               FROM memories_fts
               JOIN memories m ON m.id = memories_fts.id
               WHERE memories_fts MATCH ?`;
    const params: unknown[] = [match];
    if (opts?.scope) { sql += " AND m.scope = ?"; params.push(opts.scope); }
    if (opts?.scopeKey) { sql += " AND m.scope_key = ?"; params.push(opts.scopeKey); }
    sql += " AND m.deleted_at IS NULL ORDER BY bm25(memories_fts) LIMIT ?";
    params.push(opts?.limit ?? 20);
    const rows = this.db.query(sql).all(...params) as { id: number; bm: number }[];
    return rows.map((r) => ({ id: r.id, score: -r.bm }));
  }

  // 最小 FTS 查询（此处用于验证 FTS 同步；正式检索走 search）
  ftsMatch(query: string): number[] {
    const tokens = tokenize(query).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
    const rows = this.db.query(`SELECT id FROM memories_fts WHERE memories_fts MATCH ?`).all(match) as { id: number }[];
    return rows.map((r) => r.id);
  }

  setKv(sessionKey: string, key: string, value: string): void {
    const now = Date.now();
    this.withRetry(() =>
      this.db.run(
        `INSERT INTO session_kv (session_key, kv_key, kv_value, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(session_key, kv_key) DO UPDATE SET kv_value=excluded.kv_value, updated_at=excluded.updated_at`,
        [sessionKey, key, value, now]
      )
    );
  }

  getKv(sessionKey: string, key: string): string | null {
    const r = this.db.query(`SELECT kv_value FROM session_kv WHERE session_key=? AND kv_key=?`).get(sessionKey, key) as
      | { kv_value: string }
      | undefined;
    return r ? r.kv_value : null;
  }

  listKv(sessionKey: string): Record<string, string> {
    const rows = this.db
      .query(`SELECT kv_key, kv_value FROM session_kv WHERE session_key=? ORDER BY kv_key`)
      .all(sessionKey) as { kv_key: string; kv_value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.kv_key] = r.kv_value;
    return out;
  }

  deleteKv(sessionKey: string, key: string): boolean {
    return this.withRetry(
      () => this.db.run(`DELETE FROM session_kv WHERE session_key=? AND kv_key=?`, [sessionKey, key]).changes > 0
    );
  }

  archiveSummary(input: SummaryArchiveInput): void {
    this.withRetry(() =>
      this.db.transaction(() => {
        const res = this.db.run(
          `INSERT OR IGNORE INTO session_summaries (id, session_id, summary_text, created_at) VALUES (?,?,?,?)`,
          [input.id, input.sessionId, input.summaryText, input.createdAt]
        );
        // 重复 ID 时忽略（保持主表与 FTS 一致），仅在真正插入时建 FTS 索引
        if (res.changes === 0) return;
        const body = tokenize(input.summaryText);
        this.db.run(`INSERT INTO session_summaries_fts (id, body) VALUES (?, ?)`, [input.id, body]);
      })()
    );
  }

  searchSummaries(query: string, limit = 10): SummaryResult[] {
    const tokens = tokenize(query).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
    const rows = this.db.query(
      `SELECT s.id, s.session_id, s.summary_text, s.created_at
       FROM session_summaries_fts
       JOIN session_summaries s ON s.id = session_summaries_fts.id
       WHERE session_summaries_fts MATCH ?
       ORDER BY bm25(session_summaries_fts) LIMIT ?`
    ).all(match, limit) as { id: string; session_id: string; summary_text: string; created_at: number }[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      summaryText: r.summary_text,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}