export const SCOPE = ["global", "user", "project", "session"] as const;
export type Scope = (typeof SCOPE)[number];

export const ORIGIN = ["user", "agent", "compact"] as const;
export type Origin = (typeof ORIGIN)[number];

export const TRUST = ["high", "low"] as const;
export type Trust = (typeof TRUST)[number];

export const PIN_MODE = ["full", "summary"] as const;
export type PinMode = (typeof PIN_MODE)[number];

export interface MemoryEntry {
  id: number;
  scope: Scope;
  scopeKey: string;
  origin: Origin;
  trust: Trust;
  title: string;
  content: string;
  summary: string;
  type: string;
  tags: string[];
  pinnedAt: number | null;
  pinMode: PinMode;
  embedding: Uint8Array | null;
  embedModel: string | null;
  embedDim: number | null;
  contentHash: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}
