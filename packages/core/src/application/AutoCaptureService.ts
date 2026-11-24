import type { MemoryEntry, ScopeRef } from '../domain/types.js';
import type { MemoryManager } from './MemoryManager.js';
import {
  AUTO_SIGNALS,
  type AutoCandidate,
  type AutoCaptureConfig,
  type AutoCaptureInput,
  type AutoCaptureResult,
  type AutoSignal,
} from '../domain/auto-memory.js';

/** 凭据形态：命中即整条拒绝自动写入。正则只作拒绝信号，不承诺识别所有秘密。 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S+/i,
  /:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:sk|pk|ghp|xoxb)-[A-Za-z0-9_-]{16,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
];

const HOST_PORT = /((?:\d{1,3}\.){3}\d{1,3}|[a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s*[:：]\s*(\d{2,5})/i;
const URL = /https?:\/\/[^\s"'<>）)]+/i;
const ENV_NAME = /\b([A-Z][A-Z0-9_]{2,})\b/g;
const SEMVER = /\bv?\d+\.\d+\.\d+\b/;
const ABS_PATH = /\/(?:Users|opt|var|etc|tmp|home)\/[^\s"'<>）)]+/;

const EXPLICIT = /记住|记一下|以后都用|以后都|配置是|下次用|保存下来/;
const CORRECTION = /不是[^，。；\n]{1,40}[，,]?\s*(?:是|而是|应该)|改成|更正|实际是|应该是/;
const DECISION = /不用|否决|放弃|决定|采用|因为.*(?:所以|导致)/;
const REFERENCE = /上次|之前|以前|照旧|继续之前|上次那个|还记得/;

const STOPWORDS = new Set([
  '这个', '那个', '我们', '你们', '什么', '怎么', '可以', '需要', '现在', '然后', '就是', '还是', '因为',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'your',
]);

/** 归一化保留 : . / _ -，避免 host:port 被压成不可读且可能碰撞的串。 */
export function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`"'“”‘’()（）[\]{}<>《》]/g, ' ')
    .replace(/：/g, ':')
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[，。；、,!?;]/g, '')
    .trim()
    .slice(0, 80);
}

export function hasCredential(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectSignals(text: string, previousAssistantText?: string): AutoSignal[] {
  const signals: AutoSignal[] = [];
  if (EXPLICIT.test(text)) signals.push('explicit');
  if (CORRECTION.test(text)) signals.push('correction');
  if (isAnswerToQuestion(text, previousAssistantText)) signals.push('qa');
  if (HOST_PORT.test(text) || URL.test(text) || ABS_PATH.test(text) || SEMVER.test(text))
    signals.push('structured');
  if (DECISION.test(text)) signals.push('decision');
  return signals;
}

export function isReferenceRequest(text: string): boolean {
  return REFERENCE.test(text);
}

function isAnswerToQuestion(text: string, previousAssistantText?: string): boolean {
  if (!previousAssistantText) return false;
  if (text.trim().length > 400) return false;
  const asks = /[？?]\s*$|是什么|是多少|哪个|哪里|怎么连|如何配置|地址|端口|域名/.test(
    previousAssistantText,
  );
  return asks;
}

function envNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(ENV_NAME)) {
    const name = match[1];
    if (!name || STOPWORDS.has(name.toLowerCase())) continue;
    if (name.length < 4) continue;
    names.push(name);
  }
  return [...new Set(names)];
}

function entityTagOf(text: string): string {
  if (HOST_PORT.test(text)) return 'auto:entity:hostport';
  if (URL.test(text)) return 'auto:entity:url';
  if (ABS_PATH.test(text)) return 'auto:entity:path';
  return 'auto:entity:note';
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\n；;])/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
}

/** 取句子里的英文标识符作为实体名，保证 title 对同一对象稳定。 */
function entityName(sentence: string): string {
  const match = sentence.match(/[A-Za-z][A-Za-z0-9._-]{2,}/);
  return match ? match[0].toLowerCase() : '';
}

function buildCandidate(
  sentence: string,
  inherited: AutoSignal[],
  now: number,
): AutoCandidate | undefined {
  const signals = [...new Set([...detectSignals(sentence), ...inherited])];
  if (signals.length === 0) return undefined;

  const structured = [
    ...(HOST_PORT.test(sentence) ? [sentence.match(HOST_PORT)![0]] : []),
    ...(URL.test(sentence) ? [sentence.match(URL)![0]] : []),
    ...(ABS_PATH.test(sentence) ? [sentence.match(ABS_PATH)![0]] : []),
    ...envNames(sentence),
  ];

  const signal = AUTO_SIGNALS.find((candidate) => signals.includes(candidate)) ?? 'structured';
  // 标题 = 结构化值 + 实体名：同一对象稳定，且能被召回按实体命中。
  const entity = entityName(sentence);
  const titleBase =
    structured.length > 0
      ? `${structured[0]}${entity ? ` ${entity}` : ''}`
      : entity || sentence.replace(/\s+/g, ' ').slice(0, 40);
  const title = normalizeTitle(titleBase);
  if (!title) return undefined;

  const content = [
    `结论：${sentence}`,
    `信号：${signals.join(', ')}`,
    structured.length > 0 ? `结构化值：${structured.join(' | ')}` : undefined,
    `状态：未确认（自动采集，待核实）`,
    `时间：${new Date(now).toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    title,
    content,
    summary: sentence.replace(/\s+/g, ' ').slice(0, 120),
    type: signal === 'decision' ? 'decision' : 'fact',
    tags: ['auto', `auto:${signal}`, entityTagOf(sentence)],
    signal,
    entityTag: entityTagOf(sentence),
  };
}

/** 系统/agent 注入块；剥离后剩下的才是真实内容。 */
const SYNTHETIC_BLOCK =
  /<(mem_block|system-reminder|background-result|fork-notice|subagent-update)\b[^>]*>[\s\S]*?<\/\1>/gi;

function stripSynthetic(text: string): string {
  return text.replace(SYNTHETIC_BLOCK, ' ').replace(/\s+/g, ' ').trim();
}

/** 忽略采集时间行后比较正文，避免同一内容因时间戳不同而反复 CAS 更新。 */
function stableContent(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('时间：'))
    .join('\n');
}

/** 只做候选发现；是否写入由 AutoCaptureService 决定。单轮最多 3 条。 */
export function extractCandidates(input: AutoCaptureInput): AutoCandidate[] {
  const text = stripSynthetic(input.text);
  if (!text) return [];
  if (/^\s*You are (?:a|an) /i.test(text) && text.length > 200) return [];
  if (hasCredential(text)) return [];

  const globalSignals = detectSignals(text, input.previousAssistantText);
  if (globalSignals.length === 0) return [];

  const parts = splitSentences(text);
  const targets = parts.length > 1 ? parts.slice(0, 3) : [text];
  // 显式/纠正/问答对/决策作用于整段，逐句继承；structured 由句子自身判断。
  const carried = globalSignals.filter((signal) => signal !== 'structured');
  const now = input.now ?? Date.now();
  return targets
    .map((sentence) => buildCandidate(sentence, carried, now))
    .filter((candidate): candidate is AutoCandidate => candidate !== undefined);
}

export class AutoCaptureService {
  constructor(
    private readonly manager: MemoryManager,
    private readonly config: AutoCaptureConfig,
  ) {}

  async capture(input: AutoCaptureInput): Promise<AutoCaptureResult> {
    const candidates = this.config.enabled ? extractCandidates(input) : [];
    const signals = detectSignals(input.text, input.previousAssistantText);
    const result: AutoCaptureResult = {
      signals,
      candidates,
      written: 0,
      updated: 0,
      createdIds: [],
      skipped: [],
    };
    if (!this.config.enabled) return result;
    if (this.config.mode === 'shadow') return result;

    const existing = await this.manager.listMemories({ scope: input.scope, limit: 200 });
    // 只允许覆盖自动写入的低信任记忆；人工记忆（origin=user / trust=high）永不被自动改写。
    const autoEntries = existing.filter((entry) => entry.origin === 'agent' && entry.trust === 'low');
    const byTitle = new Map<string, MemoryEntry>();
    for (const entry of autoEntries) byTitle.set(normalizeTitle(entry.title), entry);

    const limit = Math.max(0, this.config.maxWritesPerTurn);
    for (const candidate of candidates.slice(0, limit)) {
      let hit = byTitle.get(candidate.title);
      if (!hit && candidate.signal === 'correction') {
        // 纠正语义：覆盖最近一条自动记忆，而不是新增（原文与纠正文本标题不同）。
        hit = [...autoEntries].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      }
      if (hit && stableContent(hit.content) === stableContent(candidate.content)) {
        // 同一内容重复采集：只保留原文与 revision，不重复写库。
        result.skipped.push(`${candidate.title}: unchanged`);
        continue;
      }
      try {
        if (hit) {
          const updated = await this.manager.updateMemoryContent({
            id: hit.id,
            content: candidate.content,
            summary: candidate.summary,
            expectedRevision: hit.revision,
            title: candidate.title,
          });
          if (updated.conflict || !updated.memory) {
            result.skipped.push(`${candidate.title}: revision conflict`);
            continue;
          }
          result.updated += 1;
          result.createdIds.push(updated.memory.id);
          byTitle.set(candidate.title, updated.memory);
          continue;
        }
        const entry = await this.manager.storeMemory({
          title: candidate.title,
          content: candidate.content,
          summary: candidate.summary,
          type: candidate.type,
          tags: candidate.tags,
          scope: input.scope,
          origin: 'agent',
          trust: 'low',
        });
        result.createdIds.push(entry.id);
        result.written += 1;
        byTitle.set(candidate.title, entry);
      } catch (error) {
        result.skipped.push(
          `${candidate.title}: ${error instanceof Error ? error.message : 'write failed'}`,
        );
      }
    }
    return result;
  }
}
