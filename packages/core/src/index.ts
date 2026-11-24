export type {
  MemoryEntry,
  MemoryType,
  Origin,
  PinMode,
  Scope,
  ScopeRef,
  Trust,
} from './domain/types.js';
export type {
  CreateMemoryInput,
  MemoryStore,
  MetaPatch,
  SearchHit,
  SearchOptions,
  SummaryArchiveInput,
  SummaryResult,
  UpdateContentResult,
} from './ports/MemoryStore.js';
export { defaultTokenizer, tokenize } from './retrieval/tokenizer.js';
export type { Tokenizer } from './retrieval/tokenizer.js';
export type {
  BeginCaptureInput,
  BeginCaptureResult,
  CandidateRiskCode,
  CandidateStatus,
  CompleteCaptureInput,
  CompleteCaptureResult,
  FailCaptureResult,
  ListMemoryCandidatesInput,
  MemoryCandidate,
  MemoryCandidateDraft,
  MemoryCandidateTargetInput,
  ReadMemoryCandidateResult,
  ReviewMemoryCandidateInput,
  ReviewMemoryCandidateResult,
  SuggestedDomain,
} from './domain/capture.js';
export { renderPinnedBlock, renderPinnedEntry } from './render/pinned-context.js';
export { escapeXmlText } from './render/xml.js';
export { MemoryManager, DEFAULT_PIN_QUOTA } from './application/MemoryManager.js';
export {
  AutoCaptureService,
  detectSignals,
  extractCandidates,
  hasCredential,
  isReferenceRequest,
  normalizeTitle,
} from './application/AutoCaptureService.js';
export { AutoRecallService } from './application/AutoRecallService.js';
export {
  AUTO_CAPTURE_MODES,
  AUTO_RECALL_HINT,
  AUTO_RECALL_MODES,
  AUTO_SIGNALS,
  DEFAULT_AUTO_CAPTURE,
  DEFAULT_AUTO_RECALL,
} from './domain/auto-memory.js';
export type {
  AutoCandidate,
  AutoCaptureConfig,
  AutoCaptureInput,
  AutoCaptureMode,
  AutoCaptureResult,
  AutoRecallConfig,
  AutoRecallInput,
  AutoRecallItem,
  AutoRecallMode,
  AutoRecallResult,
  AutoSignal,
} from './domain/auto-memory.js';
export type {
  ArchiveSummaryInput,
  ContextInput,
  GetContextValueInput,
  ListMemoriesInput,
  MemoryManagerOptions,
  MemoryTargetInput,
  PinMemoryInput,
  RecallSummariesInput,
  ScopedInput,
  SetContextValueInput,
  StoreMemoryInput,
} from './application/MemoryManager.js';
export {
  DEFAULT_RECALL_BUDGET,
  DEFAULT_SUMMARY_FALLBACK_CHARACTERS,
  MEMORY_PROJECTIONS,
} from './domain/recall.js';
export type {
  FullMemoryProjection,
  MemoryProjection,
  ProjectedMemory,
  ProjectedMemoryRecallItem,
  RecallBudget,
  RecallBudgetInput,
  RecallHit,
  RecallMemoriesInput,
  RecallMemoriesResult,
  RecallMemoryBase,
  RecallOverflowItem,
  SummaryMemoryProjection,
  SummarySource,
  TitleMemoryProjection,
} from './domain/recall.js';
export {
  candidateRef,
  memoryRef,
  parseMemoryReference,
  summaryRef,
} from './domain/ref.js';
export type {
  MemoryRef,
  MemoryReference,
  MemoryReferenceKind,
  ReadReferenceInput,
  ReadReferenceResult,
  ReferenceValue,
} from './domain/ref.js';
export type {
  ArchiveSummaryResult,
  DeleteContextValueResult,
  ForgetMemoryResult,
  PinResult,
  PinnedContext,
  ReadMemoryResult,
  RecallSummariesResult,
  SummaryEntry,
  SummaryRecallItem,
  UnpinResult,
} from './domain/results.js';
export {
  DuplicateMemoryError,
  InvalidMemoryReferenceError,
  MemoryValidationError,
} from './errors.js';
