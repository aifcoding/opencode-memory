import { z } from 'zod';
import type { PluginInput, ToolContext } from '@opencode-ai/plugin';
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
import { ConfigSchema, defaultDbPath, readConfigFile, v1Plugin } from './plugin-v1';
import { lastUserText, runAutoMemory, type AutoMemoryConfig } from './context/auto-memory';
import { captureMaterials } from './context/material';

/**
 * v2 宿主适配器。
 *
 * 复用 v1 插件实现：构造一个 v1 兼容的 client（session/app/tui），
 * 让 v1Plugin 返回原有 hooks，再把这些 hooks 翻译成 v2 的
 * tool.transform / session.hook("context") / event.subscribe。
 *
 * 这里刻意不 import @opencode/plugin 的运行时：v2 loader 接受普通
 * { id, setup } 对象（Plugin.define 只是 identity），这样 v1 进程
 * 不会因为加载入口而被迫加载 v2 SDK。
 */
type V2Context = {
  options: Record<string, unknown>;
  tool: {
    transform: (fn: (editor: any) => void) => Promise<unknown> | unknown;
  };
  session: {
    hook: (name: string, fn: (event: any) => Promise<void> | void) => Promise<unknown> | unknown;
    update: (input: { sessionID: string; permissions?: unknown; title?: string }) => Promise<unknown>;
    switchModel: (input: { sessionID: string; model: unknown }) => Promise<unknown>;
    context: (input: { sessionID: string }) => Promise<any[]>;
    create: (input: { title?: string }) => Promise<any>;
    switchAgent: (input: { sessionID: string; agent: string }) => Promise<unknown>;
    generate: (input: { sessionID: string; prompt: string }) => Promise<{ text: string }>;
    remove: (input: { sessionID: string }) => Promise<unknown>;
  };
  event: {
    subscribe: (input?: { signal?: AbortSignal }) => AsyncIterable<any>;
  };
};

type V1Hooks = Awaited<ReturnType<typeof v1Plugin>>;

function textFromParts(parts: any): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part && typeof part === 'object' && part.type === 'text')
    .map((part) => String(part.text ?? ''))
    .join('\n');
}

// v2 的模型消息是 AI SDK 风格（role + content[]），v1 的 capture/归档
// 逻辑用的是 { info, parts }。这里做一层转换，复用 v1 的过滤/归档代码。
function toV1Messages(messages: any[]): any[] {
  return (messages ?? []).map((message) => {
    const info = message?.info ?? message ?? {};
    const rawParts = message?.parts ?? message?.content ?? [];
    const parts = Array.isArray(rawParts)
      ? rawParts.map((part: any) => ({ ...part, type: part?.type, text: part?.text }))
      : [{ type: 'text', text: String(rawParts ?? '') }];
    return { info, parts };
  });
}

const seenCompactionEvents = new Set<string>();
function eventSessionID(event: any): string | undefined {
  return (
    event?.properties?.sessionID ??
    event?.sessionID ??
    event?.data?.sessionID ??
    event?.properties?.sessionId
  );
}

function createV2Client(
  ctx: V2Context,
  messageCache: Map<string, any[]>,
  captureSessions: Set<string>,
) {
  return {
    session: {
      /** v2 结构化消息（带 type/metadata），供来源准入使用。 */
      async typedContext({ path }: { path: { id: string } }) {
        return ctx.session.context({ sessionID: path.id });
      },
      async messages({ path }: { path: { id: string } }) {
        const cached = messageCache.get(path.id);
        if (cached?.length) return { data: cached };
        const messages = await ctx.session.context({ sessionID: path.id });
        return { data: toV1Messages(messages) };
      },
      async update({ path, body }: { path: { id: string }; body?: any }) {
        return ctx.session.update({ sessionID: path.id, ...(body ?? {}) });
      },
      async switchModel({ path, body }: { path: { id: string }; body?: any }) {
        return ctx.session.switchModel({ sessionID: path.id, model: body?.model });
      },
      async create() {
        const session = await ctx.session.create({ title: 'memory-capture' });
        if (session?.id) captureSessions.add(session.id);
        return { data: session };
      },
      async prompt({ path, body }: { path: { id: string }; body?: any }) {
        const text = textFromParts(body?.parts);
        if (body?.agent) {
          await ctx.session.switchAgent({ sessionID: path.id, agent: body.agent });
        }
        // v2 的 session.prompt 返回 inbox 用户消息，不是助手回复；
        // 临时生成用 session.generate，正好满足“全新空会话提取”。
        // 超时短于租约（120s）；超时先中断再返回，避免压缩事件被永久挂住。
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('generator_timeout')), 60_000);
        });
        let generated: { text: string };
        try {
          generated = await Promise.race([
            ctx.session.generate({ sessionID: path.id, prompt: text }),
            timeout,
          ]);
        } catch (error) {
          if (error instanceof Error && error.message === 'generator_timeout') {
            await (ctx.session as any).interrupt?.({ sessionID: path.id }).catch?.(() => undefined);
          }
          throw error;
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (typeof generated.text !== 'string') throw new Error('extractor_no_text');
        if (generated.text.length > 400_000) throw new Error('generator_response_too_large');
        return { data: { parts: [{ type: 'text', text: generated.text }] } };
      },
      async delete({ path }: { path: { id: string } }) {
        // 删除成功后才移除隔离标记；失败时保留标记，避免残留会话被自动采集。
        await ctx.session.remove({ sessionID: path.id });
        captureSessions.delete(path.id);
        return { data: true };
      },
    },
    app: {
      async log({ body }: { body?: any }) {
        console.error(`[agent-memory] ${body?.message ?? ''}`, body?.extra ?? '');
      },
    },
    tui: {
      async showToast() {
        /* v2 server 没有 TUI toast；错误走 app.log / console */
      },
    },
  };
}

function toolSchema(args: unknown): z.ZodObject<z.ZodRawShape> {
  return z.object((args && typeof args === 'object' ? args : {}) as z.ZodRawShape);
}

// Zod 的 .default() 在 toJSONSchema 里仍会进 required；v2 在进入我们的
// schema.parse 之前就按 JSON Schema 校验，导致“省略带默认值的字段”被拒。
// 这里把带 default 的字段从 required 移除，默认值仍由 schema.parse 补上。
function jsonSchema(schema: z.ZodObject<z.ZodRawShape>) {
  const json = z.toJSONSchema(schema) as any;
  if (Array.isArray(json?.required) && json.properties && typeof json.properties === 'object') {
    json.required = json.required.filter(
      (key: string) => !(json.properties[key] && 'default' in json.properties[key]),
    );
  }
  return json;
}

export async function v2Setup(ctx: V2Context) {
  const messageCache = new Map<string, any[]>();
  const captureSessions = new Set<string>();
  // 待审候选提示：同一会话同一数量只提示一次，避免每轮刷屏。
  const pendingNotice = new Map<string, number>();
  const input = {
    client: createV2Client(ctx, messageCache, captureSessions),
  } as unknown as PluginInput;
  const hooks = (await v1Plugin(input, (ctx.options ?? {}) as Record<string, unknown>)) as V1Hooks;
  const anyHooks = hooks as any;

  const parsedConfig = ConfigSchema.safeParse({
    ...readConfigFile(),
    ...((ctx.options ?? {}) as Record<string, unknown>),
  });
  const autoManager = parsedConfig.success
    ? createSqliteMemoryManager({
        dbPath: parsedConfig.data.dbPath ?? defaultDbPath(),
        pinQuota: parsedConfig.data.pinQuota,
      })
    : undefined;
  const autoConfig: AutoMemoryConfig | undefined = parsedConfig.success
    ? { capture: parsedConfig.data.autoCapture, recall: parsedConfig.data.autoRecall }
    : undefined;

  const globalScope = { scope: 'global' as const, scopeKey: 'default' };
  // 与现有工具和记忆统一使用 global/default：保证自动写入的记忆能被 memory_forget 管理。
  // 项目隔离后续用 tags 表达（未实现）。
  const projectScope = globalScope;

  await ctx.tool.transform((editor: any) => {
    for (const [name, tool] of Object.entries((hooks.tool ?? {}) as Record<string, any>)) {
      const schema = toolSchema(tool.args);
      editor.add({
        name,
        description: tool.description,
        input: jsonSchema(schema),
        async execute(args: any, context: any) {
          const parsed = schema.parse(args ?? {});
          const result = await tool.execute(parsed, {
            sessionID: context.sessionID,
            messageID: context.messageID,
          } as ToolContext);
          return {
            content: [
              { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
            ],
          };
        },
      });
    }
  });

  const transform = anyHooks['experimental.chat.messages.transform'];
  await ctx.session.hook('context', async (event: any) => {
    // 先缓存未注入 Pin 的原始消息，供 capture 使用；简单上限防止长跑服务膨胀。
    if (!messageCache.has(event.sessionID) && messageCache.size >= 100) {
      const oldest = messageCache.keys().next().value;
      if (oldest) messageCache.delete(oldest);
    }
    messageCache.set(event.sessionID, toV1Messages(event.messages));
    if (!transform) return;
    // v1 transform 会往 output.messages 里 push 一条 { info, parts } 消息；
    // 不能直接塞进 v2 的 AI 消息数组，否则运行时会对 undefined content 调 map。
    const fake: any = { messages: [{ info: { sessionID: event.sessionID }, parts: [] }] };
    await transform({}, fake);
    const pinMessage = fake.messages[fake.messages.length - 1];
    const text = pinMessage?.parts?.find((part: any) => part.type === 'text')?.text;
    if (text) {
      event.messages.push({ role: 'user', content: [{ type: 'text', text }] });
    }
    if (autoManager && autoConfig) {
      try {
        const pinned = await autoManager.getPinnedContext({ scope: globalScope });
        // 规则采集只吃「结构化的作者身份」：宿主 type/metadata，不信 role。
        let materials;
        if (autoConfig.capture.enabled) {
          try {
            const typed = await ctx.session.context({ sessionID: event.sessionID });
            materials = captureMaterials(typed ?? []);
          } catch (error) {
            console.error('[agent-memory] capture materials failed', error);
          }
        }
        const outcome = await runAutoMemory({
          manager: autoManager,
          config: autoConfig,
          scope: projectScope,
          globalScope,
          sessionID: event.sessionID,
          messages: event.messages,
          materials,
          excludeIds: pinned.entries.map((entry) => entry.id),
          skipSessionIDs: captureSessions,
        });
        if (outcome.inject) {
          event.messages.push({ role: 'user', content: [{ type: 'text', text: outcome.inject }] });
        }
        if (outcome.pending === 0) {
          pendingNotice.delete(event.sessionID);
        } else if (pendingNotice.get(event.sessionID) !== outcome.pending) {
          pendingNotice.set(event.sessionID, outcome.pending);
          event.messages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `<mem_block role="reference" source="memory-pending">有 ${outcome.pendingCapped ? '至少 ' : ''}${outcome.pending} 条候选记忆待审批：在 TUI 运行 /memory-candidates 查看，/memory-review approve 12,13 处理；也可让助手调用 memory_candidates。候选未批准前不参与召回。</mem_block>`,
              },
            ],
          });
        }
      } catch (error) {
        console.error('[agent-memory] auto memory failed', error);
      }
    }
  });

  const controller = new AbortController();
  if (anyHooks.event) {
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          // v2 宿主实际发 session.compaction.ended（types.gen.d.ts）；旧名
          // session.compaction.* 一并兼容。
          if (
            typeof event?.type !== 'string' ||
            !event.type.startsWith('session.compaction.')
          ) {
            continue;
          }
          if (!event.type.endsWith('.ended')) continue;
          const sessionID = eventSessionID(event);
          if (!sessionID) continue;
          // 宿主会把同一事件重复广播给多个订阅者，按 event.id 去重。
          const eventId = typeof event?.id === 'string' ? event.id : '';
          if (eventId) {
            if (seenCompactionEvents.has(eventId)) continue;
            seenCompactionEvents.add(eventId);
            if (seenCompactionEvents.size > 500) {
              const oldest = seenCompactionEvents.values().next().value;
              if (oldest) seenCompactionEvents.delete(oldest);
            }
          }
          // 归档必须读压缩后的最新消息，不能命中压缩前的缓存。
          messageCache.delete(sessionID);
          // v2 的 compaction 消息没有 agent/parts，摘要就在事件 payload 的 data.text 里；
          // 直接透传给 v1 处理器，避免靠遍历消息猜测。
          const summaryText = typeof event?.data?.text === 'string' ? event.data.text : undefined;
          const createdAt =
            typeof event?.created === 'number'
              ? event.created
              : typeof event?.data?.timestamp === 'number'
                ? event.data.timestamp
                : Date.now();
          await anyHooks.event({
            event: {
              type: 'session.compacted',
              properties: {
                sessionID,
                ...(summaryText
                  ? {
                      summaryText,
                      summaryId: `${sessionID}:compaction:${createdAt}`,
                      summaryCreatedAt: createdAt,
                    }
                  : {}),
              },
            },
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[agent-memory] v2 event bridge failed', error);
        }
      }
    })();
  }

  return async () => {
    controller.abort();
    await autoManager?.close();
    await anyHooks.dispose?.();
  };
}
