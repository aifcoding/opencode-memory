import type { MemoryEntry, MemoryType, Origin, PinMode, ScopeRef, Trust } from '../domain/types.js';
import type {
  BeginCaptureInput,
  BeginCaptureResult,
  CompleteCaptureInput,
  CompleteCaptureResult,
  FailCaptureResult,
  ListMemoryCandidatesInput,
  MemoryCandidate,
  MemoryCandidateTargetInput,
  ReadMemoryCandidateResult,
  ReviewMemoryCandidateInput,
  ReviewMemoryCandidateResult,
} from '../domain/capture.js';
import { renderPinnedBlock } from '../render/pinned-context.js';
import type { MemoryStore } from '../ports/MemoryStore.js';
import { MemoryValidationError } from '../errors.js';
import {
  buildRecallResult,
  MEMORY_PROJECTIONS,
  type MemoryProjection,
  type RecallHit,
  type RecallMemoriesInput,
  type RecallMemoriesResult,
  resolveRecallBudget,
} from '../domain/recall.js';
import {
  parseMemoryReference,
  type ReadReferenceInput,
  type ReadReferenceResult,
} from '../domain/ref.js';
import type {
  ArchiveSummaryResult,
  DeleteContextValueResult,
  ForgetMemoryResult,
  PinResult,
  PinnedContext,
  ReadMemoryResult,
  RecallSummariesResult,
  UnpinResult,
} from '../domain/results.js';

export const DEFAULT_PIN_QUOTA = 8000;

/** Configuration for the framework-independent memory application service. */
export interface MemoryManagerOptions {
  /** Synchronous persistence port; public Manager methods remain asynchronous. */
  store: MemoryStore;
  /** Scope used when an operation does not provide one. */
  defaultScope?: ScopeRef;
  /** Maximum rendered character count for pinned context. */
  pinQuota?: number;
  /** Origin applied when callers omit one. */
  defaultOrigin?: Origin;
  /** Trust applied when callers omit one. */
  defaultTrust?: Trust;
}
export interface StoreMemoryInput {
  title: string;
  content: string;
  summary?: string;
  type?: MemoryType;
  tags?: string[];
  scope?: ScopeRef;
  origin?: Origin;
  trust?: Trust;
}
export interface ListMemoriesInput {
  scope?: ScopeRef;
  type?: MemoryType;
  limit?: number;
}
export interface PinMemoryInput {
  id: number;
  pinMode?: PinMode;
  summary?: string;
  scope?: ScopeRef;
}
export interface MemoryTargetInput {
  id: number;
  scope?: ScopeRef;
}
export interface ScopedInput {
  scope?: ScopeRef;
}
export interface ContextInput {
  /** Stable caller-provided key used to isolate context values. */
  contextKey: string;
}
export interface SetContextValueInput extends ContextInput {
  key: string;
  value: string;
}
export interface GetContextValueInput extends ContextInput {
  key: string;
}
export interface RecallSummariesInput {
  query: string;
  limit?: number;
}
export type ArchiveSummaryInput = {
  id: string;
  contextKey: string;
  text: string;
  createdAt: number;
};

/** Async domain API that coordinates validation, defaults, storage, Pin, and context operations. */
export class MemoryManager {
  private readonly store: MemoryStore;
  private readonly options: Required<Omit<MemoryManagerOptions, 'store'>>;
  constructor(options: MemoryManagerOptions) {
    const pinQuota = options.pinQuota ?? DEFAULT_PIN_QUOTA;
    if (!Number.isInteger(pinQuota) || pinQuota <= 0)
      throw new MemoryValidationError('pinQuota must be a positive integer');
    this.store = options.store;
    this.options = {
      defaultScope: options.defaultScope ?? { scope: 'global', scopeKey: 'default' },
      pinQuota,
      defaultOrigin: options.defaultOrigin ?? 'user',
      defaultTrust: options.defaultTrust ?? 'high',
    };
  }
  async storeMemory(input: StoreMemoryInput): Promise<MemoryEntry> {
    this.nonEmpty(input.title, 'title');
    this.nonEmpty(input.content, 'content');
    const scope = input.scope ?? this.options.defaultScope;
    return this.store.create({
      title: input.title,
      content: input.content,
      summary: input.summary,
      type: input.type,
      tags: input.tags,
      scope,
      origin: input.origin ?? this.options.defaultOrigin,
      trust: input.trust ?? this.options.defaultTrust,
    });
  }
  async recallMemories(input: RecallMemoriesInput): Promise<RecallMemoriesResult> {
    this.nonEmpty(input.query, 'query');
    const requestedProjection: MemoryProjection = input.projection ?? 'summary';
    if (!MEMORY_PROJECTIONS.includes(requestedProjection))
      throw new MemoryValidationError('projection must be one of title, summary, full');
    const budget = resolveRecallBudget(input.budget);
    const hits: RecallHit[] = this.store
      .search(input.query, {
        scope: input.scope ?? this.options.defaultScope,
        limit: this.limit(input.limit),
      })
      .flatMap((hit) => {
        const memory = this.store.get(hit.id);
        return memory && memory.deletedAt == null ? [{ memory, score: hit.score }] : [];
      });
    return buildRecallResult(hits, requestedProjection, budget);
  }
  async readReference(input: ReadReferenceInput): Promise<ReadReferenceResult> {
    const reference = parseMemoryReference(input.ref);
    if (reference.kind === 'memory') {
      const memory = this.lookup(reference.id, input.scope);
      if (!memory) return { status: 'not_found', reference };
      if (memory.deletedAt != null) return { status: 'deleted', reference };
      return { status: 'found', reference, value: { kind: 'memory', value: memory } };
    }
    if (reference.kind === 'candidate') {
      if (!this.store.readMemoryCandidate) return { status: 'unsupported', reference };
      const result = this.store.readMemoryCandidate({
        id: reference.id,
        scope: input.scope ?? this.options.defaultScope,
      });
      if (result.status === 'not_found') return { status: 'not_found', reference };
      return { status: 'found', reference, value: { kind: 'candidate', value: result.candidate } };
    }
    if (!this.store.getSummary) return { status: 'unsupported', reference };
    const summary = this.store.getSummary(reference.id);
    if (!summary) return { status: 'not_found', reference };
    return { status: 'found', reference, value: { kind: 'summary', value: summary } };
  }
  async listMemories(input: ListMemoriesInput = {}): Promise<MemoryEntry[]> {
    return this.store.listByScope(
      (input.scope ?? this.options.defaultScope).scope,
      (input.scope ?? this.options.defaultScope).scopeKey,
      { type: input.type, limit: this.limit(input.limit) },
    );
  }
  async readMemory(input: MemoryTargetInput): Promise<ReadMemoryResult> {
    const memory = this.lookup(input.id, input.scope);
    if (!memory) return { status: 'not_found', id: input.id };
    if (memory.deletedAt != null) return { status: 'deleted', id: input.id };
    return { status: 'found', memory };
  }
  async forgetMemory(input: MemoryTargetInput): Promise<ForgetMemoryResult> {
    const memory = this.lookup(input.id, input.scope);
    if (!memory) return { status: 'not_found', id: input.id };
    if (memory.deletedAt != null) return { status: 'already_deleted', id: input.id };
    return this.store.softDelete(input.id)
      ? { status: 'deleted', id: input.id }
      : { status: 'not_found', id: input.id };
  }
  async pinMemory(input: PinMemoryInput): Promise<PinResult> {
    const memory = this.lookup(input.id, input.scope);
    if (!memory) return { status: 'not_found', id: input.id };
    if (memory.deletedAt != null) return { status: 'deleted', id: input.id };
    if (memory.trust !== 'high') return { status: 'trust_denied', id: input.id };
    const pinMode = input.pinMode ?? 'summary';
    const summary = input.summary ?? memory.summary;
    if (pinMode === 'summary' && !summary.trim())
      return { status: 'summary_required', id: input.id };
    const result = this.store.pinWithinQuota(input.id, pinMode, summary, this.options.pinQuota);
    if (!result.ok)
      return {
        status: 'quota_exceeded',
        id: input.id,
        size: result.size,
        quota: this.options.pinQuota,
      };
    return {
      status: 'pinned',
      memory: this.store.get(input.id)!,
      size: result.size,
      quota: this.options.pinQuota,
    };
  }
  async unpinMemory(input: MemoryTargetInput): Promise<UnpinResult> {
    const existing = this.lookup(input.id, input.scope);
    if (!existing) return { status: 'not_found', id: input.id };
    if (existing.deletedAt != null) return { status: 'deleted', id: input.id };
    const memory = this.store.updateMeta(input.id, { pinnedAt: null });
    return memory ? { status: 'unpinned', memory } : { status: 'not_found', id: input.id };
  }
  async listPinnedMemories(input: { scope?: ScopeRef } = {}): Promise<MemoryEntry[]> {
    const scope = input.scope ?? this.options.defaultScope;
    return this.store.listPinned(scope.scope, scope.scopeKey);
  }
  /** Return pinned memories, their final reference text, and rendered size. */
  async getPinnedContext(input: { scope?: ScopeRef } = {}): Promise<PinnedContext> {
    const entries = await this.listPinnedMemories(input);
    const text = renderPinnedBlock(entries);
    return { entries, text, size: text.length };
  }
  async archiveSummary(input: ArchiveSummaryInput): Promise<ArchiveSummaryResult> {
    this.nonEmpty(input.id, 'id');
    this.nonEmpty(input.contextKey, 'contextKey');
    this.nonEmpty(input.text, 'text');
    return this.store.archiveSummary(input)
      ? { status: 'inserted', id: input.id }
      : { status: 'duplicate', id: input.id };
  }
  async recallSummaries(input: RecallSummariesInput): Promise<RecallSummariesResult> {
    this.nonEmpty(input.query, 'query');
    return {
      summaries: this.store
        .searchSummaries(input.query, this.limit(input.limit))
        .map(({ score, ...summary }) => ({ summary, score })),
    };
  }
  async setContextValue(input: SetContextValueInput): Promise<void> {
    this.nonEmpty(input.contextKey, 'contextKey');
    this.nonEmpty(input.key, 'key');
    this.store.setKv(input.contextKey, input.key, input.value);
  }
  async getContextValue(input: GetContextValueInput): Promise<string | null> {
    this.nonEmpty(input.contextKey, 'contextKey');
    this.nonEmpty(input.key, 'key');
    return this.store.getKv(input.contextKey, input.key);
  }
  async listContextValues(input: ContextInput): Promise<Record<string, string>> {
    this.nonEmpty(input.contextKey, 'contextKey');
    return this.store.listKv(input.contextKey);
  }
  async deleteContextValue(input: GetContextValueInput): Promise<DeleteContextValueResult> {
    this.nonEmpty(input.contextKey, 'contextKey');
    this.nonEmpty(input.key, 'key');
    return this.store.deleteKv(input.contextKey, input.key)
      ? { status: 'deleted', key: input.key }
      : { status: 'not_found', key: input.key };
  }
  async close(): Promise<void> {
    this.store.close();
  }
  async beginCapture(input: BeginCaptureInput): Promise<BeginCaptureResult> {
    if (
      input.leaseMs !== undefined &&
      (!Number.isInteger(input.leaseMs) || input.leaseMs <= 0 || input.leaseMs > 3_600_000)
    )
      throw new MemoryValidationError('leaseMs must be an integer between 1 and 3600000');
    if (!this.store.beginCapture)
      throw new MemoryValidationError('Capture is not supported by this store');
    return this.store.beginCapture({ ...input, scope: input.scope ?? this.options.defaultScope });
  }
  async completeCapture(input: CompleteCaptureInput): Promise<CompleteCaptureResult> {
    if (!this.store.completeCapture)
      throw new MemoryValidationError('Capture is not supported by this store');
    return this.store.completeCapture(input);
  }
  async failCapture(input: {
    captureKey: string;
    leaseToken: string;
    errorCode: string;
  }): Promise<FailCaptureResult> {
    if (!this.store.failCapture)
      throw new MemoryValidationError('Capture is not supported by this store');
    return this.store.failCapture(input.captureKey, input.leaseToken, input.errorCode);
  }
  async listMemoryCandidates(input: ListMemoryCandidatesInput = {}): Promise<MemoryCandidate[]> {
    if (!this.store.listMemoryCandidates)
      throw new MemoryValidationError('Capture is not supported by this store');
    return this.store.listMemoryCandidates({
      status: 'pending',
      ...input,
      scope: input.scope ?? this.options.defaultScope,
    });
  }
  async readMemoryCandidate(input: MemoryCandidateTargetInput): Promise<ReadMemoryCandidateResult> {
    if (!this.store.readMemoryCandidate)
      throw new MemoryValidationError('Capture is not supported by this store');
    return this.store.readMemoryCandidate({
      id: input.id,
      scope: input.scope ?? this.options.defaultScope,
    });
  }
  async reviewMemoryCandidate(
    input: ReviewMemoryCandidateInput,
  ): Promise<ReviewMemoryCandidateResult> {
    if (!this.store.reviewMemoryCandidate)
      throw new MemoryValidationError('Capture is not supported by this store');
    return this.store.reviewMemoryCandidate({
      ...input,
      scope: input.scope ?? this.options.defaultScope,
    });
  }
  private nonEmpty(value: string, name: string): void {
    if (typeof value !== 'string' || !value.trim())
      throw new MemoryValidationError(`${name} must not be empty`);
  }
  private limit(value?: number): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || value <= 0)
      throw new MemoryValidationError('limit must be a positive integer');
    return value;
  }
  private lookup(id: number, scope?: ScopeRef): MemoryEntry | null {
    if (!Number.isInteger(id) || id <= 0)
      throw new MemoryValidationError('id must be a positive integer');
    const effectiveScope = scope ?? this.options.defaultScope;
    const memory = this.store.get(id);
    return memory &&
      memory.scope === effectiveScope.scope &&
      memory.scopeKey === effectiveScope.scopeKey
      ? memory
      : null;
  }
}
