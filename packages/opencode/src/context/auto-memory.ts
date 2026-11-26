import { createHash } from 'node:crypto';
import {
  AUTO_RECALL_HINT,
  AutoCaptureService,
  AutoRecallService,
  isReferenceRequest,
  type AutoCaptureConfig,
  type AutoRecallConfig,
  type CaptureMaterial,
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

export interface UserExchange {
  text: string;
  index: number;
  /** 当前用户消息之前的最近一条用户消息。 */
  previousUserText?: string;
  /** 当前用户消息之前的最近一条助手回复（不含其后的回复）。 */
  previousAssistantText?: string;
}

/** 最后一条真实用户消息及其「请求之前」的上下文，锚定同一位置。 */
export function lastExchange(messages: ChatMessage[]): UserExchange | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const text = stripSynthetic(textOf(message));
    if (!text) continue;
    if (SYSTEM_PROMPT_SHAPE.test(text) && text.length > 200) continue;
    if (text.startsWith('# ') && text.length > 200) continue;
    let previousUserText: string | undefined;
    let previousAssistantText: string | undefined;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = messages[cursor];
      const previousText = stripSynthetic(textOf(previous));
      if (!previousText) continue;
      if (previous?.role === 'assistant' && previousAssistantText === undefined) {
        previousAssistantText = previousText;
      }
      if (previous?.role === 'user' && previousUserText === undefined) {
        previousUserText = previousText;
      }
      if (previousAssistantText !== undefined && previousUserText !== undefined) break;
    }
    return { text, index, previousUserText, previousAssistantText };
  }
  return undefined;
}

/** 最后一条真实用户消息：剥离注入块后仍有内容才算。 */
export function lastUserText(messages: ChatMessage[]): string | undefined {
  return lastExchange(messages)?.text;
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
  /** 规则采集材料（由适配层按宿主来源归一）。缺失时规则采集整体跳过。 */
  materials?: {
    current: CaptureMaterial;
    previousUser?: CaptureMaterial;
    previousAssistant?: CaptureMaterial;
  };
  excludeIds?: number[];
  /** 提取会话等不应参与自动记忆的会话。 */
  skipSessionIDs?: ReadonlySet<string>;
}

export interface AutoMemoryResult {
  inject?: string;
  /** 写入或更新的正式记忆数。 */
  captured: number;
  /** 新写入的待审批候选数。 */
  proposed: number;
  /** 当前待审批候选数（最多统计 200；达到上限表示至少 200）。 */
  pending: number;
  /** pending 达到统计上限时为 true。 */
  pendingCapped: boolean;
  recalled: number;
  /** 规则采集被来源准入拦下时的原因（便于观察适配缺失）。 */
  captureSkipped?: string;
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
  const result: AutoMemoryResult = { captured: 0, proposed: 0, pending: 0, pendingCapped: false, recalled: 0 };
  if (input.skipSessionIDs?.has(input.sessionID)) return result;

  // 子会话的 user 消息是 agent 指令，不是用户输入；采集/召回都会造成自我污染。
  const isSubagent = input.messages.some(
    (message) =>
      message?.role === 'user' &&
      textOf(message).includes('You are a subagent spawned by another session'),
  );
  if (isSubagent) return result;

  const exchange = lastExchange(input.messages);
  const materials = input.materials;
  let createdIds: number[] = [];

  // 1) 规则采集：只吃结构化材料（作者身份来自宿主 type/metadata），与召回用的正文形态无关。
  //    缺材料/来源非人工时跳过，且不消费游标，便于适配层修复后补采。
  if (input.config.capture.enabled) {
    if (!materials) {
      result.captureSkipped = 'materials-missing';
    } else if (materials.current.origin !== 'human') {
      result.captureSkipped = `non-human-origin:${materials.current.origin}`;
    } else {
      // 游标只由采集材料决定：用召回正文会让注入消息触发旧人工消息重采。
      const cursorSeed = materials.current.messageId ?? 'no-id';
      const captureCursor = createHash('sha256')
        .update(`${cursorSeed}\u0000${materials.current.text}`)
        .digest('hex')
        .slice(0, 16);
      try {
        const previous = await input.manager.getContextValue({
          contextKey: input.sessionID,
          key: CURSOR_KEY,
        });
        if (previous !== captureCursor) {
          const capture = new AutoCaptureService(input.manager, input.config.capture);
          const outcome = await capture.capture({
            current: materials.current,
            previousUser: materials.previousUser,
            previousAssistant: materials.previousAssistant,
            scope: input.scope,
          });
          result.captured = outcome.written + outcome.updated;
          result.proposed = outcome.pendingCreated;
          if (outcome.skipped.length > 0) result.captureSkipped = outcome.skipped[0];
          createdIds = outcome.createdIds;
          await input.manager.setContextValue({
            contextKey: input.sessionID,
            key: CURSOR_KEY,
            value: captureCursor,
          });
          recallCache.clear();
        }
      } catch {
        // 采集失败不影响召回与 Pin
      }
    }
  }

  // 待审数量：与采集开关无关，用于注入侧提示。
  try {
    const pending = await input.manager.listMemoryCandidates({
      scope: input.scope,
      status: 'pending',
      limit: 200,
    });
    result.pending = pending.length;
    result.pendingCapped = pending.length >= 200;
  } catch {
    // 统计失败不影响主流程
  }

  if (!exchange) return result;
  const text = exchange.text;
  // 召回缓存按「用户问题位置 + 正文」区分，与采集游标互不影响。
  const hash = createHash('sha256')
    .update(`${exchange.index}\u0000${text}`)
    .digest('hex')
    .slice(0, 16);

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
