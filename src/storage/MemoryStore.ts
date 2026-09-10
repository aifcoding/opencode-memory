import type { MemoryEntry, Origin, PinMode, Scope, Trust } from "../types.js";

export interface CreateMemoryInput {
  scope: Scope;
  scopeKey: string;
  origin: Origin;
  trust: Trust;
  title: string;
  content: string;
  summary?: string;
  type?: string;
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
  type?: string;
  tags?: string[];
  pinnedAt?: number | null;
  pinMode?: PinMode;
}

export interface UpdateContentResult {
  entry: MemoryEntry | null;
  conflict: boolean;
}

export interface SearchHit {
  id: number;
  score: number;
}

export interface SearchOptions {
  scope?: Scope;
  scopeKey?: string;
  limit?: number;
}

export interface SummaryArchiveInput {
  id: string;
  sessionId: string;
  summaryText: string;
  createdAt: number;
}

export interface SummaryResult {
  id: string;
  sessionId: string;
  summaryText: string;
  createdAt: number;
}

export interface MemoryStore {
  create(input: CreateMemoryInput): MemoryEntry;
  get(id: number): MemoryEntry | null;
  updateMeta(id: number, patch: MetaPatch): MemoryEntry | null;
  updateContent(id: number, content: string, expectedRevision: number, title?: string): UpdateContentResult;
  softDelete(id: number): boolean;
  restore(id: number): boolean;
  listByScope(scope: Scope, scopeKey: string, opts?: { type?: string; limit?: number }): MemoryEntry[];
  listPinned(scope: Scope, scopeKey: string): MemoryEntry[];
  getPinnedSize(scope: Scope, scopeKey: string): number;
  search(query: string, opts?: SearchOptions): SearchHit[];
  archiveSummary(input: SummaryArchiveInput): void;
  searchSummaries(query: string, limit?: number): SummaryResult[];

  setKv(sessionKey: string, key: string, value: string): void;
  getKv(sessionKey: string, key: string): string | null;
  listKv(sessionKey: string): Record<string, string>;
  deleteKv(sessionKey: string, key: string): boolean;

  close(): void;
}
