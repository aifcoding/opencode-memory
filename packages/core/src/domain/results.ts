import type { MemoryEntry } from './types.js';
/** One memory returned by full-text retrieval. */
export interface MemoryRecallItem {
  memory: MemoryEntry;
  score: number;
}
/** Structured memory retrieval response. */
export interface RecallMemoriesResult {
  memories: MemoryRecallItem[];
}

/** Structured result distinguishing missing and soft-deleted memories. */
export type ReadMemoryResult =
  | { status: 'found'; memory: MemoryEntry }
  | { status: 'not_found'; id: number }
  | { status: 'deleted'; id: number };

/** Structured result for soft deletion. */
export type ForgetMemoryResult =
  | { status: 'deleted'; id: number }
  | { status: 'not_found'; id: number }
  | { status: 'already_deleted'; id: number };

/** Structured result for Pin operations, including quota and trust failures. */
export type PinResult =
  /** Pin succeeded and includes the stored memory and rendered size. */
  | { status: 'pinned'; memory: MemoryEntry; size: number; quota: number }
  /** Pin would exceed the configured rendered-character quota. */
  | { status: 'quota_exceeded'; id: number; size: number; quota: number }
  /** Summary mode was requested without an available summary. */
  | { status: 'summary_required'; id: number }
  /** The memory is low trust and cannot be pinned. */
  | { status: 'trust_denied'; id: number }
  | { status: 'not_found'; id: number }
  | { status: 'deleted'; id: number };

/** Structured result for removing a Pin. */
export type UnpinResult =
  | { status: 'unpinned'; memory: MemoryEntry }
  | { status: 'not_found'; id: number }
  | { status: 'deleted'; id: number };

/** The pinned entries and the exact text/size used for reference injection. */
export interface PinnedContext {
  entries: MemoryEntry[];
  text: string;
  size: number;
}

export type ArchiveSummaryResult =
  | { status: 'inserted'; id: string }
  | { status: 'duplicate'; id: string };

export interface SummaryEntry {
  id: string;
  contextKey: string;
  text: string;
  createdAt: number;
}
export interface SummaryRecallItem {
  summary: SummaryEntry;
  score: number;
}
export interface RecallSummariesResult {
  summaries: SummaryRecallItem[];
}

export type DeleteContextValueResult =
  | { status: 'deleted'; key: string }
  | { status: 'not_found'; key: string };
