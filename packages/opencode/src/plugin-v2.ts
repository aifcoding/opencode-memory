import { z } from 'zod';
import type { PluginInput, ToolContext } from '@opencode-ai/plugin';
import { v1Plugin } from './plugin-v1';

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

function eventSessionID(event: any): string | undefined {
  return (
    event?.properties?.sessionID ??
    event?.sessionID ??
    event?.data?.sessionID ??
    event?.properties?.sessionId
  );
}

function createV2Client(ctx: V2Context, messageCache: Map<string, any[]>) {
  return {
    session: {
      async messages({ path }: { path: { id: string } }) {
        const cached = messageCache.get(path.id);
        if (cached?.length) return { data: cached };
        const messages = await ctx.session.context({ sessionID: path.id });
        return { data: toV1Messages(messages) };
      },
      async create() {
        const session = await ctx.session.create({ title: 'memory-capture' });
        return { data: session };
      },
      async prompt({ path, body }: { path: { id: string }; body?: any }) {
        const text = textFromParts(body?.parts);
        if (body?.agent) {
          await ctx.session.switchAgent({ sessionID: path.id, agent: body.agent });
        }
        // v2 的 session.prompt 返回 inbox 用户消息，不是助手回复；
        // 临时生成用 session.generate，正好满足“全新空会话提取”。
        const generated = await ctx.session.generate({ sessionID: path.id, prompt: text });
        return { data: { parts: [{ type: 'text', text: generated.text }] } };
      },
      async delete({ path }: { path: { id: string } }) {
        await ctx.session.remove({ sessionID: path.id });
        return { data: true };
      },
    },
    app: {
      async log({ body }: { body?: any }) {
        console.error(`[opencode-memory] ${body?.message ?? ''}`, body?.extra ?? '');
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

export async function v2Setup(ctx: V2Context) {
  const messageCache = new Map<string, any[]>();
  const input = { client: createV2Client(ctx, messageCache) } as unknown as PluginInput;
  const hooks = (await v1Plugin(input, (ctx.options ?? {}) as Record<string, unknown>)) as V1Hooks;
  const anyHooks = hooks as any;

  await ctx.tool.transform((editor: any) => {
    for (const [name, tool] of Object.entries((hooks.tool ?? {}) as Record<string, any>)) {
      const schema = toolSchema(tool.args);
      editor.add({
        name,
        description: tool.description,
        input: z.toJSONSchema(schema),
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
  });

  const controller = new AbortController();
  if (anyHooks.event) {
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event?.type !== 'session.compaction.ended') continue;
          const sessionID = eventSessionID(event);
          if (!sessionID) continue;
          // 归档必须读压缩后的最新消息，不能命中压缩前的缓存。
          messageCache.delete(sessionID);
          // v1 的归档逻辑监听 session.compacted；v2 对应 compaction.ended。
          await anyHooks.event({
            event: { type: 'session.compacted', properties: { sessionID } },
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[opencode-memory] v2 event bridge failed', error);
        }
      }
    })();
  }

  return async () => {
    controller.abort();
    await anyHooks.dispose?.();
  };
}
