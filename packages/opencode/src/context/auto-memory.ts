import { createHash } from 'node:crypto';
import {
  AUTO_RECALL_HINT,
  AutoCaptureService,
  AutoRecallService,
  isReferenceRequest,
  type AutoCaptureConfig,
  type AutoRecallConfig,
  type MemoryManager,
  type ScopeRef,
} from '@aifcoding/memory-core';

interface ChatMessage {
  role?: string;
  content?: unknown;
}

function textOf(message: ChatMessage): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: any) => part && part.type === 'text')
    .map((part: any) => String(part.text ?? ''))
    .join('\n');
}

/** 宿主/子 agent 注入的整块内容；剥离后剩下的才是用户真实输入。 */
const SYNTHETIC_BLOCK =
  /<(mem_block|system-reminder|background-result|fork-notice|subagent-update)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** 剥离注入块，而不是因为消息里含注入块就整条丢弃。 */
export function stripSynthetic(text: string): string {
  return text
    .replace(SYNTHETIC_BLOCK, ' ')
    .replace(/<!--\s*SLIM_INTERNAL_INITIATOR\s*-->/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SYSTEM_PROMPT_SHAPE = /^\s*You are (?:a|an) /i;

/** 最后一条真实用户消息：剥离注入块后仍有内容才算。 */
export function lastUserText(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const text = stripSynthetic(textOf(message));
    if (!text) continue;
    if (SYSTEM_PROMPT_SHAPE.test(text) && text.length > 200) continue;
    if (text.startsWith('# ') && text.length > 200) continue;
    return text;
  }
  return undefined;
}

function lastAssistantText(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const text = stripSynthetic(textOf(message));
    if (text) return text;
  }
  return undefined;
}

/**
 * 依赖指纹：取最近一条工具结果作为"执行中新依赖"的代理。
 * 工具循环里出现新结果 → 指纹变化 → 缓存失效并重查（架构师要求）。
 */
export function dependencyKey(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'tool') continue;
    const text = textOf(message);
    if (!text) continue;
    return createHash('sha256').update(text).digest('hex').slice(0, 12);
  }
  return '';
}

export interface AutoMemoryConfig {
  capture: AutoCaptureConfig;
  recall: AutoRecallConfig;
}

export interface AutoMemoryInput {
  manager: MemoryManager;
  config: AutoMemoryConfig;
  scope: ScopeRef;
  globalScope?: ScopeRef;
  sessionID: string;
  messages: ChatMessage[];
  excludeIds?: number[];
  /** 提取会话等不应参与自动记忆的会话。 */
  skipSessionIDs?: ReadonlySet<string>;
}

export interface AutoMemoryResult {
  inject?: string;
  captured: number;
  recalled: number;
}

const CURSOR_KEY = 'auto:cursor';
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

interface CacheEntry {
  text?: string;
  recalled: number;
  expiresAt: number;
}

const recallCache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const entry = recallCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    recallCache.delete(key);
    return undefined;
  }
  return entry;
}

function cacheSet(key: string, entry: CacheEntry): void {
  if (recallCache.size >= CACHE_MAX) {
    const oldest = recallCache.keys().next().value;
    if (oldest) recallCache.delete(oldest);
  }
  recallCache.set(key, entry);
}

/** 测试用：清空进程内召回缓存。 */
export function resetAutoMemoryCache(): void {
  recallCache.clear();
}

/**
 * 每次模型请求前执行：按游标增量采集最后一条真实用户消息，按模式决定是否注入。
 * 调用方必须自行 try/catch：本函数抛错会打断宿主请求。
 */
export async function runAutoMemory(input: AutoMemoryInput): Promise<AutoMemoryResult> {
  const result: AutoMemoryResult = { captured: 0, recalled: 0 };
  if (input.skipSessionIDs?.has(input.sessionID)) return result;

  // 子会话的 user 消息是 agent 指令，不是用户输入；采集/召回都会造成自我污染。
  const isSubagent = input.messages.some(
    (message) =>
      message?.role === 'user' &&
      textOf(message).includes('You are a subagent spawned by another session'),
  );
  if (isSubagent) return result;

  const text = lastUserText(input.messages);
  if (!text) return result;

  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);

  let createdIds: number[] = [];
  if (input.config.capture.enabled) {
    try {
      const previous = await input.manager.getContextValue({
        contextKey: input.sessionID,
        key: CURSOR_KEY,
      });
      if (previous !== hash) {
        const capture = new AutoCaptureService(input.manager, input.config.capture);
        const outcome = await capture.capture({
          text,
          previousAssistantText: lastAssistantText(input.messages),
          scope: input.scope,
        });
        result.captured = outcome.written + outcome.updated;
        createdIds = outcome.createdIds;
        await input.manager.setContextValue({
          contextKey: input.sessionID,
          key: CURSOR_KEY,
          value: hash,
        });
        recallCache.clear();
      }
    } catch {
      // 采集失败不影响召回与 Pin
    }
  }

  const mode = input.config.recall.mode;
  if (mode === 'off' || mode === 'shadow') return result;

  if (mode === 'hint') {
    result.inject = `<mem_block role="reference" source="auto-recall-hint">\n${AUTO_RECALL_HINT}\n</mem_block>`;
    return result;
  }

  // 缓存按「用户问题 + 最近工具结果」区分：执行中发现新依赖时重查。
  const key = `${input.sessionID}:${hash}:${dependencyKey(input.messages)}`;
  const cached = cacheGet(key);
  if (cached) {
    result.inject = cached.text;
    result.recalled = cached.recalled;
    return result;
  }

  const recall = new AutoRecallService(input.manager);
  const scopes = [input.scope, input.globalScope ?? { scope: 'global', scopeKey: 'default' }];
  let outcome;
  try {
    outcome = await recall.recall({
      query: text,
      scopes,
      // 同轮刚写入的内容不召回，避免把用户刚说的话再注入一遍。
      excludeIds: [...(input.excludeIds ?? []), ...createdIds],
      maxItems: input.config.recall.maxItems,
      maxCharacters: input.config.recall.maxCharacters,
    });
  } catch {
    // 召回失败不影响主请求与 Pin
    return result;
  }
  result.recalled = outcome.items.length;
  if (outcome.text) result.inject = outcome.text;
  cacheSet(key, {
    text: outcome.text || undefined,
    recalled: outcome.items.length,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return result;
}
