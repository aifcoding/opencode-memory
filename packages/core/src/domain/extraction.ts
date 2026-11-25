/** 提取目标：互斥三选一，运行期不切换。 */
export type CaptureTarget =
  | { kind: 'model'; provider: string; model: string }
  | { kind: 'agent'; name: string }
  | { kind: 'host-default' };

/** 材料来源：宿主转录 vs 模型自述（MCP 手动入口）。 */
export type SourceKind = 'host-transcript' | 'model-report';

export interface ExtractionMessage {
  id: string;
  role: 'user' | 'assistant' | 'unknown';
  text: string;
  synthetic: boolean;
}

export type CaptureTargetParse = { ok: true; target: CaptureTarget } | { ok: false; reason: string };

const TARGET_KINDS = new Set(['model', 'agent', 'host-default']);

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 解析单个 target。只做格式与互斥校验，不判断 provider/model 是否真实存在
 * （那是宿主 resolver 的职责）。
 */
export function parseCaptureTarget(raw: unknown): CaptureTargetParse {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'target must be an object' };
  const input = raw as Record<string, unknown>;
  const kind = trimmed(input.kind);
  if (!TARGET_KINDS.has(kind)) return { ok: false, reason: `unknown target kind: ${kind || '(empty)'}` };

  if (kind === 'host-default') {
    const extra = Object.keys(input).filter((key) => key !== 'kind');
    if (extra.length > 0) return { ok: false, reason: `host-default takes no fields: ${extra.join(',')}` };
    return { ok: true, target: { kind: 'host-default' } };
  }

  if (kind === 'agent') {
    const name = trimmed(input.name);
    const stray = Object.keys(input).filter((key) => key !== 'kind' && key !== 'name');
    if (stray.length > 0) return { ok: false, reason: `agent target has unexpected fields: ${stray.join(',')}` };
    if (!name) return { ok: false, reason: 'agent target requires name' };
    return { ok: true, target: { kind: 'agent', name } };
  }

  const provider = trimmed(input.provider);
  const model = trimmed(input.model);
  const stray = Object.keys(input).filter((key) => !['kind', 'provider', 'model'].includes(key));
  if (stray.length > 0) return { ok: false, reason: `model target has unexpected fields: ${stray.join(',')}` };
  if (!provider) return { ok: false, reason: 'model target requires provider' };
  if (!model) return { ok: false, reason: 'model target requires model' };
  // provider 是配置里的 provider 键名，不是 URL；内嵌凭据一律拒绝。
  if (provider.includes('://') || provider.includes('@')) {
    return { ok: false, reason: 'provider must be a configured provider name, not a URL' };
  }
  return { ok: true, target: { kind: 'model', provider, model } };
}

export interface CaptureConfigInput {
  enabled?: boolean;
  target?: unknown;
  /** 旧字段，仅用于映射为 agent target。 */
  agent?: string;
  maxCandidates?: number;
}

export type CaptureConfigCheck =
  | { ok: true; target?: CaptureTarget }
  | { ok: false; reason: string };

/**
 * 启动期校验：enabled=true 时必须有可解析的 target；旧 agent 字段映射为 agent target；
 * target 与 agent 同时出现视为冲突，不静默取值。
 */
export function validateCaptureConfig(input: CaptureConfigInput): CaptureConfigCheck {
  if (input.maxCandidates !== undefined) {
    const value = input.maxCandidates;
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      return { ok: false, reason: 'maxCandidates must be an integer between 1 and 20' };
    }
  }

  const legacyAgent = trimmed(input.agent);
  if (legacyAgent && input.target !== undefined) {
    return { ok: false, reason: 'capture.target conflicts with legacy capture.agent' };
  }

  let target: CaptureTarget | undefined;
  if (input.target !== undefined) {
    const parsed = parseCaptureTarget(input.target);
    if (!parsed.ok) return parsed;
    target = parsed.target;
  } else if (legacyAgent) {
    target = { kind: 'agent', name: legacyAgent };
  }

  if (!input.enabled) return { ok: true, target };
  if (!target) return { ok: false, reason: 'capture.enabled=true requires a target' };
  return { ok: true, target };
}
