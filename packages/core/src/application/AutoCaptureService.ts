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
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=：]\s*\S+/i,
  // 大写环境变量风格键名：MY_DB_PWD=xxx / API_KEY: xxx
  /\b[A-Z][A-Z0-9_]*(?:PWD|PASSWD|PASSWORD|KEY|TOKEN|SECRET)\s*[:=：]\s*\S+/, 
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
  // JSON 字段赋值："password": "abc"
  /"(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization)"\s*:\s*"[^"]+"/i,
  // Markdown 加粗字段：**password**=abc / **token**: abc
  /\*\*\s*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*\*\*\s*[:=]\s*\S+/i,
];

/**
 * E1：只认单元开头的明确保存指令，避免「文档里写着'记住…'」被当成保存意图。
 * 前缀与正文分开解析：正文上限对齐存储上限，不按问句/长度做质量判断。
 * `记住：甲` 的冒号由分隔组消费，不会残留在正文里；`记住了` 这类确认语不算指令。
 */
const EXPLICIT_SAVE =
  /^(?:请)?(?:记住|记一下|保存下来)(?!了|吧|啊|哦|嗯|哈)(?:\s*[:：,，]\s*)?([\s\S]*)$/;
/** 否定的是「保存」这个动作本身（不要记住 X），而不是保存一条禁止性规则（记住：不要做 X）。 */
const NEGATED_SAVE = /^(?:请)?(?:不要|别|不用|无需|不需要)\s*(?:记住|记一下|保存下来|记下)/;
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
/** 通用绑定实体形状：纯 ASCII 必须无空格；含中文可带空格（如「kit 仓库」）。 */
const BINDING_ENTITY = /^(?:[A-Za-z][A-Za-z0-9._-]*|.*[\u4e00-\u9fa5].*)$/;
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
/** 完整决策（带原因/依据）：显式保存路径下可直接直写。 */
const DECISION_WITH_BASIS =
  /(?:本项目|项目\s*[A-Za-z][A-Za-z0-9._-]*)?\s*(?:已)?\s*(?:决定|采用|选用|否决|放弃)\s*(?:采用\s*)?([A-Za-z][A-Za-z0-9.+-]*|“[^”]{1,40}”|"[^"]{1,40}")\s*[，,]\s*(?:原因|因为|由于|理由)\s*[是为]?\s*.{2,}/;
const QUOTED = /“[^”]{1,40}”|"[^"]{1,40}"/;

const CORRECTION_PAIR = /不是\s*([^，。；\s]{1,20})\s*[，,]?\s*(?:而是|是|应该(?:是)?)\s*([^。；\n]{1,60})$/;
const CORRECTION_SET = /^(.{1,30}?)\s*(?:改成|更正为|应该是)\s*([^。；\n]{1,60})$/;

const QUESTION_LIKE = /[？?]\s*$|(?:吗|呢)\s*[。.!！]?\s*$/;
const HEDGE = /(?:如果|假如|假设|是否|会不会|能不能|若是)/;

const REFERENCE = /上次|之前|以前|照旧|继续之前|上次那个|还记得/;

/** 纯确认/填充语：作为问答对答案时没有信息量，落候选也是噪声。 */
const AGREEMENT_ONLY = /^(?:好|好的|可以|行|对|嗯|是|收到|了解|明白|没问题|ok|随便|都行)[。.!！]?$/i;
const QA_FILLER = /^(?:你再看看|再看|怎么处理|怎么办|然后呢|接下来呢|具体呢)[。.!！]?$/;

/** 纯指代正文：只允许精确指代词，不允许任意实义尾巴（「这个端口8080」是自包含正文）。 */
const DEICTIC =
  /^(?:这个|那个|这些|那些|这|那|它|这里|那里|上面|下面|上述内容|上面那段|(?:我们)?(?:刚才|之前|前面|上面)(?:说的|提到的|讲的)?)(?:东西|内容|配置|方案|信息|结论|那段|这一段|这段话)?[。.!！]?$/;
/** 较长的口语指代：「我们刚才讨论的那个方案」，必须以指代名词结尾。 */
const DEICTIC_LONG =
  /^(?:我们)?(?:刚才|之前|前面|上面)(?:讨论|说|提到|讲)的?.{0,12}(?:那个|方案|内容|结论|部分|地址|配置|字段)[。.!！]?$/;
function isDeicticOnly(body: string): boolean {
  return DEICTIC.test(body) || DEICTIC_LONG.test(body);
}
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
/** 整段就是一条凭据赋值（标签 + 值），没有其他有效正文。 */
const CREDENTIAL_ASSIGNMENT_ONLY =
  /^\s*(?:[^\s:=是，。]{0,20}\s*)?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|密码|口令|密钥|令牌|验证码|账号密码)\s*(?:是|为|[:：=])\s*[^\s，。；]+[\s。；;]*$/i;

/** 脱敏后只剩凭据标签/分隔符（如 `api[REDACTED]`、`数据库[REDACTED]`）→ 视为仅凭据。 */
const CREDENTIAL_RESIDUE_WORDS =
  /\[REDACTED\]|\b(?:api|key|token|secret|password|passwd|pwd|access|private|public|db|database)\b|密钥|密码|口令|令牌|验证码|账号密码|数据库|凭据/gi;
function isCredentialOnlyResidue(text: string): boolean {
  const residue = text
    .replace(CREDENTIAL_RESIDUE_WORDS, '')
    .replace(/[\s:：=，,。；;'"`·-]/g, '');
  return residue.length === 0;
}

const SAFE_CREDENTIAL_VALUE =
  /^(?:(?:[Ee][Nn][Vv]|环境变量)(?:\s*[:：=]?\s*[A-Z][A-Z0-9_]*)?|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|[Xx]{3,}|\*{3,})$/;

/** 环境变量引用（安全，不是秘密本体）。 */
const ENV_REF = /(?:(?:[Ee][Nn][Vv]|环境变量)\s*[:：=]?\s*|\$)[A-Z][A-Z0-9_]*/;

export function redactCredentialText(text: string): { text: string; hits: number } {
  let hits = 0;
  let out = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    out = out.replace(global, (match) => {
      // 只有「值整体就是占位符」才放行；`password=环境变量abc` 仍要脱敏。
      const value = match
        .replace(/^[^:=：是为]*[:=：是为]\s*/s, '')
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
  const urlRanges: Array<[number, number]> = [];
  for (const match of text.matchAll(new RegExp(URL_INLINE.source, 'gi'))) {
    values.add(match[0]);
    urlRanges.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  for (const match of text.matchAll(new RegExp(HOST_PORT_INLINE.source, 'gi'))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    // URL 内的 host:port 属于同一个对象，不重复计数。
    if (urlRanges.some(([from, to]) => start >= from && end <= to)) continue;
    values.add(match[0]);
  }
  for (const match of text.matchAll(new RegExp(ABS_PATH_INLINE.source, 'gi'))) values.add(match[0].trim());
  for (const match of text.matchAll(new RegExp(SEMVER_INLINE.source, 'gi'))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    // URL / host:port 里的数字片段不是版本号。
    if (urlRanges.some(([from, to]) => start >= from && end <= to)) continue;
    values.add(match[0]);
  }
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

function stripSyntheticBlocks(text: string): string {
  return text.replace(SYNTHETIC_BLOCK, ' ').trim();
}

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

/** 指代保存：只在上一轮人工消息里能唯一确定一个结构化对象时保存；助手内容不作事实来源。 */
function resolveDeictic(ctx: RouterContext): string | undefined {
  const text = ctx.previousUserText;
  if (!text?.trim()) return undefined;
  if (structuredValues(text).length === 1) return text.trim();
  return undefined;
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

/** 只有带明确记忆意图的纠正才允许更新既有条目；普通聊天里的纠正不碰记忆。 */
const EXPLICIT_UPDATE_INTENT =
  /(?:记住|记一下|保存下来|更正|纠正|改为|改成|更新(?:这条|记忆|记录))/;

/** 纠正：只有唯一匹配的低信任目标且旧值相符才允许更新。 */
function routeCorrection(text: string, ctx: RouterContext): AutoRoutedUnit | undefined {
  if (!EXPLICIT_UPDATE_INTENT.test(text)) return undefined;
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
    // 只存规范化后的新状态，不把「不是旧值，是新值」的叙述留在记忆里。
    candidate: buildCandidate(
      `${target.title} = ${fieldValue.value}`,
      'C1',
      'correction',
      ctx.now,
      target.title,
    ),
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
      if (!BINDING_ENTITY.test(entity)) {
        return dropped('N', text, 'invalid binding entity');
      }
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

const HYPOTHESIS_LEAD = /(?:^|[，,。；;]\s*)(?:如果|假如|假设|是否|若是|会不会|能不能)/;
const TEMPORARY_LEAD = /(?:本次|这次|今天先|暂时|临时|先这样)/;

/** 陈述状态闸：问句、假设、临时安排不进入任何形态。 */
function statementGate(text: string): string | undefined {
  const trimmed = text.trim();
  if (QUESTION_LIKE.test(trimmed)) return 'user question';
  if (HYPOTHESIS_LEAD.test(trimmed)) return 'hypothesis or conditional';
  if (TEMPORARY_LEAD.test(trimmed) && !hasStructuredValue(trimmed)) return 'temporary arrangement';
  return undefined;
}

function routeUnit(text: string, ctx: RouterContext): AutoRoutedUnit {
  const trimmed = text.trim();

  // 1) 明确纠正：只有带明确记忆意图的纠正才更新既有条目；聊天里的普通纠正不碰记忆。
  const correction = routeCorrection(text, ctx);
  if (correction?.rule === 'C1') return correction;

  // 2) 显式保存：记住/记一下/保存下来 + 正文。不评价价值、不降候选、不按问句/长度拒绝。
  const save = text.match(EXPLICIT_SAVE);
  if (save) {
    const body = save[1]!.trim();
    // 只有「不要记住 X」这类否定动作才取消；「记住：不要做 X」是保存一条禁止规则。
    if (NEGATED_SAVE.test(trimmed)) return dropped('N', text, 'negated save');
    // 纯指代：仅在上下文能唯一确定对象时保存，否则明确澄清（不能静默当没发生）。
    if (isDeicticOnly(body) && !hasStructuredValue(body)) {
      const resolved = resolveDeictic(ctx);
      if (!resolved) return dropped('N', text, 'deictic save needs clarification');
      const candidate = buildCandidate(resolved, 'E1', 'explicit', ctx.now);
      if (candidate && PREFERENCE.test(resolved)) candidate.type = 'preference';
      return { rule: 'E1', text, candidate };
    }
    if (!body || /^[\p{P}\s]+$/u.test(body)) {
      return dropped('N', text, 'explicit save without content');
    }
    if (CREDENTIAL_ASSIGNMENT_ONLY.test(body) && !ENV_REF.test(body)) {
      return dropped('N', text, 'credential-only save');
    }
    const redacted = redactCredentialText(body);
    // 只有在真正命中凭据、且脱敏后只剩凭据标签时才判定「仅凭据」。
    if (redacted.hits > 0 && isCredentialOnlyResidue(redacted.text)) {
      return dropped('N', text, 'credential-only save');
    }
    const candidate = buildCandidate(redacted.text, 'E1', 'explicit', ctx.now);
    if (candidate && PREFERENCE.test(redacted.text)) candidate.type = 'preference';
    return { rule: 'E1', text, candidate };
  }
  // 有保存指令无正文：意图明确但对象缺失，记录澄清原因。
  if (EXPLICIT_SAVE.test(trimmed) && !text.match(EXPLICIT_SAVE)?.[1]?.trim()) {
    return dropped('N', text, 'explicit save without content');
  }

  // 3) 完整顶层行为指令：以后/统一/禁止/不要/默认/一律（非问句、有明确对象）。
  if (NEGATED_SAVE.test(trimmed)) return dropped('N', text, 'negated save');
  const behavior =
    trimmed.match(/^(?:本项目\s*[：:，,]?\s*)?(?:以后|下次)[，,：:]?\s*(.+)$/) ??
    trimmed.match(/^(?:本项目\s*[：:，,]?\s*)?(?:统一|一律|全部|禁止|不要)\s*(.+)$/) ??
    trimmed.match(/^(?:本项目\s*[：:，,]?\s*)?默认\s*(?:使用|走|用|开启|关闭|只|必须)(.+)$/) ??
    trimmed.match(/^(?:from now on|always|never|default to)\b\s*(.+)$/i);
  if (behavior) {
    const body = behavior[1]!.trim();
    const objectLike = body.length >= 2 && !/^(?:再|回头|继续|看|如果|假如|假设)/.test(body);
    if (!QUESTION_LIKE.test(trimmed) && !HEDGE_OR_EXAMPLE.test(trimmed) && objectLike) {
      const candidate = buildCandidate(trimmed, 'E1', 'explicit', ctx.now);
      if (candidate) candidate.type = 'preference';
      return { rule: 'E1', text, candidate };
    }
  }

  // 4) 隐式内容：规则层一律不采（交给压缩/手动 LLM 提取）。
  //    纠正意图存在但目标不唯一/不合法时，保留纠正的具体原因，便于解释为什么不更新。
  if (correction?.rule === 'C2') {
    return dropped('N', text, correction.reason ?? 'correction target not determinate');
  }
  return dropped('N', text, 'no explicit memory instruction');
}

export function routeText(
  input: AutoCaptureInput & { autoEntries?: MemoryEntry[] },
): { rules: Partial<Record<AutoRule, number>>; direct: AutoRoutedUnit[]; pending: AutoRoutedUnit[]; dropped: AutoRoutedUnit[] } {
  const result = {
    rules: {} as Partial<Record<AutoRule, number>>,
    direct: [] as AutoRoutedUnit[],
    pending: [] as AutoRoutedUnit[],
    dropped: [] as AutoRoutedUnit[],
  };
  // 来源准入：只有人工材料能作为「用户陈述」；注入/未知来源一律不采。
  if (input.current?.origin !== 'human') return result;
  // 显式保存：只剥离注入块，保留代码块/缩进/换行，正文原样入库；凭据在 routeUnit 内按正文脱敏。
  const blocksStripped = stripSyntheticBlocks(input.current.text);
  const explicitWhole = EXPLICIT_SAVE.test(blocksStripped);
  const text = explicitWhole ? blocksStripped : stripSynthetic(input.current.text);
  if (!text) return result;
  if (/^\s*You are (?:a|an) /i.test(text) && text.length > 200) return result;
  const safeText = explicitWhole ? text : redactCredentialText(text).text;
  if (!safeText.trim()) return result;

  const ctx: RouterContext = {
    autoEntries: input.autoEntries ?? [],
    previousUserText:
      input.previousUser?.origin === 'human' ? input.previousUser.text : undefined,
    previousAssistantText:
      input.previousAssistant?.origin === 'model' ? input.previousAssistant.text : undefined,
    now: input.now ?? Date.now(),
  };
  const whole = safeText.trim();
  const units = EXPLICIT_SAVE.test(whole) ? [whole] : splitUnits(safeText);
  for (const unit of units) {
    const routed = routeUnit(unit, ctx);
    result.rules[routed.rule] = (result.rules[routed.rule] ?? 0) + 1;
    if (routed.rule === 'E1' || routed.rule === 'C1') {
      result.direct.push(routed);
    } else {
      // 规则层不再产生隐式候选；非直写一律记录丢弃原因。
      result.dropped.push({ ...routed, rule: 'N' });
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

/** 只剥离本条自动生成的尾部时间戳元数据，用户正文里的「时间：…」原样保留。 */
function stableContent(content: string): string {
  return content
    .replace(/\n?时间：\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*$/, '')
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
    // 规则层只处理用户明确指令：不再按 maxWritesPerTurn 截断（该额度保留给 LLM 提取/候选路径）。
    if (this.config.maxWritesPerTurn <= 0) return empty();

    // 来源准入在任何读库/写库之前：注入消息（automation/压缩摘要/系统消息）不得进入规则采集。
    if (input.current?.origin !== 'human') {
      return { ...empty(), skipped: [`non-human-origin:${input.current?.origin ?? 'missing'}`] };
    }

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

    let used = 0;
    for (const unit of routed.direct) {
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
          // 标题不是身份键：同标题不同正文不覆盖既有记忆，换唯一标题新建，显式保存必须落地。
          let title = candidate.title;
          for (let index = 2; index <= 20; index += 1) {
            const next = normalizeTitle(`${candidate.title} ${index}`);
            if (next && !byTitle.has(next)) {
              title = next;
              break;
            }
          }
          const entry = await this.manager.storeMemory({
            title,
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
          byTitle.set(title, entry);
          used += 1;
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

    return routed;
  }
}

function createDigest(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return `${(hash >>> 0).toString(16)}-${text.length}`;
}
