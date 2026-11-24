import type { MemoryType, ScopeRef } from './types.js';

export const AUTO_CAPTURE_MODES = ['off', 'shadow', 'on'] as const;
export type AutoCaptureMode = (typeof AUTO_CAPTURE_MODES)[number];

export const AUTO_RECALL_MODES = ['off', 'hint', 'shadow', 'auto'] as const;
export type AutoRecallMode = (typeof AUTO_RECALL_MODES)[number];

/** 采集信号；顺序即优先级。 */
export const AUTO_SIGNALS = ['explicit', 'correction', 'qa', 'structured', 'decision'] as const;
export type AutoSignal = (typeof AUTO_SIGNALS)[number];

export interface AutoCaptureConfig {
  enabled: boolean;
  mode: Exclude<AutoCaptureMode, 'off'>;
  maxWritesPerTurn: number;
}

export interface AutoRecallConfig {
  mode: AutoRecallMode;
  maxItems: number;
  maxCharacters: number;
}

export interface AutoCandidate {
  title: string;
  content: string;
  summary: string;
  type: MemoryType;
  tags: string[];
  signal: AutoSignal;
  entityTag: string;
}

export interface AutoCaptureInput {
  text: string;
  previousAssistantText?: string;
  scope: ScopeRef;
  now?: number;
}

export interface AutoCaptureResult {
  signals: AutoSignal[];
  candidates: AutoCandidate[];
  written: number;
  updated: number;
  /** 本轮写入或更新的记忆 id，用于排除同轮召回回显。 */
  createdIds: number[];
  skipped: string[];
}

export interface AutoRecallInput {
  query: string;
  /** 作用域并集，如 [project, global]。 */
  scopes: ScopeRef[];
  excludeIds: number[];
  maxItems: number;
  maxCharacters: number;
}

export interface AutoRecallItem {
  id: number;
  title: string;
  summary: string;
  trust: string;
}

export interface AutoRecallResult {
  items: AutoRecallItem[];
  text: string;
  considered: number;
  skipped: string[];
}

export const DEFAULT_AUTO_CAPTURE: AutoCaptureConfig = {
  enabled: true,
  mode: 'on',
  maxWritesPerTurn: 3,
};

export const DEFAULT_AUTO_RECALL: AutoRecallConfig = {
  mode: 'auto',
  maxItems: 3,
  maxCharacters: 300,
};

/** hint 模式注入的固定规则；内容恒定，不随轮次变化。 */
export const AUTO_RECALL_HINT =
  '涉及历史决策、既有配置或"上次/之前"的结论时，先调用 memory_recall 再回答；记忆只作线索，当前状态仍须核验；与本次任务无关时不要检索。';
