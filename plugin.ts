import { z } from "zod";
import { join, isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { SqliteMemoryStore } from "./src/storage/SqliteMemoryStore";
import { renderPinnedBlock } from "./src/render";

// 默认个人单机：global 作用域单一记忆池，origin=user / trust=high。
// 团队化时需引入 D7 严格分级（低信任内容不自动注入）。
const SCOPE = "global" as const;
const SCOPE_KEY = "default";
const PIN_QUOTA_DEFAULT = 8000;

const ConfigSchema = z
  .object({
    dbPath: z.string().min(1).refine(isAbsolute, "dbPath 必须是绝对路径").optional(),
    pinQuota: z.number().int().positive().optional(),
  })
  .strict();

// opencode 数据根目录（与 session db 同根）：macOS/Linux 为 ~/.local/share/opencode
function opencodeDataDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "", ".local", "share");
  return join(base, "opencode");
}

// 默认数据库位置：opencode 数据根下的 memory/ 子目录（与 opencode 自身的 log/、storage/ 等子目录一致）
function defaultDbPath(): string {
  return join(opencodeDataDir(), "memory", "memory.db");
}

// opencode 配置目录（遵循 XDG_CONFIG_HOME）
function opencodeConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config"), "opencode");
}

// 读取独立配置文件（可选；.jsonc 优先，.json 兜底）。文件不存在则忽略，读取/解析失败显式报错。
function readConfigFile(): Record<string, unknown> {
  for (const name of ["opencode-memory.jsonc", "opencode-memory.json"]) {
    const p = join(opencodeConfigDir(), name);
    let raw: string;
    try {
      raw = readFileSync(p, "utf8");
    } catch (e: any) {
      if (e?.code === "ENOENT") continue; // 文件不存在，尝试下一个
      throw new Error(`[opencode-memory] failed to read config ${p}: ${e?.message}`);
    }
    const errors: unknown[] = [];
    const parsed = parseJsonc(raw, errors);
    if (errors.length > 0) {
      throw new Error(`[opencode-memory] failed to parse config ${p}: ${printParseErrorCode((errors[0] as any)?.error)}`);
    }
    return parsed as Record<string, unknown>;
  }
  return {};
}

export default async function opencodeMemory(input: any, options: Record<string, unknown> = {}) {
  const client = input?.client;
  const fileConfig = readConfigFile();
  // 合并文件配置与 tuple options，统一严格校验（options 覆盖文件配置）
  const config = ConfigSchema.safeParse({ ...fileConfig, ...options });
  if (!config.success) {
    throw new Error(
      `[opencode-memory] invalid config: ${config.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
    );
  }
  const dbPath = config.data.dbPath ?? defaultDbPath();
  const pinQuota = config.data.pinQuota ?? PIN_QUOTA_DEFAULT;
  const store = new SqliteMemoryStore(dbPath);
  console.log(`[opencode-memory] loaded, db=${dbPath}`);

  return {
    tool: {
      memory_store: {
        description:
          "存储一条长期记忆（个人偏好、环境事实、决策、经验教训等）。适合记下将来要复用、跨会话保留的知识。",
        args: {
          title: z.string().min(1).max(200).describe("简短标题"),
          content: z.string().min(1).max(50000).describe("有厚度的知识内容，一段话讲清主题"),
          type: z
            .enum(["preference", "fact", "decision", "solution", "convention"])
            .default("fact")
            .describe("记忆类型"),
          tags: z.array(z.string()).default([]).describe("标签"),
        },
        async execute(args: { title: string; content: string; type: string; tags: string[] }) {
          const e = store.create({
            scope: SCOPE,
            scopeKey: SCOPE_KEY,
            origin: "user",
            trust: "high",
            title: args.title,
            content: args.content,
            type: args.type,
            tags: args.tags,
          });
          return `已记住 (id=${e.id}) ${e.title}`;
        },
      },

      memory_recall: {
        description: "检索已存的记忆（全文/关键词）。有 query 无匹配返回空，绝不返回无关条目。",
        args: { query: z.string().trim().min(1).describe("检索词或问题") },
        async execute(args: { query: string }) {
          const hits = store.search(args.query, { scope: SCOPE, scopeKey: SCOPE_KEY, limit: 10 });
          if (hits.length === 0) return "无匹配记忆。";
          const lines = hits.map((h) => {
            const e = store.get(h.id);
            return e ? `- [id=${e.id}] ${e.title}\n    ${e.content.slice(0, 200)}` : "";
          });
          return lines.join("\n\n");
        },
      },

      memory_ls: {
        description: "列出已存的记忆条目（按更新时间倒序）。",
        args: { limit: z.number().int().min(1).max(200).default(20).describe("最多返回条数") },
        async execute(args: { limit: number }) {
          const list = store.listByScope(SCOPE, SCOPE_KEY, { limit: args.limit });
          if (list.length === 0) return "（空）";
          return list.map((e) => `[id=${e.id}] ${e.title} (${e.type})`).join("\n");
        },
      },

      memory_read: {
        description: "按 id 读取某条记忆的完整内容。",
        args: { id: z.number().describe("记忆 id") },
        async execute(args: { id: number }) {
          const e = store.get(args.id);
          if (!e) return `未找到 id=${args.id}`;
          if (e.deletedAt != null) return `记忆 id=${args.id} 已删除`;
          return `[id=${e.id}] ${e.title}\n${e.content}`;
        },
      },

      memory_forget: {
        description: "删除一条记忆（软删；删除后不再出现在列表和检索结果中）。",
        args: { id: z.number().describe("记忆 id") },
        async execute(args: { id: number }) {
          return store.softDelete(args.id) ? `已删除 id=${args.id}` : `未找到 id=${args.id}`;
        },
      },

      memory_pin: {
        description:
          "固定/取消固定一条记忆。固定后每轮自动注入上下文。pinMode=summary 时只注入一行摘要（需提供 summary），pinMode=full 注入全文。受配额限制，超额会拒绝。",
        args: {
          id: z.number().int().positive().describe("记忆 id"),
          pinned: z.boolean().describe("true=固定，false=取消固定"),
          pinMode: z.enum(["full", "summary"]).default("summary").describe("固定模式"),
          summary: z.string().optional().describe("summary 模式下的摘要（不提供则用记忆已有的 summary）"),
        },
        async execute(args: { id: number; pinned: boolean; pinMode: "full" | "summary"; summary?: string }) {
          const entry = store.get(args.id);
          if (!entry) return `未找到 id=${args.id}`;
          if (entry.deletedAt != null) return `记忆 id=${args.id} 已删除`;

          if (!args.pinned) {
            const u = store.updateMeta(args.id, { pinnedAt: null });
            return u ? `已取消固定 id=${args.id}` : `未找到 id=${args.id}`;
          }

          const summary = args.summary ?? entry.summary;
          if (args.pinMode === "summary" && !summary.trim()) {
            return "summary 模式需要提供 summary（当前记忆也没有 summary）。要么给 summary，要么用 full 模式。";
          }
          const r = store.pinWithinQuota(args.id, args.pinMode, summary, pinQuota);
          if (!r.ok) {
            return `超出 pin 配额（${r.size}/${pinQuota} 字符）。请改 summary 模式，或先取消固定其他记忆。`;
          }
          return `已固定 id=${args.id} (${args.pinMode})`;
        },
      },

      memory_pins: {
        description: "列出当前固定的记忆（每轮自动注入上下文的）。",
        args: {},
        async execute() {
          const pinned = store.listPinned(SCOPE, SCOPE_KEY);
          if (pinned.length === 0) return "（无固定记忆）";
          return pinned.map((e) => `[id=${e.id}] ${e.title} (${e.pinMode})`).join("\n");
        },
      },

      recall_summaries: {
        description: "检索历史会话的归档摘要（情景记忆，跨会话可搜）。",
        args: { query: z.string().trim().min(1).describe("检索词") },
        async execute(args: { query: string }) {
          const results = store.searchSummaries(args.query, 10);
          if (results.length === 0) return "无匹配摘要。";
          return results.map((r) => `- [${r.id.slice(0, 8)}] ${r.summaryText.slice(0, 200)}`).join("\n\n");
        },
      },

      kv_set: {
        description: "存一个会话级键值（仅当前会话可见的临时信息，如某个开发需求的细节）。",
        args: { key: z.string().min(1).describe("键"), value: z.string().describe("值") },
        async execute(args: { key: string; value: string }, context: any) {
          store.setKv(context.sessionID, args.key, args.value);
          return `已存 kv: ${args.key}`;
        },
      },

      kv_get: {
        description: "读会话级键值。",
        args: { key: z.string().min(1).describe("键") },
        async execute(args: { key: string }, context: any) {
          const v = store.getKv(context.sessionID, args.key);
          return v ?? `（无 ${args.key}）`;
        },
      },

      kv_list: {
        description: "列出当前会话的所有键值。",
        args: {},
        async execute(_args: {}, context: any) {
          const all = store.listKv(context.sessionID);
          const keys = Object.keys(all);
          if (keys.length === 0) return "（空）";
          return keys.map((k) => `- ${k}: ${all[k]}`).join("\n");
        },
      },

      kv_del: {
        description: "删除会话级键值。",
        args: { key: z.string().min(1).describe("键") },
        async execute(args: { key: string }, context: any) {
          return store.deleteKv(context.sessionID, args.key) ? `已删 ${args.key}` : `（无 ${args.key}）`;
        },
      },
    },

    // overlay 自动注入：固定记忆塞进消息末尾（ephemeral，仅主模型，不落历史）
    "experimental.chat.messages.transform": async (_input: any, output: any) => {
      try {
        if (!Array.isArray(output?.messages) || output.messages.length === 0) return;
        const pinned = store.listPinned(SCOPE, SCOPE_KEY);
        if (pinned.length === 0) return;
        const text = renderPinnedBlock(pinned);
        const sessionId = output.messages[0]?.info?.sessionID ?? null;
        const markerId = "msg_mem_" + Date.now();
        output.messages.push({
          info: {
            id: markerId,
            role: "user",
            sessionID: sessionId,
            time: { created: Date.now() },
          },
          parts: [
            {
              type: "text",
              text,
              id: "prt_mem_" + Date.now(),
              sessionID: sessionId,
              messageID: markerId,
            },
          ],
        });
      } catch (e) {
        console.error("[opencode-memory] overlay error:", e);
      }
    },

    // 自动归档：会话压缩后，把 compaction 摘要存入情景记忆（session_summaries）
    event: async ({ event }: any) => {
      if (event?.type !== "session.compacted") return;
      const sid = event.properties?.sessionID;
      if (!sid || !client) return;
      try {
        const m = await client.session.messages({ path: { id: sid } });
        const messages = m?.data ?? [];
        for (const msg of messages) {
          if (msg?.info?.agent === "compaction" || msg?.info?.mode === "compaction") {
            const textPart = (msg.parts ?? []).find((p: any) => p.type === "text");
            if (textPart?.text) {
              store.archiveSummary({
                id: msg.info.id,
                sessionId: sid,
                summaryText: textPart.text,
                createdAt: Date.now(),
              });
            }
          }
        }
      } catch (e) {
        console.error("[opencode-memory] archive error:", e);
      }
    },

    async dispose() {
      store.close();
    },
  };
}
