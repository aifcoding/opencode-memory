/**
 * 提取结果本地校验（不信任模型输出）。
 * 任何宿主都复用这一份规则，适配器只负责提供材料与生成器。
 */

export const CAPTURE_TYPES = ['preference', 'fact', 'decision', 'solution', 'convention'] as const;
export const CAPTURE_DOMAINS = ['code', 'user', 'business', 'uncertain'] as const;

export type CaptureType = (typeof CAPTURE_TYPES)[number];
export type CaptureDomain = (typeof CAPTURE_DOMAINS)[number];

export interface CaptureCandidateOutput {
  title: string;
  content: string;
  summary?: string;
  type: CaptureType;
  tags?: string[];
  suggestedDomain: CaptureDomain;
  evidenceQuote?: string;
}

export interface CaptureValidationResult {
  candidates: CaptureCandidateOutput[];
  filtered: string[];
}

const TYPES = new Set<string>(CAPTURE_TYPES);
const DOMAINS = new Set<string>(CAPTURE_DOMAINS);

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 规则：正文过短/纯问句/标题过泛/类型或领域越界/证据不在材料中/同批重复标题 → 丢弃。
 */
export function validateCaptureCandidates(
  candidates: unknown,
  materialText: string,
  maxCandidates: number,
): CaptureValidationResult {
  const filtered: string[] = [];
  const material = normalize(materialText);
  const seenTitles = new Set<string>();
  const kept: CaptureCandidateOutput[] = [];
  if (!Array.isArray(candidates)) return { candidates: [], filtered };

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') {
      filtered.push('not an object');
      continue;
    }
    const item = raw as Record<string, unknown>;
    const title = normalize(String(item.title ?? ''));
    const content = normalize(String(item.content ?? ''));
    const type = String(item.type ?? '');
    const domain = String(item.suggestedDomain ?? '');
    const evidence = normalize(String(item.evidenceQuote ?? ''));

    if (title.length < 2) {
      filtered.push('title too short');
      continue;
    }
    if (content.length < 20) {
      filtered.push('content too short');
      continue;
    }
    if (/[？?]\s*$/.test(content) && content.length < 60) {
      filtered.push('question-like content');
      continue;
    }
    if (!TYPES.has(type) || !DOMAINS.has(domain)) {
      filtered.push('unknown type or domain');
      continue;
    }
    if (evidence.length < 8) {
      filtered.push('evidence quote too short');
      continue;
    }
    if (!material.includes(evidence)) {
      filtered.push('evidence quote not found in material');
      continue;
    }
    const key = title.toLowerCase();
    if (seenTitles.has(key)) {
      filtered.push('duplicate title in batch');
      continue;
    }
    seenTitles.add(key);
    kept.push({
      title: title.slice(0, 200),
      content: content.slice(0, 50000),
      summary: item.summary ? String(item.summary).slice(0, 500) : undefined,
      type: type as CaptureType,
      tags: Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 20)
        : undefined,
      suggestedDomain: domain as CaptureDomain,
      evidenceQuote: evidence,
    });
    if (kept.length >= maxCandidates) break;
  }
  return { candidates: kept, filtered };
}
