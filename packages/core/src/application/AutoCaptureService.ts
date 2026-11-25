import type { MemoryCandidateDraft } from '../domain/capture.js';
import type { MemoryEntry, MemoryType } from '../domain/types.js';
import type { MemoryManager } from './MemoryManager.js';
import {
  type AutoCandidate,
  type AutoCaptureConfig,
  type AutoCaptureInput,
  type AutoCaptureResult,
  type AutoRoutedUnit,
  type AutoRule,
  type AutoSignal,
} from '../domain/auto-memory.js';

/** 凭据形态：命中即整条拒绝自动写入。正则只作拒绝信号，不承诺识别所有秘密。 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*\S+/i,
  /:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:sk|pk|ghp|xoxb)-[A-Za-z0-9_-]{16,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
  // 中文凭据赋值：只认「名称 + 是/为/：/= + 值」；「密码走环境变量」这类没有值的表述不命中。
  /(?:密码|口令|密钥|令牌|验证码|账号密码)\s*(?:是|为|[:：=])\s*\S+/,
  // 常见凭据头/令牌形态。
  /\bAuthorization\s*:\s*(?:Bearer|Basic|Token|Digest)\s+\S{6,}/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:cookie|set-cookie)\s*:\s*\S+/i,
];

/** E1：只认单元开头的明确保存指令，避免「文档里写着'记住…'」被当成保存意图。 */
const EXPLICIT_SAVE = /^(?:请)?(?:记住|记一下|保存下来)\s*(?:[:：,，]\s*)?([\s\S]{2,400})$/;
/** E2：弱 explicit 措辞。 */
const EXPLICIT_WEAK = /(?:配置是|以后都|下次用)/;

/** S1 字段白名单（v1 固定）。 */
type Field = 'endpoint' | 'port' | 'version' | 'path';
const FIELD_ALIASES: Record<string, Field> = {
  endpoint: 'endpoint',
  url: 'endpoint',
  地址: 'endpoint',
  接口地址: 'endpoint',
  port: 'port',
  端口: 'port',
  version: 'version',
  版本: 'version',
  path: 'path',
  路径: 'path',
  目录: 'path',
};

const URL_VALUE = /^https?:\/\/[^\s"'<>，。；、）)（(？?！!]+$/i;
const URL_INLINE = /https?:\/\/[^\s"'<>，。；、）)（(？?！!]+/i;
const HOST_PORT_VALUE = /^(?:[A-Za-z0-9._-]+\.[A-Za-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const HOST_PORT_INLINE = /(?:[A-Za-z0-9._-]+\.[A-Za-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}/;
const PORT_VALUE = /^\d{1,5}$/;
const SEMVER_VALUE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SEMVER_INLINE = /\bv?\d+\.\d+\.\d+\b/;
const ABS_PATH_VALUE = /^\/[^\s"'<>，。；、]+$/;
const ABS_PATH_INLINE = /(?:^|[\s(])\/(?:Users|opt|var|etc|tmp|home|srv)\/[^\s"'<>，。；、]+/;

const ENTITY_ID = /^[A-Za-z][A-Za-z0-9._-]{1,}$/;
const DOTTED_BINDING = /^([A-Za-z][A-Za-z0-9._-]*)\.([A-Za-z][A-Za-z0-9]*)\s*=\s*([^\s，。；、？?！!]+)$/;
const CN_BINDING =
  /^([A-Za-z][A-Za-z0-9._-]*)\s*(?:的)?\s*(地址|接口地址|url|endpoint|端口|port|版本|version|路径|path|目录)\s*(?:是|为|=|：|:)\s*([^\s，。；、？?！!]+)$/i;
/** 中文/混合实体 + 白名单字段 + 值；用于「仓库地址是 /path」这类真实说法。 */
const GENERIC_BINDING =
  /^([^，。；]{1,20}?)\s*(?:的)?\s*(接口地址|地址|url|endpoint|端口|port|版本|version|路径|path|目录)\s*(?:是|为|=|：|:)\s*([^\s，。；、？?！!]+)$/i;
/** 示例/假设语气：出现了就不直写，避免把样例值当事实。 */
const HEDGE_OR_EXAMPLE = /(?:比如|例如|示例|举例|假设|假如|如果|参考|大概是|可能是|尚待|待确认|草稿)/;

const DECISION_DIRECT =
  /^(?:本项目|项目\s*[A-Za-z][A-Za-z0-9._-]*)\s*(?:已)?\s*决定\s*采用\s*([A-Za-z][A-Za-z0-9.+-]*|“[^”]{1,40}”|"[^"]{1,40}")\s*$/;
const DECISION_WORD = /(?:决定|采用|否决|放弃)/;
const QUOTED = /“[^”]{1,40}”|"[^"]{1,40}"/;

const CORRECTION_PAIR = /不是\s*([^，。；\s]{1,20})\s*[，,]?\s*(?:而是|是|应该(?:是)?)\s*([^。；\n]{1,60})$/;
const CORRECTION_SET = /^(.{1,30}?)\s*(?:改成|更正为|应该是)\s*([^。；\n]{1,60})$/;

const QUESTION_LIKE = /[？?]\s*$|(?:吗|呢)\s*[。.!！]?\s*$/;
const HEDGE = /(?:如果|假如|假设|是否|会不会|能不能|若是)/;

const REFERENCE = /上次|之前|以前|照旧|继续之前|上次那个|还记得/;

/** 纯确认/填充语：作为问答对答案时没有信息量，落候选也是噪声。 */
const AGREEMENT_ONLY = /^(?:好|好的|可以|行|对|嗯|是|收到|了解|明白|没问题|ok|随便|都行)[。.!！]?$/i;
const QA_FILLER = /^(?:你再看看|再看|怎么处理|怎么办|然后呢|接下来呢|具体呢)[。.!！]?$/;

/** 纯指代正文：短且只有指代；以「这个」开头但有实义的长句不算。 */
const DEICTIC =
  /^(?:这个|那个|这些|那些|这|那|它|这里|那里|上面|下面|上述内容|上面那段|(?:我们)?(?:刚才|之前|前面|上面)(?:说的|提到的|讲的)?(?:那个|这一段|那段)?)[^，。；\n]{0,6}$/;
/** 较长的口语指代：「我们刚才讨论的那个方案」，必须以指代名词结尾，避免误伤有实义的句子。 */
const DEICTIC_LONG =
  /^(?:我们)?(?:刚才|之前|前面|上面)(?:讨论|说|提到|讲)的?.{0,12}(?:那个|方案|内容|结论|部分|地址|配置|字段)$/;
/** 偏好类表达（以后/别/默认/优先），存为 preference 而不是 fact。 */
const PREFERENCE = /(?:以后|下次|别|不要|优先|默认|习惯)/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 值在正文中作为完整绑定出现（右侧不允许再有标识符字符），避免 1808 命中 18080。 */
function hasBoundedValue(content: string, value: string): boolean {
  return new RegExp(`(?:^|[\\s=:：])${escapeRegExp(value)}(?![0-9A-Za-z._-])`).test(content);
}

function fieldTokenAliases(field: Field): string[] {
  if (field === 'endpoint') return ['endpoint', 'url', '地址'];
  if (field === 'port') return ['port', '端口'];
  if (field === 'version') return ['version', '版本'];
  return ['path', '路径', '目录'];
}

function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(/[\s.]+/)
    .filter(Boolean);
}

/** 纠正里的白名单字段；新值由纠正本身给出并做类型校验。 */
function fieldValueOf(text: string, newValue: string): { field: Field; value: string } | undefined {
  const match = text.match(
    /(接口地址|地址|url|endpoint|端口|port|版本|version|路径|path|目录)/i,
  );
  if (!match) return undefined;
  const field = FIELD_ALIASES[match[1]!.toLowerCase()];
  if (!field) return undefined;
  const value = newValue.trim().replace(/[。；;，,]$/, '');
  if (!validValue(field, value)) return undefined;
  return { field, value };
}


const STOPWORDS = new Set([
  '这个',
  '那个',
  '我们',
  '你们',
  '什么',
  '怎么',
  '可以',
  '需要',
  '现在',
  '然后',
  '就是',
  '还是',
  '因为',
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'will',
  'your',
]);

/** 单条消息最多写入（直写 + 候选合计）。 */
const MAX_PER_MESSAGE = 3;
/** 同一 scope 每日新增待审批候选上限。 */
const DAILY_PENDING_CAP = 20;

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

/** 把命中的凭据片段替换为 [REDACTED]，返回命中次数；用于提取材料脱敏。 */
const SAFE_CREDENTIAL_VALUE =
  /^(?:env|环境变量|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|xxx+|<[^>]{1,40}>|\*{3,})$/i;

export function redactCredentialText(text: string): { text: string; hits: number } {
  let hits = 0;
  let out = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    out = out.replace(global, (match) => {
      // 只有「值整体就是占位符」才放行；`password=环境变量abc` 仍要脱敏。
      const value = match
        .replace(/^[^:=是]*[:=是]\s*/s, '')
        .replace(/["'\]\}\)]+$/, '')
        .trim();
      if (value && SAFE_CREDENTIAL_VALUE.test(value)) return match;
      hits += 1;
      return '[REDACTED]';
    });
  }
  return { text: out, hits };
}

export function hasCredential(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function isReferenceRequest(text: string): boolean {
  return REFERENCE.test(text);
}

/** 兼容旧调用：给出本条消息命中的信号列表（不再用于写入决策）。 */
export function detectSignals(text: string): AutoSignal[] {
  const signals: AutoSignal[] = [];
  const trimmed = text.trim();
  if (EXPLICIT_SAVE.test(trimmed) || EXPLICIT_WEAK.test(trimmed)) signals.push('explicit');
  if (CORRECTION_PAIR.test(trimmed) || CORRECTION_SET.test(trimmed)) signals.push('correction');
  if (hasStructuredValue(trimmed)) signals.push('structured');
  if (DECISION_WORD.test(trimmed)) signals.push('decision');
  return signals;
}

function hasStructuredValue(text: string): boolean {
  return (
    URL_INLINE.test(text) ||
    HOST_PORT_INLINE.test(text) ||
    SEMVER_INLINE.test(text) ||
    ABS_PATH_INLINE.test(text)
  );
}

function validValue(field: Field, raw: string): boolean {
  const value = raw.replace(/[。；;，,]$/, '');
  if (field === 'endpoint') return URL_VALUE.test(value) || HOST_PORT_VALUE.test(value);
  if (field === 'port') {
    if (!PORT_VALUE.test(value)) return false;
    const port = Number(value);
    return port >= 1 && port <= 65535;
  }
  if (field === 'version') return SEMVER_VALUE.test(value);
  return ABS_PATH_VALUE.test(value);
}

/** 抽取文本中的结构化值（URL / host:port / 绝对路径 / semver），去重。 */
function structuredValues(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(new RegExp(URL_INLINE.source, 'gi'))) values.add(match[0]);
  for (const match of text.matchAll(new RegExp(HOST_PORT_INLINE.source, 'gi'))) values.add(match[0]);
  for (const match of text.matchAll(new RegExp(ABS_PATH_INLINE.source, 'gi'))) values.add(match[0].trim());
  for (const match of text.matchAll(new RegExp(SEMVER_INLINE.source, 'gi'))) values.add(match[0]);
  return [...values];
}

function entityTagOf(text: string): string {
  if (HOST_PORT_INLINE.test(text)) return 'auto:entity:hostport';
  if (URL_INLINE.test(text)) return 'auto:entity:url';
  if (ABS_PATH_INLINE.test(text)) return 'auto:entity:path';
  return 'auto:entity:note';
}

/** 拉丁标识符作为实体键；没有则视为实体不明确。 */
function entityKey(text: string): string {
  const match = text.match(/[A-Za-z][A-Za-z0-9._-]{2,}/);
  return match ? match[0].toLowerCase() : '';
}

/** 系统/agent 注入块；剥离后剩下的才是真实内容。 */
const SYNTHETIC_BLOCK =
  /<(mem_block|system-reminder|background-result|fork-notice|subagent-update)\b[^>]*>[\s\S]*?<\/\1>/gi;

function stripSynthetic(text: string): string {
  return text
    .replace(SYNTHETIC_BLOCK, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^ {0,3}>.*$/gm, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 逐单元切分；显式保存指令整体保留，不拆条。 */
function splitUnits(text: string): string[] {
  const trimmed = text.trim();
  if (EXPLICIT_SAVE.test(trimmed)) return [trimmed];
  const parts = trimmed
    .split(/(?<=[。！？!?\n；;])/)
    .map((part) => part.trim().replace(/[。；;]+$/, ''))
    .filter((part) => part.length >= 2);
  // 逗号后跟随明确保存指令时单独成单元；不整体按逗号切，避免拆坏「不是 X，是 Y」。
  const units: string[] = [];
  const inlineSave = /^(.*?)[，,]\s*((?:请)?(?:记住|记一下|保存下来)[\s\S]*)$/;
  for (const part of parts) {
    const match = part.match(inlineSave);
    if (match && match[1]!.trim().length > 0) {
      units.push(match[1]!.trim(), match[2]!.trim());
    } else {
      units.push(part);
    }
  }
  return units;
}

/** 前文指纹：稳定、不含时间，用于区分不同上下文下的同句指代。 */
function contextFingerprint(ctx: RouterContext): string {
  return createDigest(`${ctx.previousUserText ?? ''}\u0000${ctx.previousAssistantText ?? ''}`).slice(0, 8);
}

function clip(text: string | undefined, limit = CONTEXT_LIMIT): string {
  if (!text) return '（无）';
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…（已截断）` : compact;
}

/** 指代式保存：保存请求明确、对象不明，落待澄清候选。 */
function buildDeicticCandidate(text: string, body: string, ctx: RouterContext): AutoCandidate | undefined {
  const preview = clip(body || '指代保存', 24);
  const title = normalizeTitle(`待澄清保存 ${preview} ${contextFingerprint(ctx)}`);
  if (!title) return undefined;
  const content = [
    '待澄清：指代未解析，不可当事实使用',
    `保存请求：${text}`,
    `来源指纹：${contextFingerprint(ctx)}`,
    `用户前文：${clip(ctx.previousUserText)}`,
    `助手前文：${clip(ctx.previousAssistantText)}`,
    '状态：指代未解析（自动采集，待核实；助手陈述未经用户确认）',
    `时间：${new Date(ctx.now).toISOString()}`,
  ].join('\n');
  return {
    title,
    content,
    summary: `待澄清保存：${preview}`,
    type: 'fact',
    tags: ['auto', 'auto:explicit', 'auto:rule:E2', 'auto:deictic'],
    signal: 'explicit',
    entityTag: 'auto:entity:note',
    rule: 'E2',
  };
}

function buildCandidate(
  text: string,
  rule: AutoRule,
  signal: AutoSignal,
  now: number,
  titleBase?: string,
  structured: string[] = [],
): AutoCandidate | undefined {
  const title = normalizeTitle(titleBase || entityKey(text) || text.slice(0, 40));
  if (!title) return undefined;
  const content = [
    `结论：${text}`,
    `规则：${rule}（信号 ${signal}）`,
    structured.length > 0 ? `结构化值：${structured.join(' | ')}` : undefined,
    '状态：未确认（自动采集，待核实）',
    `时间：${new Date(now).toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    title,
    content,
    summary: text.replace(/\s+/g, ' ').slice(0, 120),
    type: signal === 'decision' ? 'decision' : 'fact',
    tags: ['auto', `auto:${signal}`, `auto:rule:${rule}`, entityTagOf(text)],
    signal,
    entityTag: entityTagOf(text),
    rule,
  };
}

interface RouterContext {
  autoEntries: MemoryEntry[];
  /** 上一条用户消息（锚定在当前消息之前）。 */
  previousUserText?: string;
  /** 当前消息之前最近的一条助手回复。 */
  previousAssistantText?: string;
  now: number;
}

/** 指代候选引用的上下文长度上限（每角色）。 */
const CONTEXT_LIMIT = 200;

function dropped(rule: AutoRule, text: string, reason: string): AutoRoutedUnit {
  return { rule, text, reason };
}

/** 纠正：只有唯一匹配的低信任目标且旧值相符才允许更新。 */
function routeCorrection(text: string, ctx: RouterContext): AutoRoutedUnit | undefined {
  const pair = text.match(CORRECTION_PAIR);
  const set = text.match(CORRECTION_SET);
  if (!pair && !set) return undefined;

  const oldValue = pair ? pair[1].trim() : undefined;
  const newValue = (pair ? pair[2] : set![2]).trim().replace(/[。；;]$/, '');
  if (!newValue) return dropped('C2', text, 'empty new value');

  const key = entityKey(text);
  if (!key) {
    return {
      rule: 'C2',
      text,
      candidate: buildCandidate(text, 'C2', 'correction', ctx.now),
      reason: 'entity not identifiable',
    };
  }
  const fieldValue = fieldValueOf(text, newValue);
  if (!fieldValue) {
    return {
      rule: 'C2',
      text,
      candidate: buildCandidate(text, 'C2', 'correction', ctx.now, key),
      reason: 'correction without valid field/value',
    };
  }
  const keyTokens = titleTokens(key);
  const fieldTokens = fieldTokenAliases(fieldValue.field);
  const matches = ctx.autoEntries.filter((entry) => {
    const tokens = titleTokens(entry.title);
    const entityMatches = keyTokens.length > 0 && keyTokens.every((token) => tokens.includes(token));
    const fieldMatches = fieldTokens.some((token) => tokens.includes(token));
    return entityMatches && fieldMatches;
  });
  if (matches.length > 1 && oldValue) {
    const narrowed = matches.filter((entry) => hasBoundedValue(entry.content, oldValue));
    if (narrowed.length === 1) matches.splice(0, matches.length, narrowed[0]!);
  }
  if (matches.length !== 1) {
    return {
      rule: 'C2',
      text,
      candidate: buildCandidate(text, 'C2', 'correction', ctx.now, key),
      reason: matches.length === 0 ? 'no target' : 'multiple targets',
    };
  }
  const target = matches[0]!;
  if (target.origin !== 'agent' || target.trust !== 'low') {
    return {
      rule: 'C2',
      text,
      candidate: buildCandidate(text, 'C2', 'correction', ctx.now, key),
      reason: 'target not auto low-trust',
    };
  }
  if (oldValue && !hasBoundedValue(target.content, oldValue)) {
    return {
      rule: 'C2',
      text,
      candidate: buildCandidate(text, 'C2', 'correction', ctx.now, key),
      reason: 'old value mismatch',
    };
  }
  return {
    rule: 'C1',
    text,
    targetId: target.id,
    oldValue,
    candidate: buildCandidate(text, 'C1', 'correction', ctx.now, target.title),
  };
}

/** S1 绑定：同键已有不同值时不得直写覆盖，降级为候选。 */
function bindingUnit(
  text: string,
  entity: string,
  field: Field,
  value: string,
  ctx: RouterContext,
  identityKey?: string,
): AutoRoutedUnit {
  const title = identityKey ?? `${entity}.${field}`;
  const binding = `${title}=${value}`;
  const existing = ctx.autoEntries.find(
    (entry) => normalizeTitle(entry.title) === normalizeTitle(title),
  );
  if (existing && !hasBoundedValue(existing.content, binding)) {
    return {
      rule: 'S2',
      text,
      candidate: buildCandidate(text, 'S2', 'structured', ctx.now, title, [binding]),
      reason: 'same key different value',
    };
  }
  return {
    rule: 'S1',
    text,
    candidate: buildCandidate(text, 'S1', 'structured', ctx.now, title, [binding]),
  };
}

/** 完整配置绑定（S1）。返回 undefined 表示不是完整绑定。 */
function questionBinding(text: string, ctx: RouterContext): AutoRoutedUnit {
  return {
    rule: 'S2',
    text,
    candidate: buildCandidate(text, 'S2', 'structured', ctx.now),
    reason: 'binding inside a question',
  };
}

function routeBinding(text: string, ctx: RouterContext): AutoRoutedUnit | undefined {
  const dotted = text.match(DOTTED_BINDING);
  if (dotted) {
    const entity = dotted[1]!;
    const fieldName = dotted[2]!.toLowerCase();
    const field = FIELD_ALIASES[fieldName];
    const value = dotted[3]!;
    if (!field) return undefined;
    if (!ENTITY_ID.test(entity) || !validValue(field, value)) {
      return {
        rule: 'S2',
        text,
        candidate: buildCandidate(text, 'S2', 'structured', ctx.now, `${entity}.${field}`),
        reason: 'incomplete binding',
      };
    }
    return bindingUnit(text, entity, field, value, ctx);
  }

  if (!HEDGE_OR_EXAMPLE.test(text)) {
    const generic = text.match(GENERIC_BINDING);
    if (generic) {
      const entity = generic[1]!.trim();
      const fieldName = generic[2]!.toLowerCase();
      const declared = FIELD_ALIASES[fieldName];
      const value = generic[3]!;
      if (!declared) return undefined;
      // 「仓库地址是 /abs/path」：字段写的是地址，值却是路径，按值类型纠正。
      const field: Field =
        declared === 'endpoint' && ABS_PATH_VALUE.test(value) ? 'path' : declared;
      if (!value || !validValue(field, value)) {
        return {
          rule: 'S2',
          text,
          candidate: buildCandidate(text, 'S2', 'structured', ctx.now, `${entity}.${field}`),
          reason: 'incomplete binding',
        };
      }
      if (QUESTION_LIKE.test(text.trim())) return questionBinding(text, ctx);
      return bindingUnit(text, `${entity} ${field}`.trim(), field, value, ctx, `${entity}.${field}`);
    }
  }

  const cn = text.match(CN_BINDING);
  if (cn) {
    const entity = cn[1]!;
    const fieldName = cn[2]!.toLowerCase();
    const field = FIELD_ALIASES[fieldName];
    const value = cn[3]!;
    if (!field) return undefined;
    if (!ENTITY_ID.test(entity) || !validValue(field, value)) {
      return {
        rule: 'S2',
        text,
        candidate: buildCandidate(text, 'S2', 'structured', ctx.now, `${entity}.${field}`),
        reason: 'incomplete binding',
      };
    }
    if (QUESTION_LIKE.test(text.trim())) return questionBinding(text, ctx);
    return bindingUnit(text, entity, field, value, ctx);
  }
  return undefined;
}

function routeUnit(text: string, ctx: RouterContext): AutoRoutedUnit {
  // 1) 纠正优先：不得被 explicit/structured 绕过。
  const correction = routeCorrection(text, ctx);
  if (correction) return correction;

  // 2) E1 明确保存指令。
  const save = text.match(EXPLICIT_SAVE);
  if (save) {
    const body = save[1]!.trim();
    if (QUESTION_LIKE.test(body)) return dropped('N', text, 'save body is a question');
    if (/^(?:不要|别)(?:保存|记)/.test(body)) return dropped('N', text, 'negated save');
    // 纯指代：保存意愿明确但对象不明。有前文 → 待澄清候选；无前文 → 丢弃（不造空记忆）。
    if ((DEICTIC.test(body) || DEICTIC_LONG.test(body)) && !hasStructuredValue(body)) {
      const contextText = `${ctx.previousUserText ?? ''}\n${ctx.previousAssistantText ?? ''}`.trim();
      if (!contextText) return dropped('N', text, 'deictic without context');
      if (hasCredential(contextText)) return dropped('N', text, 'credential in referenced context');
      // 上文恰好只有一个客观值：指代可解析，直接按该值落记忆并标注来源。
      const values = structuredValues(contextText);
      if (values.length === 1) {
        const value = values[0]!;
        const candidate = buildCandidate(`${body} → ${value}`, 'E1', 'explicit', ctx.now, value);
        if (candidate) candidate.content = `${candidate.content}\n来源：指代解析自上一轮上下文`;
        return { rule: 'E1', text, candidate };
      }
      return {
        rule: 'E2',
        text,
        candidate: buildDeicticCandidate(text, body, ctx),
        reason: 'deictic reference needs clarification',
      };
    }
    if (body.length < 4) return dropped('N', text, 'save body too short');
    if (
      body.includes('[REDACTED]') &&
      body.replace(/\[REDACTED\]/g, '').replace(/[\s:：=，,]/g, '').length < 4
    ) {
      return dropped('N', text, 'credential-only save');
    }
    const facts = body.split(/(?<=[。！？!?\n；;])/).map((part) => part.trim()).filter((part) => part.length >= 2);
    if (facts.length > 1) {
      return {
        rule: 'E2',
        text,
        candidate: buildCandidate(body, 'E2', 'explicit', ctx.now),
        reason: 'multiple facts in one save',
      };
    }
    const candidate = buildCandidate(body, 'E1', 'explicit', ctx.now);
    if (candidate && PREFERENCE.test(body)) candidate.type = 'preference';
    return { rule: 'E1', text, candidate };
  }

  // 3) S1 完整绑定 / S2 不完整结构化材料。
  const binding = routeBinding(text, ctx);
  if (binding) return binding;

  // 4) D1 明确选型 / D2 其他决策。
  const decision = text.match(DECISION_DIRECT);
  if (decision) {
    const choice = decision[1]!;
    return {
      rule: 'D1',
      text,
      candidate: buildCandidate(text, 'D1', 'decision', ctx.now, `decision ${choice}`),
    };
  }
  if (DECISION_WORD.test(text) && !QUESTION_LIKE.test(text) && !HEDGE.test(text)) {
    if (/[A-Za-z][A-Za-z0-9.+-]{1,}/.test(text) || QUOTED.test(text)) {
      return {
        rule: 'D2',
        text,
        candidate: buildCandidate(text, 'D2', 'decision', ctx.now),
      };
    }
    return dropped('N', text, 'decision without object');
  }

  // 5) S2：有结构化值且有字段线索，但无法完整解析。
  if (hasStructuredValue(text) && /(地址|url|endpoint|端口|port|版本|version|路径|path|目录)/i.test(text)) {
    return {
      rule: 'S2',
      text,
      candidate: buildCandidate(text, 'S2', 'structured', ctx.now),
      reason: 'structured but incomplete',
    };
  }

  // 6) E2 弱 explicit。
  if (EXPLICIT_WEAK.test(text)) {
    if (QUESTION_LIKE.test(text)) return dropped('N', text, 'explicit wording in a question');
    const stripped = text.replace(EXPLICIT_WEAK, '').trim();
    if (stripped.length >= 4) {
      return {
        rule: 'E2',
        text,
        candidate: buildCandidate(text, 'E2', 'explicit', ctx.now),
      };
    }
    return dropped('N', text, 'explicit without object');
  }

  // 7) 只有结构化值、没有字段线索 → 丢弃；纯问答对 → Q。
  if (hasStructuredValue(text)) return dropped('N', text, 'bare structured value');

  if (
    ctx.previousAssistantText &&
    !QUESTION_LIKE.test(text.trim()) &&
    /[？?]|是什么|是多少|哪个|哪里|怎么|如何/.test(ctx.previousAssistantText)
  ) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || AGREEMENT_ONLY.test(trimmed) || QA_FILLER.test(trimmed)) {
      return dropped('N', text, 'qa filler reply');
    }
    return {
      rule: 'Q',
      text,
      candidate: buildCandidate(text, 'Q', 'qa', ctx.now),
      reason: 'qa-only reply, kept as candidate',
    };
  }
  return dropped('N', text, 'no admission rule matched');
}

/** 只做路由（不写库）：供测试与统计使用。 */
export function routeText(
  input: AutoCaptureInput & { autoEntries?: MemoryEntry[] },
): { rules: Partial<Record<AutoRule, number>>; direct: AutoRoutedUnit[]; pending: AutoRoutedUnit[]; dropped: AutoRoutedUnit[] } {
  const text = stripSynthetic(input.text);
  const result = {
    rules: {} as Partial<Record<AutoRule, number>>,
    direct: [] as AutoRoutedUnit[],
    pending: [] as AutoRoutedUnit[],
    dropped: [] as AutoRoutedUnit[],
  };
  if (!text) return result;
  if (/^\s*You are (?:a|an) /i.test(text) && text.length > 200) return result;
  const safeText = redactCredentialText(text).text;
  if (!safeText.trim()) return result;

  const ctx: RouterContext = {
    autoEntries: input.autoEntries ?? [],
    previousUserText: input.previousUserText,
    previousAssistantText: input.previousAssistantText,
    now: input.now ?? Date.now(),
  };
  let used = 0;
  for (const unit of splitUnits(safeText)) {
    const routed = routeUnit(unit, ctx);
    result.rules[routed.rule] = (result.rules[routed.rule] ?? 0) + 1;
    if (routed.rule === 'N') {
      result.dropped.push(routed);
      continue;
    }
    if (used >= MAX_PER_MESSAGE) {
      result.pending.push({ ...routed, reason: 'per-message cap reached, kept as candidate' });
      continue;
    }
    used += 1;
    if (routed.rule === 'E1' || routed.rule === 'S1' || routed.rule === 'D1') {
      result.direct.push(routed);
    } else if (routed.rule === 'C1') {
      result.direct.push(routed);
    } else {
      result.pending.push(routed);
    }
  }
  return result;
}

/** 兼容旧调用：只返回可直写的候选。 */
export function extractCandidates(input: AutoCaptureInput): AutoCandidate[] {
  const routed = routeText(input);
  return routed.direct
    .map((unit) => unit.candidate)
    .filter((candidate): candidate is AutoCandidate => candidate !== undefined);
}

function stableContent(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('时间：'))
    .join('\n')
    .trim();
}

function toDraft(candidate: AutoCandidate): MemoryCandidateDraft {
  const domain =
    candidate.signal === 'structured' || candidate.signal === 'decision' ? 'code' : 'uncertain';
  return {
    title: candidate.title,
    content: candidate.content,
    summary: candidate.summary,
    type: candidate.type as MemoryType,
    tags: candidate.tags,
    suggestedDomain: domain,
  };
}

export class AutoCaptureService {
  constructor(
    private readonly manager: MemoryManager,
    private readonly config: AutoCaptureConfig,
  ) {}

  /** 进程内串行：额度检查与候选写入必须在同一临界区，避免并发超额。 */
  private static queue: Promise<unknown> = Promise.resolve();

  async capture(input: AutoCaptureInput): Promise<AutoCaptureResult> {
    const run = () => this.captureInner(input);
    const next = AutoCaptureService.queue.then(run, run);
    AutoCaptureService.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async captureInner(input: AutoCaptureInput): Promise<AutoCaptureResult> {
    const empty = (): AutoCaptureResult => ({
      rules: {},
      direct: [],
      pending: [],
      dropped: [],
      written: 0,
      updated: 0,
      pendingCreated: 0,
      createdIds: [],
      skipped: [],
    });
    if (!this.config.enabled) return empty();
    const limit = Math.min(Math.max(0, this.config.maxWritesPerTurn), MAX_PER_MESSAGE);
    if (limit === 0) return empty();

    const existing = await this.manager.listMemories({ scope: input.scope, limit: 200 });
    const autoEntries = existing.filter(
      (entry) => entry.origin === 'agent' && entry.trust === 'low',
    );
    const routed: AutoCaptureResult = {
      ...routeText({ ...input, autoEntries }),
      written: 0,
      updated: 0,
      pendingCreated: 0,
      createdIds: [],
      skipped: [],
    };
    if (this.config.mode === 'shadow') return routed;

    const byTitle = new Map<string, MemoryEntry>();
    for (const entry of autoEntries) byTitle.set(normalizeTitle(entry.title), entry);

    const deferred: AutoRoutedUnit[] = [];
    let used = 0;
    for (const unit of routed.direct) {
      if (used >= limit) break;
      const candidate = unit.candidate;
      if (!candidate) continue;
      try {
        if (unit.rule === 'C1') {
          const target = autoEntries.find((entry) => entry.id === unit.targetId);
          if (!target) {
            routed.skipped.push(`${candidate.title}: target not found`);
            continue;
          }
          if (stableContent(target.content) === stableContent(candidate.content)) {
            routed.skipped.push(`${candidate.title}: unchanged`);
            continue;
          }
          const updated = await this.manager.updateMemoryContent({
            id: target.id,
            content: candidate.content,
            summary: candidate.summary,
            expectedRevision: target.revision,
            title: candidate.title,
          });
          if (updated.conflict || !updated.memory) {
            routed.skipped.push(`${candidate.title}: revision conflict`);
            continue;
          }
          routed.updated += 1;
          routed.createdIds.push(updated.memory.id);
          byTitle.set(candidate.title, updated.memory);
          used += 1;
          continue;
        }

        const hit = byTitle.get(candidate.title);
        if (hit && stableContent(hit.content) === stableContent(candidate.content)) {
          routed.skipped.push(`${candidate.title}: unchanged`);
          continue;
        }
        if (hit) {
          // 没有合法 C1 依据时不得按 title 覆盖既有事实：降级为待审候选。
          deferred.push({ ...unit, reason: 'title conflict' });
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
        routed.createdIds.push(entry.id);
        routed.written += 1;
        byTitle.set(candidate.title, entry);
        used += 1;
      } catch (error) {
        routed.skipped.push(
          `${candidate.title}: ${error instanceof Error ? error.message : 'write failed'}`,
        );
      }
    }

    // 候选预算独立于直写上限；仍按单条消息上限保护，超出记录 skipped 而不是静默丢弃。
    const PENDING_PER_MESSAGE = 6;
    const allPending = [...routed.pending, ...deferred];
    const pendingUnits = allPending.slice(0, PENDING_PER_MESSAGE);
    if (allPending.length > pendingUnits.length) {
      routed.skipped.push(`pending truncated: ${allPending.length - pendingUnits.length}`);
    }
    if (pendingUnits.length === 0) return routed;

    try {
      const room = await this.pendingRoom(input);
      if (room <= 0) {
        routed.skipped.push(`daily pending cap reached (${DAILY_PENDING_CAP})`);
        return routed;
      }
      const batch = pendingUnits.slice(0, room);
      if (batch.length < pendingUnits.length) {
        routed.skipped.push(`daily pending cap reached (${DAILY_PENDING_CAP})`);
      }
      const text = stripSynthetic(input.text);
      const deictic = routed.pending.some(
        (unit) => unit.reason === 'deictic reference needs clarification',
      );
      const digest = createDigest(
        deictic
          ? `${text}\u0000${input.previousUserText ?? ''}\u0000${input.previousAssistantText ?? ''}`
          : text,
      );
      const begun = await this.manager.beginCapture({
        contextKey: `auto:${input.scope.scope}:${input.scope.scopeKey}:${digest}`,
        sourceId: 'auto',
        trigger: 'auto',
        extractorVersion: 'auto-v1',
        scope: input.scope,
      });
      if (begun.status === 'started') {
        const drafts = batch
          .map((unit) => unit.candidate)
          .filter((candidate): candidate is AutoCandidate => candidate !== undefined)
          .map(toDraft);
        if (drafts.length > 0) {
          const completed = await this.manager.completeCapture({
            captureKey: begun.captureKey,
            leaseToken: begun.leaseToken,
            candidates: drafts,
          });
          routed.pendingCreated = completed.candidates.length;
        }
      } else if (begun.status === 'already_completed') {
        routed.skipped.push('candidates already captured for this message');
      } else {
        routed.skipped.push('capture already in progress');
      }
    } catch (error) {
      routed.skipped.push(
        `candidate write failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    return routed;
  }

  private async pendingRoom(input: AutoCaptureInput): Promise<number> {
    // 按「当天新增候选」计数，而不是「当前仍 pending」，避免批准后额度被重置。
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const today = await this.manager.countCandidatesSince({
      scope: input.scope,
      since: startOfDay,
    });
    return DAILY_PENDING_CAP - today;
  }
}

function createDigest(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return `${(hash >>> 0).toString(16)}-${text.length}`;
}
