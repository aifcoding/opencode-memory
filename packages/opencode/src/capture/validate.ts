import type { z } from 'zod';
import type { captureOutputSchema } from './schema';

type Candidate = z.infer<ReturnType<typeof captureOutputSchema>>['candidates'][number];

export interface ValidationResult {
  candidates: Candidate[];
  filtered: string[];
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 对模型输出做本地后置校验：模型可能不遵守提示词，不能直接信任。
 * 规则：正文过短/纯问句/标题过泛/证据不在材料中/同批重复标题 → 丢弃。
 */
export function validateCaptureCandidates(
  candidates: Candidate[],
  materialText: string,
  maxCandidates: number,
): ValidationResult {
  const filtered: string[] = [];
  const material = normalize(materialText);
  const seenTitles = new Set<string>();
  const kept: Candidate[] = [];

  for (const candidate of candidates) {
    const title = normalize(candidate.title);
    const content = normalize(candidate.content);
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
    if (candidate.evidenceQuote) {
      const quote = normalize(candidate.evidenceQuote);
      if (quote.length < 8) {
        filtered.push('evidence quote too short');
        continue;
      }
      if (!material.includes(quote)) {
        filtered.push('evidence quote not found in material');
        continue;
      }
    }
    const key = title.toLowerCase();
    if (seenTitles.has(key)) {
      filtered.push('duplicate title in batch');
      continue;
    }
    seenTitles.add(key);
    kept.push(candidate);
    if (kept.length >= maxCandidates) break;
  }

  return { candidates: kept, filtered };
}
