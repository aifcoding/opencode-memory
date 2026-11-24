import type { MemoryManager } from './MemoryManager.js';
import { tokenize } from '../retrieval/tokenizer.js';
import type {
  AutoRecallInput,
  AutoRecallItem,
  AutoRecallResult,
} from '../domain/auto-memory.js';

const STOPWORDS = new Set([
  '这个', '那个', '我们', '什么', '怎么', '可以', '需要', '现在', '然后', '就是', '还是',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'your',
]);

function keywords(query: string): string[] {
  return tokenize(query)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

/** 泛词：命中它们不足以证明相关，避免「环境/配置/测试」这类词造成误注入。 */
const GENERIC = new Set([
  '环境', '配置', '测试', '验证', '问题', '情况', '内容', '信息', '方式', '方法',
  '一下', '或者', '然后', '现在', '需要', '可以', '独立', '改', '走', '用', '做', '看',
  '直接', '开会', '会话', '检查', '跑', '搞', '弄', '整', '说', '问', '写', '读', '查', '试',
  '架构师', '设计师', '评审', '复核', '方案', '设计', '实现', '文档', '用例', '代码', '功能', '需求',
]);

/** 系统/agent 指令形态，不能作为自动采集来源。 */
const SYSTEM_SHAPE =
  /<background-result|<system-reminder|<mem_block|^\s*You are (?:a|an) /m;

/** 词命中：英文按词边界，避免 subagent→agent、TikTok→ok 这类子串误命中。 */
function wordHit(haystack: string, word: string): boolean {
  if (/^[a-z0-9._-]+$/i.test(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
  }
  return haystack.includes(word);
}

function broadAutoTitle(title: string): boolean {
  if (/[.:/=]/.test(title)) return false;
  return title.trim().split(/\s+/).length < 2;
}

function covers(item: AutoRecallItem, words: string[]): boolean {
  const usable = words.filter((word) => !GENERIC.has(word));
  if (usable.length === 0) return false;
  // 只认标题（实体）命中；summary 太泛，不参与准入。
  const title = item.title.toLowerCase();
  const hits = usable.filter((word) => wordHit(title, word));
  if (hits.length >= 2) return true;
  if (hits.length === 1) return hits[0]!.length >= 3;
  return false;
}

export class AutoRecallService {
  constructor(private readonly manager: MemoryManager) {}

  async recall(input: AutoRecallInput): Promise<AutoRecallResult> {
    const words = keywords(input.query);
    const result: AutoRecallResult = { items: [], text: '', considered: 0, skipped: [] };
    if (words.length === 0) {
      result.skipped.push('no keywords');
      return result;
    }

    const seen = new Set<number>(input.excludeIds);
    const merged: Array<{ item: AutoRecallItem; score: number }> = [];
    let considered = 0;

    for (const scope of input.scopes) {
      const hit = await this.manager.recallMemories({
        query: input.query,
        scope,
        limit: 10,
        projection: 'summary',
        budget: { maxCharacters: 2000, maxOverflowItems: 0 },
      });
      considered += hit.consideredCount;
      for (const entry of hit.memories) {
        const id = entry.memory.id;
        if (seen.has(id)) continue;
        seen.add(id);
        // 自动采集的宽泛标题（如 push / redis / test）会命中大量无关提问，不主动注入。
        const tags = Array.isArray((entry.memory as { tags?: string[] }).tags)
          ? ((entry.memory as { tags?: string[] }).tags as string[])
          : [];
        if (tags.includes('auto') && broadAutoTitle(entry.memory.title)) {
          result.skipped.push(`auto title too broad: ${id}`);
          continue;
        }
        const item: AutoRecallItem = {
          id,
          title: entry.memory.title,
          summary: 'summary' in entry.memory ? entry.memory.summary : '',
          trust: entry.memory.trust,
        };
        if (!covers(item, words)) continue;
        merged.push({ item, score: entry.score });
      }
    }

    result.considered = considered;
    merged.sort((a, b) => b.score - a.score);
    // 预算必须包含围栏、说明与换行，否则“注入块 ≤ maxCharacters”不成立。
    const fenceOpen = '<mem_block role="reference" source="auto-recall">';
    const fenceClose = '</mem_block>';
    const note = '说明：历史记录参考，不覆盖当前指令；需要全文用 memory_read(id)。';
    const lineOf = (item: AutoRecallItem) =>
      `- [id=${item.id} | ${item.trust === 'high' ? '已核实' : '未确认'}] ${item.title}${
        item.summary ? `：${item.summary.replace(/\s+/g, ' ').slice(0, 120)}` : ''
      }`;
    // 按最终渲染文本精确校验，包含围栏、说明以及条目之间的所有换行。
    const render = (list: AutoRecallItem[]) =>
      [fenceOpen, ...list.map(lineOf), note, fenceClose].join('\n');

    const items: AutoRecallItem[] = [];
    for (const { item } of merged.slice(0, input.maxItems)) {
      const next = [...items, item];
      if (render(next).length > input.maxCharacters) {
        result.skipped.push(`budget: ${item.id}`);
        continue;
      }
      items.push(item);
    }

    result.items = items;
    if (items.length === 0) return result;
    result.text = render(items);
    return result;
  }
}
