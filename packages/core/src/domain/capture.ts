import type { MemoryEntry, MemoryType, ScopeRef } from './types.js';

export type CaptureTrigger = 'compaction' | 'manual';
export type SuggestedDomain = 'code' | 'user' | 'business' | 'uncertain';
export type CandidateStatus = 'pending' | 'approved' | 'rejected';
export type CandidateRiskCode =
  | 'credential_detected'
  | 'bidi_control_detected'
  | 'invisible_unicode_detected';

export interface MemoryCandidateDraft {
  title: string;
  content: string;
  summary?: string;
  type: MemoryType;
  tags?: string[];
  suggestedDomain: SuggestedDomain;
}

export interface MemoryCandidate extends MemoryCandidateDraft {
  id: number;
  captureKey: string;
  scope: ScopeRef;
  origin: 'agent';
  trust: 'low';
  status: CandidateStatus;
  riskFlags: CandidateRiskCode[];
  approvedMemoryId: number | null;
  createdAt: number;
  reviewedAt: number | null;
}

export interface BeginCaptureInput {
  contextKey: string;
  sourceId: string;
  trigger: CaptureTrigger;
  extractorVersion: string;
  scope?: ScopeRef;
  leaseMs?: number;
}

export type BeginCaptureResult =
  | { status: 'started'; captureKey: string; leaseToken: string; leaseExpiresAt: number }
  | { status: 'in_progress'; captureKey: string; leaseExpiresAt: number }
  | {
      status: 'already_completed';
      captureKey: string;
      candidateCount: number;
      filteredCount: number;
    };

export interface CompleteCaptureInput {
  captureKey: string;
  leaseToken: string;
  candidates: MemoryCandidateDraft[];
}

export interface CompleteCaptureResult {
  status: 'completed';
  captureKey: string;
  candidates: MemoryCandidate[];
  candidateCount: number;
  filteredCount: number;
  filteredRiskCodes: CandidateRiskCode[];
}

export type FailCaptureResult =
  | { status: 'failed'; captureKey: string }
  | { status: 'lease_mismatch' | 'not_found'; captureKey: string };

export interface ListMemoryCandidatesInput {
  status?: CandidateStatus;
  suggestedDomain?: SuggestedDomain;
  scope?: ScopeRef;
  limit?: number;
}

export type ReadMemoryCandidateResult =
  | { status: 'found'; candidate: MemoryCandidate }
  | { status: 'not_found'; id: number };
export interface MemoryCandidateTargetInput {
  id: number;
  scope?: ScopeRef;
}
export interface ReviewMemoryCandidateInput extends MemoryCandidateTargetInput {
  decision: 'approve' | 'reject';
}

export type ReviewMemoryCandidateResult =
  | { status: 'approved'; memory: MemoryEntry; candidate: MemoryCandidate }
  | { status: 'already_exists'; memory: MemoryEntry; candidate: MemoryCandidate }
  | { status: 'rejected'; candidate: MemoryCandidate }
  | { status: 'already_reviewed'; candidate: MemoryCandidate }
  | { status: 'security_rejected'; id: number; riskFlags: CandidateRiskCode[] }
  | { status: 'not_found'; id: number };

export function candidateRiskFlags(text: string): CandidateRiskCode[] {
  const flags: CandidateRiskCode[] = [];
  if (
    /(?:api[_ -]?key|access[_ -]?key|token|password|secret|cookie|验证码)\s*[:=]\s*\S+/i.test(
      text,
    ) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(text) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(text) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(text) ||
    /\bAKIA[0-9A-Z]{16}\b|\b(?:ghp_|xox[baprs]-|sk-)[A-Za-z0-9_-]{12,}/.test(text)
  )
    flags.push('credential_detected');
  if (/[\u202A-\u202E\u2066-\u2069]/u.test(text)) flags.push('bidi_control_detected');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200C\u200D\uFEFF]/u.test(text))
    flags.push('invisible_unicode_detected');
  return flags;
}
