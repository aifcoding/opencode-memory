import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteMemoryStore } from "../src/storage/SqliteMemoryStore";

let store: SqliteMemoryStore;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opencode-memory-test-"));
  store = new SqliteMemoryStore(join(dir, "test.db"));
});
afterEach(() => {
  try { store.close(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

test("中文 2 字词可召回", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "微信头像加载失败" });
  expect(store.search("头像").map((h) => h.id)).toContain(e.id);
});

test("英文标识符保留（camelCase 拆分 + 下划线）", () => {
  const e = store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "use SqliteMemoryStore and foo_bar here" });
  expect(store.search("sqlite").map((h) => h.id)).toContain(e.id);
  expect(store.search("foo_bar").map((h) => h.id)).toContain(e.id);
});

test("无匹配返空", () => {
  store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "hello world" });
  expect(store.search("不存在的词xyz")).toEqual([]);
});

test("scope 过滤 + 软删排除", () => {
  const a = store.create({ scope: "project", scopeKey: "/a", origin: "user", trust: "high", title: "t", content: "memory system" });
  const b = store.create({ scope: "project", scopeKey: "/b", origin: "user", trust: "high", title: "t", content: "memory system" });
  expect(store.search("memory", { scope: "project", scopeKey: "/a" }).map((h) => h.id)).toEqual([a.id]);
  store.softDelete(a.id);
  expect(store.search("memory", { scope: "project", scopeKey: "/a" })).toEqual([]);
  expect(store.search("memory", { scope: "project", scopeKey: "/b" }).map((h) => h.id)).toEqual([b.id]);
});

test("结果带 id + score 且降序", () => {
  store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "memory" });
  store.create({ scope: "project", scopeKey: "/x", origin: "user", trust: "high", title: "t", content: "memory memory memory system" });
  const hits = store.search("memory");
  expect(hits.length).toBe(2);
  for (const h of hits) {
    expect(h.id).toBeGreaterThan(0);
    expect(typeof h.score).toBe("number");
  }
  for (let i = 1; i < hits.length; i++) {
    expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  }
});
