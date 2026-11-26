import { createHash } from 'node:crypto';
import { hasCredential, redactCredentialText } from './AutoCaptureService.js';
import type { MemoryCandidateDraft } from '../domain/capture.js';
import type { ExtractionMessage, SourceKind } from '../domain/extraction.js';
import type { ScopeRef } from '../domain/types.js';
import type { MemoryManager } from './MemoryManager.js';
import type { TextGenerator } from '../ports/TextGenerator.js';
import { validateCaptureCandidates } from '../extraction/validate.js';
import { CAPTURE_EXTRACTOR_VERSION } from '../extraction/prompt.js';

export interface ExtractionLimits {
  maxInputChars: number;
  maxOutputTokens: number;
  maxCandidates: number;
}

export interface ExtractionRequest {
  scope: ScopeRef;
  sourceKind: SourceKind;
  contextKey: string;
  snapshotId: string;
  trigger: 'compaction' | 'manual';
  messages: readonly ExtractionMessage[];
  instructions: string;
  /** 目标指纹（provider/model 或 agent），参与幂等键。 */
  targetFingerprint: string;
  signal?: AbortSignal;
}

export interface ExtractionOutcome {
  status: 'completed' | 'already-completed' | 'in-progress' | 'skipped' | 'failed';
  candidateCount: number;
  filteredCount: number;
  reason?: string;
}

const SAFE_ERROR_CODE =
  /^(invalid_json|invalid_output|extractor_no_text|session_create_failed|missing_api_key|generator_empty|generator_response_too_large|generator_http_\d{3})$/;

/** 只把已知安全错误码写入 run/返回调用方；其余一律折叠成 generator_failed。 */
function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return SAFE_ERROR_CODE.test(message) ? message : 'generator_failed';
}

/** 把模型输出转成候选；本地校验不通过的一律丢弃（不信任模型）。 */
function toDraft(raw: any, material: string, maxCandidates: number): MemoryCandidateDraft[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.candidates)) {
    throw new Error('invalid_output');
  }
  const { candidates } = validateCaptureCandidates(raw.candidates, material, maxCandidates);
  return candidates.map((candidate) => ({
    title: candidate.title,
    content: candidate.content,
    summary: candidate.summary,
    type: candidate.type,
    tags: candidate.tags,
    suggestedDomain: candidate.suggestedDomain,
  }));
}

export class ExtractionService {
  constructor(
    private readonly manager: MemoryManager,
    private readonly generator: TextGenerator,
    private readonly limits: ExtractionLimits,
  ) {}

  async extract(request: ExtractionRequest): Promise<ExtractionOutcome> {
    // 来源准入：只有人工/模型材料可进提取；模型自述走 model-report。
    // 缺 origin 一律不可信（fail closed），适配器必须标注作者身份。
    const allowedOrigins: ReadonlySet<string> =
      request.sourceKind === 'model-report'
        ? new Set(['model-report'])
        : new Set(['human', 'model']);
    const selected = request.messages
      .filter(
        (message) =>
          !message.synthetic &&
          message.origin !== undefined &&
          allowedOrigins.has(message.origin),
      )
      .map((message) => ({ ...message, text: redactCredentialText(message.text).text }))
      .filter((message) => message.text.trim().length > 0);

    // 脱敏后仍有残留 → 拒绝发送。
    if (selected.some((message) => redactCredentialText(message.text).hits > 0)) {
      return { status: 'skipped', candidateCount: 0, filteredCount: selected.length, reason: 'credential_residual' };
    }

    // 预算硬上限：先按整条淘汰旧消息，单条仍超限时确定性保留尾部（最新内容）。
    const budget = Math.max(1, this.limits.maxInputChars);
    const measure = (messages: readonly { text: string }[]) =>
      messages.reduce((sum, message) => sum + message.text.length, 0) +
      Math.max(0, messages.length - 1);
    let kept = selected;
    let trimmed = false;
    while (kept.length > 1 && measure(kept) > budget) {
      kept = kept.slice(1);
      trimmed = true;
    }
    if (kept.length === 0) {
      return { status: 'skipped', candidateCount: 0, filteredCount: selected.length, reason: 'empty_material' };
    }
    let material = kept.map((message) => message.text).join('\n');
    if (material.length > budget) {
      material = material.slice(-budget);
      trimmed = true;
    }

    // 最终载荷复扫：逐消息脱敏后，拼接仍可能重组出凭据。
    if (redactCredentialText(material).hits > 0) {
      return { status: 'skipped', candidateCount: 0, filteredCount: selected.length, reason: 'credential_residual' };
    }

    // 幂等键用最终材料的内容摘要，不能用长度（同长度不同正文会碰撞）。
    const digest = createHash('sha256')
      .update(
        `${request.sourceKind}\u0000${request.targetFingerprint}\u0000${CAPTURE_EXTRACTOR_VERSION}\u0000${material}`,
      )
      .digest('hex')
      .slice(0, 16);
    const begun = await this.manager.beginCapture({
      contextKey: `${request.contextKey}:${request.snapshotId}:${request.targetFingerprint}:${digest}`,
      sourceId: request.contextKey,
      trigger: request.trigger,
      extractorVersion: CAPTURE_EXTRACTOR_VERSION,
      scope: request.scope,
    });
    if (begun.status === 'already_completed') {
      return { status: 'already-completed', candidateCount: 0, filteredCount: 0 };
    }
    if (begun.status === 'in_progress') {
      return { status: 'in-progress', candidateCount: 0, filteredCount: 0 };
    }

    try {
      const generated = await this.generator.generate({
        instructions: request.instructions,
        data: material,
        maxOutputTokens: this.limits.maxOutputTokens,
        signal: request.signal,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(generated.text);
      } catch {
        throw new Error('invalid_json');
      }
      const drafts = toDraft(parsed, material, this.limits.maxCandidates);
      const completed = await this.manager.completeCapture({
        captureKey: begun.captureKey,
        leaseToken: begun.leaseToken,
        candidates: drafts,
      });
      return {
        status: 'completed',
        candidateCount: completed.candidateCount,
        filteredCount: trimmed ? 1 : 0,
      };
    } catch (error) {
      // 不把任意异常文本写入 run 或回传调用方（可能带材料片段）。
      const code = safeErrorCode(error);
      await this.manager
        .failCapture({
          captureKey: begun.captureKey,
          leaseToken: begun.leaseToken,
          errorCode: code,
        })
        .catch(() => undefined);
      return {
        status: 'failed',
        candidateCount: 0,
        filteredCount: 0,
        reason: code,
      };
    }
  }
}
