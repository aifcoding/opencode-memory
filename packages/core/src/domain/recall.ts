import { MemoryValidationError } from '../errors.js';
import type { MemoryRef } from './ref.js';
import { memoryRef } from './ref.js';
import type { MemoryEntry, MemoryType, Origin, ScopeRef, Trust } from './types.js';

export const MEMORY_PROJECTIONS = ['title', 'summary', 'full'] as const;
/** Layer selection for a recall result. */
export type MemoryProjection = (typeof MEMORY_PROJECTIONS)[number];

/** Where a Summary projection value came from. */
export type SummarySource = 'stored' | 'content_preview';

/** Character count used when a memory has no stored summary. */
export const DEFAULT_SUMMARY_FALLBACK_CHARACTERS = 200;

/** Public metadata shared by every projection. */
export interface RecallMemoryBase {
  id: number;
  ref: MemoryRef;
  title: string;
  type: MemoryType;
  tags: string[];
  origin: Origin;
  trust: Trust;
  scope: ScopeRef;
  createdAt: number;
  updatedAt: number;
}

/** L0 projection: title and public metadata only. */
export interface TitleMemoryProjection extends RecallMemoryBase {
  projection: 'title';
}

/** L1 projection: title, effective summary, and public metadata. */
export interface SummaryMemoryProjection extends RecallMemoryBase {
  projection: 'summary';
  summary: string;
  summarySource: SummarySource;
}

/** L2 projection: title, stored summary, full content, and public metadata. */
export interface FullMemoryProjection extends RecallMemoryBase {
  projection: 'full';
  summary: string;
  content: string;
}

export type ProjectedMemory =
  | TitleMemoryProjection
  | SummaryMemoryProjection
  | FullMemoryProjection;

/** One projected hit plus its retrieval score and budgeted text length. */
export interface ProjectedMemoryRecallItem {
  memory: ProjectedMemory;
  score: number;
  characterCount: number;
}

/** L0 navigation item for considered hits outside the Detail budget. */
export interface RecallOverflowItem {
  projection: 'title';
  id: number;
  ref: MemoryRef;
  title: string;
  trust: Trust;
  score: number;
}

/** Character authority for the Detail stage. */
export interface RecallBudget {
  maxCharacters: number;
  preferSummary: boolean;
  maxOverflowItems: number;
  maxOverflowCharacters: number;
}

export type RecallBudgetInput = Partial<RecallBudget>;

export const DEFAULT_RECALL_BUDGET: RecallBudget = Object.freeze({
  maxCharacters: 3000,
  preferSummary: true,
  maxOverflowItems: 10,
  maxOverflowCharacters: 1500,
});

/** Unified recall request. */
export interface RecallMemoriesInput {
  query: string;
  scope?: ScopeRef;
  limit?: number;
  projection?: MemoryProjection;
  budget?: RecallBudgetInput;
}

/** Unified recall response with Detail, Overflow, and budget metadata. */
export interface RecallMemoriesResult {
  memories: ProjectedMemoryRecallItem[];
  overflow: RecallOverflowItem[];
  requestedProjection: MemoryProjection;
  consideredCount: number;
  usedCharacters: number;
  overflowUsedCharacters: number;
  truncated: boolean;
  degradedCount: number;
  omittedCount: number;
}

/** A resolved search hit; deleted or missing ids are already filtered out. */
export interface RecallHit {
  memory: MemoryEntry;
  score: number;
}

const DETAIL_SEPARATOR = '\n\n';
const OVERFLOW_SEPARATOR = '\n';

function validateInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new MemoryValidationError(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

/** Merge partial budget input with defaults and validate every field. */
export function resolveRecallBudget(input: RecallBudgetInput = {}): RecallBudget {
  const maxCharacters = validateInteger(
    input.maxCharacters ?? DEFAULT_RECALL_BUDGET.maxCharacters,
    'maxCharacters',
    1,
    20000,
  );
  const preferSummary = input.preferSummary ?? DEFAULT_RECALL_BUDGET.preferSummary;
  if (typeof preferSummary !== 'boolean')
    throw new MemoryValidationError('preferSummary must be a boolean');
  const maxOverflowItems = validateInteger(
    input.maxOverflowItems ?? DEFAULT_RECALL_BUDGET.maxOverflowItems,
    'maxOverflowItems',
    0,
    20,
  );
  const maxOverflowCharacters = validateInteger(
    input.maxOverflowCharacters ?? DEFAULT_RECALL_BUDGET.maxOverflowCharacters,
    'maxOverflowCharacters',
    0,
    10000,
  );
  return { maxCharacters, preferSummary, maxOverflowItems, maxOverflowCharacters };
}

/** Effective summary and its provenance. Never writes back to storage. */
export function effectiveSummary(memory: MemoryEntry): {
  summary: string;
  summarySource: SummarySource;
} {
  if (memory.summary.trim().length > 0) return { summary: memory.summary, summarySource: 'stored' };
  return {
    summary: memory.content.slice(0, DEFAULT_SUMMARY_FALLBACK_CHARACTERS),
    summarySource: 'content_preview',
  };
}

function recallMemoryBase(memory: MemoryEntry): RecallMemoryBase {
  return {
    id: memory.id,
    ref: memoryRef(memory.id),
    title: memory.title,
    type: memory.type,
    tags: [...memory.tags],
    origin: memory.origin,
    trust: memory.trust,
    scope: { scope: memory.scope, scopeKey: memory.scopeKey },
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

/** Build the requested projection for one memory. */
export function projectMemory(memory: MemoryEntry, projection: MemoryProjection): ProjectedMemory {
  const base = recallMemoryBase(memory);
  if (projection === 'title') return { ...base, projection: 'title' };
  if (projection === 'summary') {
    const { summary, summarySource } = effectiveSummary(memory);
    return { ...base, projection: 'summary', summary, summarySource };
  }
  return { ...base, projection: 'full', summary: memory.summary, content: memory.content };
}

/** Canonical Detail text used for character accounting. */
export function detailText(projected: ProjectedMemory): string {
  if (projected.projection === 'title') return projected.title;
  if (projected.projection === 'summary') return `${projected.title}\n${projected.summary}`;
  return `${projected.title}\n${projected.content}`;
}

/** Build the L0 navigation item for one considered hit. */
export function toOverflowItem(memory: MemoryEntry, score: number): RecallOverflowItem {
  return {
    projection: 'title',
    id: memory.id,
    ref: memoryRef(memory.id),
    title: memory.title,
    trust: memory.trust,
    score,
  };
}

/** Canonical Overflow text used for character accounting. */
export function overflowText(item: RecallOverflowItem): string {
  return `[id=${item.id}] ${item.ref} ${item.title} trust=${item.trust} score=${item.score}`;
}

/**
 * Two-phase recall: build a continuous Detail prefix under `maxCharacters`,
 * then a continuous L0 Overflow prefix under the dual Overflow budget.
 */
export function buildRecallResult(
  hits: RecallHit[],
  requestedProjection: MemoryProjection,
  budget: RecallBudget,
): RecallMemoriesResult {
  const memories: ProjectedMemoryRecallItem[] = [];
  let usedCharacters = 0;
  let degradedCount = 0;
  let truncated = false;
  let overflowStartIndex = hits.length;

  for (let index = 0; index < hits.length; index++) {
    const { memory, score } = hits[index];
    const separator = memories.length > 0 ? DETAIL_SEPARATOR.length : 0;
    const projected = projectMemory(memory, requestedProjection);
    const text = detailText(projected);
    if (usedCharacters + separator + text.length <= budget.maxCharacters) {
      memories.push({ memory: projected, score, characterCount: text.length });
      usedCharacters += separator + text.length;
      continue;
    }
    if (requestedProjection === 'full' && budget.preferSummary) {
      const degraded = projectMemory(memory, 'summary');
      const degradedText = detailText(degraded);
      if (usedCharacters + separator + degradedText.length <= budget.maxCharacters) {
        memories.push({ memory: degraded, score, characterCount: degradedText.length });
        usedCharacters += separator + degradedText.length;
        degradedCount += 1;
        continue;
      }
    }
    truncated = true;
    overflowStartIndex = index;
    break;
  }

  const overflow: RecallOverflowItem[] = [];
  let overflowUsedCharacters = 0;
  if (budget.maxOverflowItems > 0 && budget.maxOverflowCharacters > 0) {
    for (let index = overflowStartIndex; index < hits.length; index++) {
      if (overflow.length >= budget.maxOverflowItems) break;
      const item = toOverflowItem(hits[index].memory, hits[index].score);
      const text = overflowText(item);
      const separator = overflow.length > 0 ? OVERFLOW_SEPARATOR.length : 0;
      if (overflowUsedCharacters + separator + text.length > budget.maxOverflowCharacters) break;
      overflow.push(item);
      overflowUsedCharacters += separator + text.length;
    }
  }

  return {
    memories,
    overflow,
    requestedProjection,
    consideredCount: hits.length,
    usedCharacters,
    overflowUsedCharacters,
    truncated,
    degradedCount,
    omittedCount: hits.length - memories.length - overflow.length,
  };
}
