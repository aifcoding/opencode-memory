import type { MemoryCandidate } from './capture.js';
import type { SummaryEntry } from './results.js';
import type { MemoryEntry, ScopeRef } from './types.js';
import { InvalidMemoryReferenceError, MemoryValidationError } from '../errors.js';

/** Entity kinds addressable by a computed `memory://local/...` reference. */
export type MemoryReferenceKind = 'memory' | 'summary' | 'candidate';

/** Template-literal form of a same-database reference. */
export type MemoryRef =
  | `memory://local/memories/${number}`
  | `memory://local/summaries/${string}`
  | `memory://local/candidates/${number}`;

/** Parsed, canonical form of a reference with its decoded entity id. */
export type MemoryReference =
  | { kind: 'memory'; ref: MemoryRef; id: number }
  | { kind: 'summary'; ref: MemoryRef; id: string }
  | { kind: 'candidate'; ref: MemoryRef; id: number };

const KIND_BY_SEGMENT: Record<string, MemoryReferenceKind> = {
  memories: 'memory',
  summaries: 'summary',
  candidates: 'candidate',
};

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/** Compute the stable reference for a stored memory id. */
export function memoryRef(id: number): MemoryRef {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new MemoryValidationError('id must be a positive safe integer');
  return `memory://local/memories/${id}`;
}

/** Compute the stable reference for a candidate id. */
export function candidateRef(id: number): MemoryRef {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new MemoryValidationError('id must be a positive safe integer');
  return `memory://local/candidates/${id}`;
}

/** Compute the stable reference for a summary id. */
export function summaryRef(id: string): MemoryRef {
  if (typeof id !== 'string' || id.length === 0)
    throw new MemoryValidationError('summary id must not be empty');
  if (id === '.' || id === '..')
    throw new MemoryValidationError('summary id must not be a dot segment');
  return `memory://local/summaries/${encodeURIComponent(id)}`;
}

function invalidReference(): InvalidMemoryReferenceError {
  return new InvalidMemoryReferenceError();
}

function decodeSummaryId(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw invalidReference();
  }
  if (decoded.length === 0 || encodeURIComponent(decoded) !== segment) throw invalidReference();
  return decoded;
}

/**
 * Parse a `memory://local/...` reference with strict validation. Throws
 * `InvalidMemoryReferenceError` for malformed references and never echoes the
 * rejected value back to the caller.
 */
export function parseMemoryReference(ref: string): MemoryReference {
  if (typeof ref !== 'string' || ref.length === 0 || ref !== ref.trim()) throw invalidReference();
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    throw invalidReference();
  }
  if (url.protocol !== 'memory:') throw invalidReference();
  if (url.hostname !== 'local' || url.host !== 'local') throw invalidReference();
  if (url.username !== '' || url.password !== '' || url.port !== '') throw invalidReference();
  if (url.search !== '' || url.hash !== '') throw invalidReference();
  const segments = url.pathname.split('/');
  if (segments.length !== 3 || segments[0] !== '') throw invalidReference();
  const kindSegment = segments[1];
  const idSegment = segments[2];
  const kind = KIND_BY_SEGMENT[kindSegment];
  if (!kind || idSegment === '') throw invalidReference();
  if (kind === 'summary') {
    const id = decodeSummaryId(idSegment);
    return { kind, ref: summaryRef(id), id };
  }
  if (!POSITIVE_INTEGER.test(idSegment)) throw invalidReference();
  const id = Number(idSegment);
  if (!Number.isSafeInteger(id) || id <= 0) throw invalidReference();
  return kind === 'memory' ? { kind, ref: memoryRef(id), id } : { kind, ref: candidateRef(id), id };
}

/** Input for reading an entity through its reference. */
export interface ReadReferenceInput {
  ref: MemoryRef | string;
  scope?: ScopeRef;
}

/** The stored entity resolved from a reference. */
export type ReferenceValue =
  | { kind: 'memory'; value: MemoryEntry }
  | { kind: 'summary'; value: SummaryEntry }
  | { kind: 'candidate'; value: MemoryCandidate };

/** Structured result of `readReference`. Every status carries the parsed reference. */
export type ReadReferenceResult =
  | { status: 'found'; reference: MemoryReference; value: ReferenceValue }
  | { status: 'not_found'; reference: MemoryReference }
  | { status: 'deleted'; reference: MemoryReference }
  | { status: 'unsupported'; reference: MemoryReference };
