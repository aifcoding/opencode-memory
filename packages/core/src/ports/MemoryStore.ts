import type {
  MemoryEntry,
  Origin,
  PinMode,
  Scope,
  ScopeRef,
  Trust,
  MemoryType,
} from '../domain/types.js';
import type {
  BeginCaptureInput,
  BeginCaptureResult,
  CompleteCaptureInput,
  CompleteCaptureResult,
  FailCaptureResult,
  ListMemoryCandidatesInput,
  MemoryCandidate,
  ReadMemoryCandidateResult,
  ReviewMemoryCandidateResult,
} from '../domain/capture.js';
import type { SummaryEntry } from '../domain/results.js';

export interface CreateMemoryInput {
  scope: ScopeRef;
  origin: Origin;
  trust: Trust;
  title: string;
  content: string;
  summary?: string;
  type?: MemoryType;
  tags?: string[];
  pinnedAt?: number | null;
  pinMode?: PinMode;
  embedding?: Uint8Array | null;
  embedModel?: string | null;
  embedDim?: number | null;
}

export interface MetaPatch {
  title?: string;
  summary?: string;
  type?: MemoryType;
  tags?: string[];
  pinnedAt?: number | null;
  pinMode?: PinMode;
}

export interface UpdateContentResult {
  memory: MemoryEntry | null;
  conflict: boolean;
}

export interface SearchHit {
  id: number;
  score: number;
}

export interface SearchOptions {
  scope?: ScopeRef;
  limit?: number;
}

export interface ListByScopeOptions {
  type?: MemoryType;
  limit?: number;
}

export interface SummaryArchiveInput {
  id: string;
  contextKey: string;
  text: string;
  createdAt: number;
}

export interface SummaryResult {
  id: string;
  contextKey: string;
  text: string;
  createdAt: number;
  score: number;
}

/**
 * Synchronous low-level persistence port. MemoryManager exposes the asynchronous
 * public boundary and owns validation and domain result mapping.
 */
export interface MemoryStore {
  create(input: CreateMemoryInput): MemoryEntry;
  get(id: number): MemoryEntry | null;
  updateMeta(id: number, patch: MetaPatch): MemoryEntry | null;
  updateContent(
    id: number,
    content: string,
    expectedRevision: number,
    title?: string,
  ): UpdateContentResult;
  softDelete(id: number): boolean;
  restore(id: number): boolean;
  listByScope(scope: Scope, scopeKey: string, options?: ListByScopeOptions): MemoryEntry[];
  listPinned(scope: Scope, scopeKey: string): MemoryEntry[];
  pinWithinQuota(
    id: number,
    pinMode: PinMode,
    summary: string,
    quota: number,
  ): { ok: boolean; size: number };
  search(query: string, options?: SearchOptions): SearchHit[];
  archiveSummary(input: SummaryArchiveInput): boolean;
  searchSummaries(query: string, limit?: number): SummaryResult[];
  /** Optional capability: read one summary by its globally unique id. */
  getSummary?(id: string): SummaryEntry | null;

  setKv(contextKey: string, key: string, value: string): void;
  getKv(contextKey: string, key: string): string | null;
  listKv(contextKey: string): Record<string, string>;
  deleteKv(contextKey: string, key: string): boolean;

  close(): void;
  beginCapture?(input: BeginCaptureInput): BeginCaptureResult;
  completeCapture?(input: CompleteCaptureInput): CompleteCaptureResult;
  failCapture?(captureKey: string, leaseToken: string, errorCode: string): FailCaptureResult;
  listMemoryCandidates?(input: ListMemoryCandidatesInput): MemoryCandidate[];
  readMemoryCandidate?(input: { id: number; scope: ScopeRef }): ReadMemoryCandidateResult;
  reviewMemoryCandidate?(input: {
    id: number;
    decision: 'approve' | 'reject';
    scope: ScopeRef;
  }): ReviewMemoryCandidateResult;
}
