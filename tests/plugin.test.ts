import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../plugin";

let hooks: any;
let dir: string;

const ctx = { sessionID: "ses_test" };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "opencode-memory-plugin-"));
  hooks = await plugin({ client: undefined }, { dbPath: join(dir, "test.db"), pinQuota: 100 });
});

afterEach(async () => {
  try { await hooks.dispose(); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

function idOf(r: string): number {
  return Number(r.match(/id=(\d+)/)?.[1]);
}

test("memory_store + memory_recall 往返", async () => {
  const r = await hooks.tool.memory_store.execute({ title: "偏好", content: "用 bun 跑脚本", type: "preference", tags: [] }, ctx);
  expect(r).toContain("已记住");
  const recall = await hooks.tool.memory_recall.execute({ query: "bun" }, ctx);
  expect(recall).toContain("用 bun 跑脚本");
});

test("软删除后 read 拒绝", async () => {
  const r = await hooks.tool.memory_store.execute({ title: "t", content: "c", type: "fact", tags: [] }, ctx);
  await hooks.tool.memory_forget.execute({ id: idOf(r) }, ctx);
  const read = await hooks.tool.memory_read.execute({ id: idOf(r) }, ctx);
  expect(read).toContain("已删除");
});

test("pin 配额超额拒绝", async () => {
  const r = await hooks.tool.memory_store.execute({ title: "长", content: "x".repeat(200), type: "fact", tags: [] }, ctx);
  const pin = await hooks.tool.memory_pin.execute({ id: idOf(r), pinned: true, pinMode: "full" }, ctx);
  expect(pin).toContain("超出 pin 配额");
});

test("重新 pin 同一条不重复计算配额", async () => {
  const r = await hooks.tool.memory_store.execute({ title: "t", content: "x".repeat(80), type: "fact", tags: [] }, ctx);
  const id = idOf(r);
  const p1 = await hooks.tool.memory_pin.execute({ id, pinned: true, pinMode: "full" }, ctx);
  expect(p1).toContain("已固定");
  // 重新 pin 同一条（同内容）：应扣除旧注入量，80-80+80=80 < 100，仍成功
  const p2 = await hooks.tool.memory_pin.execute({ id, pinned: true, pinMode: "full" }, ctx);
  expect(p2).toContain("已固定");
});

test("pin 后 list_pins 可见，取消后消失", async () => {
  const r = await hooks.tool.memory_store.execute({ title: "t", content: "c", type: "fact", tags: [] }, ctx);
  const id = idOf(r);
  await hooks.tool.memory_pin.execute({ id, pinned: true, pinMode: "summary", summary: "摘要" }, ctx);
  expect(await hooks.tool.memory_pins.execute({}, ctx)).toContain("[id=" + id + "]");
  await hooks.tool.memory_pin.execute({ id, pinned: false }, ctx);
  expect(await hooks.tool.memory_pins.execute({}, ctx)).toBe("（无固定记忆）");
});
