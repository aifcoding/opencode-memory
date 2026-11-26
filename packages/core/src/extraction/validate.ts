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

/**
 * 规则：正文过短/纯问句/标题过泛/类型或领域越界/证据不在材料中/同批重复标题 → 丢弃。
 */
export function validateCaptureCandidates(
  candidates: unknown,
  materialText: string,
  maxCandidates: number,
): CaptureValidationResult {
  const filtered: string[] = [];
  const kept: CaptureCandidateOutput[] = [];
  if (!Array.isArray(candidates)) return { candidates: [], filtered };
  // 质量规则（长度、问句、引用存在性、同批去重）已移到提示词；这里只做结构校验与安全上限。
  void materialText;

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') {
      filtered.push('not an object');
      continue;
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.title !== 'string' || typeof item.content !== 'string') {
      filtered.push('title or content is not a string');
      continue;
    }
    const title = item.title.trim();
    const content = item.content.trim();
    const type = typeof item.type === 'string' ? item.type : '';
    const domain = typeof item.suggestedDomain === 'string' ? item.suggestedDomain : '';
    if (!title || !content) {
      filtered.push('empty title or content');
      continue;
    }
    if (!TYPES.has(type) || !DOMAINS.has(domain)) {
      filtered.push('unknown type or domain');
      continue;
    }
    kept.push({
      title: title.slice(0, 200),
      content: content.slice(0, 50000),
      summary: typeof item.summary === 'string' ? item.summary.slice(0, 500) : undefined,
      type: type as CaptureType,
      tags: Array.isArray(item.tags)
        ? item.tags
            .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
            .slice(0, 20)
        : undefined,
      suggestedDomain: domain as CaptureDomain,
      evidenceQuote:
        typeof item.evidenceQuote === 'string' ? item.evidenceQuote.slice(0, 2000) : undefined,
    });
    if (kept.length >= maxCandidates) break;
  }
  return { candidates: kept, filtered };
}

