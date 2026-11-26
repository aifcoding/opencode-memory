import type { CaptureMaterial, ExtractionMessage, MaterialOrigin } from '@aifcoding/memory-core';

/** 宿主 v2 的结构化消息（SessionMessage 联合的公共字段）。 */
export interface HostMessage {
  type?: string;
  id?: string;
  text?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

export interface CaptureMaterials {
  current: CaptureMaterial;
  previousUser?: CaptureMaterial;
  previousAssistant?: CaptureMaterial;
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: any) => part && part.type === 'text')
    .map((part: any) => String(part.text ?? ''))
    .join('\n');
}

function textOf(message: HostMessage): string {
  if (typeof message?.text === 'string') return message.text;
  return textFromContent(message?.content);
}

/**
 * 宿主来源映射：只依据结构字段（type/metadata/id 前缀），不猜正文。
 * `role` 是协议角色，不能代表作者身份。
 */
export function originOf(message: HostMessage): { origin: MaterialOrigin; reason?: string } {
  switch (message?.type) {
    case 'user': {
      const automation = message.metadata?.automation;
      if (automation) return { origin: 'host', reason: 'automation' };
      if (typeof message.id === 'string' && message.id.startsWith('msg_aut_')) {
        return { origin: 'host', reason: 'automation' };
      }
      return { origin: 'human' };
    }
    case 'assistant':
      return { origin: 'model' };
    case 'compaction':
      return { origin: 'host', reason: 'compaction' };
    case 'synthetic':
      return { origin: 'host', reason: 'synthetic' };
    case 'system':
      return { origin: 'host', reason: 'system' };
    case 'shell':
      return { origin: 'host', reason: 'shell' };
    default:
      return { origin: 'unknown' };
  }
}

export function toCaptureMaterial(message: HostMessage): CaptureMaterial {
  const { origin, reason } = originOf(message);
  return {
    text: textOf(message),
    origin,
    messageId: typeof message?.id === 'string' ? message.id : undefined,
    reason,
  };
}

type BoundaryKind = 'cut' | 'skip';

/**
 * 交互边界：另一个请求方发起的用户轮（automation），或压缩边界。
 * - cut：压缩后更早的消息不再属于当前上下文，直接停止向前收集。
 * - skip：自动化只是旁路请求，人工历史仍有效，但该交互产生的模型回复要丢弃。
 * synthetic/system/shell 只是追加的上下文提示，不是新的交互，不能据此切断问答配对。
 */
function boundaryKind(material: CaptureMaterial): BoundaryKind | undefined {
  if (material.origin === 'unknown') return 'cut';
  if (material.origin !== 'host') return undefined;
  if (material.reason === 'compaction') return 'cut';
  if (material.reason === 'automation') return 'skip';
  return undefined;
}

/**
 * 取「最后一条人工消息」作为当前材料；前文分别取最近的人工消息与模型回复。
 * 跨越交互边界时丢弃该交互产生的模型回复，避免把自动化的回复当成人工上一轮。
 * 没有任何人工消息时返回 undefined（规则采集整体跳过）。
 */
export function captureMaterials(messages: readonly HostMessage[]): CaptureMaterials | undefined {
  const items = (messages ?? []).map(toCaptureMaterial);
  let index = -1;
  for (let cursor = items.length - 1; cursor >= 0; cursor -= 1) {
    const item = items[cursor];
    if (item.origin === 'human' && item.text.trim().length > 0) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return undefined;

  let previousUser: CaptureMaterial | undefined;
  let previousAssistant: CaptureMaterial | undefined;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const item = items[cursor];
    const boundary = boundaryKind(item);
    if (boundary === 'cut') break;
    if (boundary === 'skip') {
      // 该交互的模型回复不属于人工交互：丢弃已收集的助手前文，继续向前找上一次人工交互。
      previousAssistant = undefined;
      continue;
    }
    if (!previousUser && item.origin === 'human' && item.text.trim().length > 0) {
      previousUser = item;
    }
    if (!previousAssistant && item.origin === 'model' && item.text.trim().length > 0) {
      previousAssistant = item;
    }
    if (previousUser && previousAssistant) break;
  }
  return { current: items[index], previousUser, previousAssistant };
}

/**
 * 提取材料：只保留人工与模型文本。
 * automation/compaction/synthetic/system/shell/unknown 一律不得进入 LLM 提取材料。
 */
export function extractionMaterial(messages: readonly HostMessage[]): ExtractionMessage[] {
  return (messages ?? []).flatMap((message) => {
    const { origin } = originOf(message);
    if (origin !== 'human' && origin !== 'model') return [];
    const text = textOf(message);
    if (!text.trim()) return [];
    return [
      {
        id: typeof message?.id === 'string' ? message.id : '',
        role: origin === 'human' ? ('user' as const) : ('assistant' as const),
        text,
        synthetic: false,
        origin,
      },
    ];
  });
}
