import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMemoryStore } from "../src/storage/SqliteMemoryStore";

let store: SqliteMemoryStore;
let dir: string;

function fresh() {
  dir = mkdtempSync(join(tmpdir(), "opencode-memory-test-"));
  store = new SqliteMemoryStore(join(dir, "test.db"));
}

beforeEach(fresh);
afterEach(() => {
  try { store.close(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

test("CRUD: create + get", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "hello world" });
  expect(e.id).toBeGreaterThan(0);
  expect(e.contentHash).toHaveLength(64);
  expect(e.revision).toBe(1);
  expect(store.get(e.id)!.content).toBe("hello world");
});

test("scope isolation", () => {
  store.create({ scope: "project", scopeKey: "/a", origin: "user", trust: "high", title: "t", content: "a" });
  store.create({ scope: "project", scopeKey: "/b", origin: "user", trust: "high", title: "t", content: "b" });
  expect(store.listByScope("project", "/a")).toHaveLength(1);
  expect(store.listByScope("project", "/b")).toHaveLength(1);
  expect(store.listByScope("global", "g")).toHaveLength(0);
});

test("soft delete + dedup", () => {
  const e1 = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "dup" });
  expect(() => store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "dup" })).toThrow();
  store.softDelete(e1.id);
  expect(store.get(e1.id)!.deletedAt).not.toBeNull();
  const e2 = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "dup" });
  expect(e2.id).toBeGreaterThan(0);
  expect(() => store.restore(e1.id)).toThrow();
  store.softDelete(e2.id);
  expect(store.restore(e1.id)).toBe(true);
  expect(store.get(e1.id)!.deletedAt).toBeNull();
});

test("FTS index in sync (create/softDelete/restore)", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "hello world memory system" });
  expect(store.ftsMatch("memory")).toContain(e.id);
  store.softDelete(e.id);
  expect(store.ftsMatch("memory")).not.toContain(e.id);
  store.restore(e.id);
  expect(store.ftsMatch("memory")).toContain(e.id);
});

test("updateMeta title change syncs FTS", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "old", content: "hello world memory" });
  store.updateMeta(e.id, { title: "brandnewtitle" });
  expect(store.ftsMatch("brandnewtitle")).toContain(e.id);
});

test("updateMeta does not clear embedding", () => {
  const emb = new Uint8Array([1, 2, 3, 4]);
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "c", embedding: emb, embedDim: 4 });
  store.updateMeta(e.id, { title: "renamed", pinnedAt: Date.now(), pinMode: "summary" });
  const got = store.get(e.id)!;
  expect(got.embedding).toEqual(emb);
  expect(got.embedDim).toBe(4);
  expect(got.title).toBe("renamed");
});

test("optimistic lock CAS", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "v1" });
  const r1 = store.updateContent(e.id, "v2", e.revision);
  expect(r1.conflict).toBe(false);
  expect(r1.entry!.revision).toBe(2);
  const r2 = store.updateContent(e.id, "v3", e.revision);
  expect(r2.conflict).toBe(true);
  expect(store.get(e.id)!.content).toBe("v2");
});

test("updateContent on soft-deleted is rejected", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "v1" });
  store.softDelete(e.id);
  const r = store.updateContent(e.id, "v2", e.revision);
  expect(r.conflict).toBe(true);
  expect(store.ftsMatch("v2")).not.toContain(e.id);
});

test("restore is idempotent (second call false)", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "c" });
  store.softDelete(e.id);
  expect(store.restore(e.id)).toBe(true);
  expect(store.restore(e.id)).toBe(false);
});

test("session KV upsert/list/delete", () => {
  store.setKv("s1", "k", "v1");
  store.setKv("s1", "k", "v2");
  expect(store.getKv("s1", "k")).toBe("v2");
  expect(store.listKv("s1")).toEqual({ k: "v2" });
  expect(store.getKv("s2", "k")).toBeNull();
  expect(store.deleteKv("s1", "k")).toBe(true);
  expect(store.getKv("s1", "k")).toBeNull();
});

test("CHECK rejects invalid trust", () => {
  expect(() => store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "bogus" as any, title: "t", content: "c" })).toThrow();
});

test("getPinnedSize counts full vs summary", () => {
  const e1 = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t1", content: "aaaa" });
  const e2 = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t2", content: "bbbbbb", summary: "bb" });
  store.updateMeta(e1.id, { pinnedAt: Date.now(), pinMode: "full" });
  store.updateMeta(e2.id, { pinnedAt: Date.now(), pinMode: "summary" });
  expect(store.getPinnedSize("project", "/x")).toBe(4 + 2); // full 按 content，summary 按 summary
});

test("archiveSummary + searchSummaries", () => {
  store.archiveSummary({ id: "sum_1", sessionId: "s1", summaryText: "微信头像加载失败的排查结论", createdAt: Date.now() });
  const results = store.searchSummaries("头像");
  expect(results.length).toBe(1);
  expect(results[0].id).toBe("sum_1");
  // 幂等：重复归档同 id 不报错、不重复
  store.archiveSummary({ id: "sum_1", sessionId: "s1", summaryText: "微信头像加载失败的排查结论", createdAt: Date.now() });
  expect(store.searchSummaries("头像").length).toBe(1);
});

test("archiveSummary 重复 ID 保持主表与 FTS 一致", () => {
  store.archiveSummary({ id: "sum_2", sessionId: "s1", summaryText: "头像加载失败的排查", createdAt: Date.now() });
  // 同 ID 不同内容：应被忽略（幂等，保留首次内容）
  store.archiveSummary({ id: "sum_2", sessionId: "s1", summaryText: "完全无关的支付问题", createdAt: Date.now() });
  expect(store.searchSummaries("支付")).toEqual([]); // 新内容不被索引
  expect(store.searchSummaries("头像").length).toBe(1); // 首次内容仍可检索
});

test("migration idempotent on reopen", () => {
  const path = join(dir, "test.db");
  store.close();
  const s2 = new SqliteMemoryStore(path);
  expect(s2.listByScope("global", "g")).toHaveLength(0);
  s2.close();
});
