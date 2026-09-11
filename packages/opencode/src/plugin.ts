import { z } from 'zod';
import { join, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import type { Plugin, PluginInput, ToolContext } from '@opencode-ai/plugin';
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';

// 默认个人单机：global 作用域单一记忆池，origin=user / trust=high。
// 团队化时需引入 D7 严格分级（低信任内容不自动注入）。
const DEFAULT_MEMORY_SCOPE = { scope: 'global', scopeKey: 'default' } as const;
const DEFAULT_PIN_QUOTA = 8000;

const ConfigSchema = z
  .object({
    dbPath: z.string().min(1).refine(isAbsolute, 'dbPath 必须是绝对路径').optional(),
    pinQuota: z.number().int().positive().optional(),
  })
  .strict();

// opencode 数据根目录（与 session db 同根）：macOS/Linux 为 ~/.local/share/opencode
function opencodeDataDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? '', '.local', 'share');
  return join(base, 'opencode');
}

// 默认数据库位置：opencode 数据根下的 memory/ 子目录（与 opencode 自身的 log/、storage/ 等子目录一致）
function defaultDbPath(): string {
  return join(opencodeDataDir(), 'memory', 'memory.db');
}

// opencode 配置目录（遵循 XDG_CONFIG_HOME）
function opencodeConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '', '.config'), 'opencode');
}

// 读取独立配置文件（可选；.jsonc 优先，.json 兜底）。文件不存在则忽略，读取/解析失败显式报错。
function readConfigFile(): Record<string, unknown> {
  for (const name of ['opencode-memory.jsonc', 'opencode-memory.json']) {
    const configPath = join(opencodeConfigDir(), name);
    let raw: string;
    try {
      raw = readFileSync(configPath, 'utf8');
    } catch (error) {
      if ((error as { code?: string })?.code === 'ENOENT') continue; // 文件不存在，尝试下一个
      throw new Error(
        `[opencode-memory] failed to read config ${configPath}: ${(error as Error)?.message}`,
      );
    }
    const errors: ParseError[] = [];
    const parsed = parseJsonc(raw, errors);
    if (errors.length > 0) {
      throw new Error(
        `[opencode-memory] failed to parse config ${configPath}: ${printParseErrorCode(errors[0].error)}`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`[opencode-memory] failed to parse config ${configPath}: expected an object`);
    }
    return parsed as Record<string, unknown>;
  }
  return {};
}

// 通过 opencode 官方 app.log 写服务端日志，避免 console.* 污染 TUI 消息区
function logError(client: PluginInput['client'], message: string, error: unknown) {
  if (!client) return;
  client.app
    .log({
      body: {
        service: 'opencode-memory',
        level: 'error',
        message,
        extra: { error: error instanceof Error ? error.message : String(error) },
      },
    })
    .catch(() => {
      // 日志失败不影响主流程
    });
}

const plugin: Plugin = async (input: PluginInput, options: Record<string, unknown> = {}) => {
  const client = input.client;
  const fileConfig = readConfigFile();
  // 合并文件配置与 tuple options，统一严格校验（options 覆盖文件配置）
  const config = ConfigSchema.safeParse({ ...fileConfig, ...options });
  if (!config.success) {
    throw new Error(
      `[opencode-memory] invalid config: ${config.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    );
  }
  const dbPath = config.data.dbPath ?? defaultDbPath();
  const pinQuota = config.data.pinQuota ?? DEFAULT_PIN_QUOTA;
  const manager = createSqliteMemoryManager({ dbPath, pinQuota });

  return {
    tool: {
      memory_store: {
        description:
          '存储一条长期记忆（个人偏好、环境事实、决策、经验教训等）。适合记下将来要复用、跨会话保留的知识。',
        args: {
          title: z.string().min(1).max(200).describe('简短标题'),
          content: z.string().min(1).max(50000).describe('有厚度的知识内容，一段话讲清主题'),
          type: z
            .enum(['preference', 'fact', 'decision', 'solution', 'convention'])
            .default('fact')
            .describe('记忆类型'),
          tags: z.array(z.string()).default([]).describe('标签'),
        },
        async execute(args: { title: string; content: string; type: string; tags: string[] }) {
          const memory = await manager.storeMemory({
            scope: DEFAULT_MEMORY_SCOPE,
            origin: 'user',
            trust: 'high',
            title: args.title,
            content: args.content,
            type: args.type as 'preference' | 'fact' | 'decision' | 'solution' | 'convention',
            tags: args.tags,
          });
          return `已记住 (id=${memory.id}) ${memory.title}`;
        },
      },

      memory_recall: {
        description: '检索已存的记忆（全文/关键词）。有 query 无匹配返回空，绝不返回无关条目。',
        args: { query: z.string().trim().min(1).describe('检索词或问题') },
        async execute(args: { query: string }) {
          const result = await manager.recallMemories({
            query: args.query,
            scope: DEFAULT_MEMORY_SCOPE,
            limit: 10,
          });
          if (result.memories.length === 0) return '无匹配记忆。';
          const lines = result.memories.map(
            ({ memory }) =>
              `- [id=${memory.id}] ${memory.title}\n    ${memory.content.slice(0, 200)}`,
          );
          return lines.join('\n\n');
        },
      },

      memory_ls: {
        description: '列出已存的记忆条目（按更新时间倒序）。',
        args: { limit: z.number().int().min(1).max(200).default(20).describe('最多返回条数') },
        async execute(args: { limit: number }) {
          const list = await manager.listMemories({
            scope: DEFAULT_MEMORY_SCOPE,
            limit: args.limit,
          });
          if (list.length === 0) return '（空）';
          return list
            .map((memory) => `[id=${memory.id}] ${memory.title} (${memory.type})`)
            .join('\n');
        },
      },

      memory_read: {
        description: '按 id 读取某条记忆的完整内容。',
        args: { id: z.number().describe('记忆 id') },
        async execute(args: { id: number }) {
          const result = await manager.readMemory({ id: args.id });
          if (result.status === 'not_found') return `未找到 id=${args.id}`;
          if (result.status === 'deleted') return `记忆 id=${args.id} 已删除`;
          return `[id=${result.memory.id}] ${result.memory.title}\n${result.memory.content}`;
        },
      },

      memory_forget: {
        description: '删除一条记忆（软删；删除后不再出现在列表和检索结果中）。',
        args: { id: z.number().describe('记忆 id') },
        async execute(args: { id: number }) {
          const result = await manager.forgetMemory({ id: args.id });
          return result.status === 'deleted' ? `已删除 id=${args.id}` : `未找到 id=${args.id}`;
        },
      },

      memory_pin: {
        description:
          '固定/取消固定一条记忆。固定后每轮自动注入上下文。pinMode=summary 时只注入一行摘要（需提供 summary），pinMode=full 注入全文。受配额限制，超额会拒绝。',
        args: {
          id: z.number().int().positive().describe('记忆 id'),
          pinned: z.boolean().describe('true=固定，false=取消固定'),
          pinMode: z.enum(['full', 'summary']).default('summary').describe('固定模式'),
          summary: z
            .string()
            .optional()
            .describe('summary 模式下的摘要（不提供则用记忆已有的 summary）'),
        },
        async execute(args: {
          id: number;
          pinned: boolean;
          pinMode: 'full' | 'summary';
          summary?: string;
        }) {
          if (!args.pinned) {
            const unpinResult = await manager.unpinMemory({ id: args.id });
            return unpinResult.status === 'unpinned'
              ? `已取消固定 id=${args.id}`
              : unpinResult.status === 'deleted'
                ? `记忆 id=${args.id} 已删除`
                : `未找到 id=${args.id}`;
          }
          const pinResult = await manager.pinMemory({
            id: args.id,
            pinMode: args.pinMode,
            summary: args.summary,
          });
          switch (pinResult.status) {
            case 'not_found':
              return `未找到 id=${args.id}`;
            case 'deleted':
              return `记忆 id=${args.id} 已删除`;
            case 'summary_required':
              return 'summary 模式需要提供 summary（当前记忆也没有 summary）。要么给 summary，要么用 full 模式。';
            case 'trust_denied':
              return '该记忆为低信任内容，不能固定。';
            case 'quota_exceeded':
              return `超出 pin 配额（${pinResult.size}/${pinQuota} 字符）。请改 summary 模式，或先取消固定其他记忆。`;
            case 'pinned':
              return `已固定 id=${args.id} (${args.pinMode})`;
            default:
              throw new Error(`Unknown pin status: ${(pinResult as { status: string }).status}`);
          }
        },
      },

      memory_pins: {
        description: '列出当前固定的记忆（每轮自动注入上下文的）。',
        args: {},
        async execute() {
          const pinned = await manager.listPinnedMemories({ scope: DEFAULT_MEMORY_SCOPE });
          if (pinned.length === 0) return '（无固定记忆）';
          return pinned
            .map((memory) => `[id=${memory.id}] ${memory.title} (${memory.pinMode})`)
            .join('\n');
        },
      },

      recall_summaries: {
        description: '检索历史会话的归档摘要（情景记忆，跨会话可搜）。',
        args: { query: z.string().trim().min(1).describe('检索词') },
        async execute(args: { query: string }) {
          const result = await manager.recallSummaries({ query: args.query, limit: 10 });
          if (result.summaries.length === 0) return '无匹配摘要。';
          return result.summaries
            .map(({ summary }) => `- [${summary.id.slice(0, 8)}] ${summary.text.slice(0, 200)}`)
            .join('\n\n');
        },
      },

      kv_set: {
        description: '存一个会话级键值（仅当前会话可见的临时信息，如某个开发需求的细节）。',
        args: { key: z.string().min(1).describe('键'), value: z.string().describe('值') },
        async execute(args: { key: string; value: string }, context: ToolContext) {
          await manager.setContextValue({
            contextKey: context.sessionID,
            key: args.key,
            value: args.value,
          });
          return `已存 kv: ${args.key}`;
        },
      },

      kv_get: {
        description: '读会话级键值。',
        args: { key: z.string().min(1).describe('键') },
        async execute(args: { key: string }, context: ToolContext) {
          const value = await manager.getContextValue({
            contextKey: context.sessionID,
            key: args.key,
          });
          return value ?? `（无 ${args.key}）`;
        },
      },

      kv_list: {
        description: '列出当前会话的所有键值。',
        args: {},
        async execute(_args: {}, context: ToolContext) {
          const all = await manager.listContextValues({ contextKey: context.sessionID });
          const keys = Object.keys(all);
          if (keys.length === 0) return '（空）';
          return keys.map((k) => `- ${k}: ${all[k]}`).join('\n');
        },
      },

      kv_del: {
        description: '删除会话级键值。',
        args: { key: z.string().min(1).describe('键') },
        async execute(args: { key: string }, context: ToolContext) {
          const result = await manager.deleteContextValue({
            contextKey: context.sessionID,
            key: args.key,
          });
          return result.status === 'deleted' ? `已删 ${args.key}` : `（无 ${args.key}）`;
        },
      },
    },

    // overlay 自动注入：固定记忆塞进消息末尾（ephemeral，仅主模型，不落历史）
    'experimental.chat.messages.transform': async (_input, output) => {
      try {
        if (!Array.isArray(output?.messages) || output.messages.length === 0) return;
        const pinned = await manager.getPinnedContext({ scope: DEFAULT_MEMORY_SCOPE });
        if (pinned.entries.length === 0) return;
        const text = pinned.text;
        const sessionId = output.messages[0]?.info?.sessionID ?? null;
        const markerId = 'msg_mem_' + Date.now();
        output.messages.push({
          info: {
            id: markerId,
            role: 'user',
            sessionID: sessionId,
            time: { created: Date.now() },
          } as any, // 合成注入消息，非真实 agent/model，运行时 opencode 不要求这两个字段
          parts: [
            {
              type: 'text',
              text,
              id: 'prt_mem_' + Date.now(),
              sessionID: sessionId,
              messageID: markerId,
            },
          ],
        });
      } catch (error) {
        logError(client, 'Pinned-memory overlay failed', error);
      }
    },

    // 自动归档：会话压缩后，把 compaction 摘要存入情景记忆（session_summaries）
    event: async ({ event }) => {
      if (event.type !== 'session.compacted') return;
      const sessionId = event.properties?.sessionID;
      if (!sessionId || !client) return;
      try {
        const messagesResponse = await client.session.messages({ path: { id: sessionId } });
        const messages = messagesResponse?.data ?? [];
        for (const msg of messages) {
          const info = msg.info as { agent?: string; mode?: string };
          if (info.agent === 'compaction' || info.mode === 'compaction') {
            const textPart = (msg.parts ?? []).find((p) => p.type === 'text');
            if (textPart && textPart.type === 'text' && textPart.text) {
              await manager.archiveSummary({
                id: msg.info.id,
                contextKey: sessionId,
                text: textPart.text,
                createdAt: msg.info.time?.created ?? Date.now(),
              });
            }
          }
        }
      } catch (error) {
        logError(client, 'Session compaction archive failed', error);
      }
    },

    async dispose() {
      await manager.close();
    },
  };
};

export default plugin;
