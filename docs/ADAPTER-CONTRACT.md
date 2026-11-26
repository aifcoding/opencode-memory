# 适配器契约（新宿主接入指南）

本文档说明新宿主（Codex、Claude Code 等）如何接入 `@aifcoding/memory-core` 的通用 LLM 提取管线。提取的编排、安全管线、幂等与候选写入都在 core，宿主只提供**材料**与**生成器**两个端口。

> 术语与代码一致：以 `packages/core/src/` 的实际导出为准；本文只描述已实现的能力，未实现项显式标注。

## 1. 分工总览

```
宿主适配器 ──材料(ExtractionMessage[])──┐
                                          ├─→ ExtractionService（core）
宿主适配器 ──生成器(TextGenerator)────────┘       │  来源准入 → 脱敏 → 预算 → 复扫
                                                  │  → 幂等 → 生成 → 校验 → 写候选
```

core 已实现并导出（`@aifcoding/memory-core`）：

| 符号 | 位置 | 用途 |
|---|---|---|
| `ExtractionService` / `ExtractionRequest` / `ExtractionOutcome` / `ExtractionLimits` | `application/ExtractionService.ts` | 编排 + 安全管线 + 候选写入 |
| `TextGenerator` / `GenerationRequest` / `GenerationResult` | `ports/TextGenerator.ts` | 生成端口 |
| `ExtractionMessage` / `SourceKind` / `CaptureTarget` / `parseCaptureTarget` / `validateCaptureConfig` | `domain/extraction.ts` | 材料、来源、目标 |
| `CAPTURE_PROMPT` / `CAPTURE_EXTRACTOR_VERSION` | `extraction/prompt.ts` | 提取提示词、提取版本 |
| `validateCaptureCandidates` / `CAPTURE_TYPES` / `CAPTURE_DOMAINS` | `extraction/validate.ts` | 本地后置校验（不信任模型输出） |
| `MaterialOrigin` | `domain/auto-memory.ts` | 材料来源枚举 |

宿主适配器**不复制**提示词或校验逻辑：直接 import 上述 `CAPTURE_PROMPT` 与 `validateCaptureCandidates`，把校验交给 `ExtractionService`。

## 2. 材料（ExtractionMessage）

```ts
interface ExtractionMessage {
  id: string;                 // 宿主消息 id，用于幂等/游标，不代表身份可信
  role: 'user' | 'assistant' | 'unknown'; // 协议角色，不是作者身份
  text: string;
  synthetic: boolean;         // true 表示注入块，一律被丢弃
  origin?: MaterialOrigin;    // 作者身份，核心准入依据
}
```

`MaterialOrigin` 取值：`'human' | 'model' | 'host' | 'extension' | 'model-report' | 'unknown'`。

### 来源准入（fail closed）

`ExtractionService` 按 `sourceKind` 只接受以下 origin，**缺失 origin 一律丢弃**：

| sourceKind | 允许的 origin | 用途 |
|---|---|---|
| `host-transcript` | `human`、`model` | 宿主会话转录（OpenCode capture） |
| `model-report` | `model-report` | MCP 手动入口 `memory_extract` |

此外，`synthetic === true` 的消息无条件丢弃；`host` / `extension` / `unknown` 不进入提取材料。

### 来源映射规则（宿主必须做结构化判定）

`role` 是协议角色，不能代表作者身份（automation / 压缩摘要 / 系统消息都可能被投影成 `user`）。新宿主必须提供**结构化来源**（消息 type / metadata），据此映射 `origin`，**不得只按 role 判定**。

参考实现（`packages/opencode/src/context/material.ts` 的 `originOf`）：

| 宿主结构字段 | origin | 备注 |
|---|---|---|
| 真实用户消息（type=user，非 automation） | `human` | |
| automation（metadata.automation 或 id 以 `msg_aut_` 开头） | `host` | 不得进入提取材料 |
| assistant | `model` | |
| compaction | `host` | |
| synthetic / system / shell | `host` | |
| 无法判定 | `unknown` | 被丢弃 |

**v1 回退是显式风险开关**：OpenCode v1 宿主没有结构化来源，默认拒绝提取（fail closed），返回「当前宿主不支持来源校验，已跳过提取（v1 可显式开启 capture.trustRoleAsOrigin）」。只有显式设置 `capture.trustRoleAsOrigin: true` 才按协议角色映射 human/model。v2 有结构化来源时不使用该开关。

## 3. 生成器（TextGenerator）

```ts
interface GenerationRequest {
  instructions: string;   // 已由 core 填充为 CAPTURE_PROMPT
  data: string;           // 已筛选、脱敏、裁剪的最终材料（不可信数据）
  maxOutputTokens: number;
  signal?: AbortSignal;
}
interface GenerationResult { text: string; }

interface TextGenerator {
  generate(input: GenerationRequest): Promise<GenerationResult>;
}
```

宿主可二选一实现：

1. **宿主子 agent**（OpenCode 方式）：新建临时会话，把 `instructions + data` 作为输入，读取助手回复文本；失败抛白名单错误码（见 §6）。
2. **openai-compatible HTTP**（MCP 方式）：参考 `packages/mcp/src/extraction/generator.ts` 的 `createOpenAiCompatibleGenerator`，一次 `chat/completions`、无重试；API key 从环境变量名读取，值只进进程内，不写配置或日志。

## 4. ExtractionRequest 字段

```ts
interface ExtractionRequest {
  scope: ScopeRef;                 // { scope: 'global'|'user'|'project'|'session', scopeKey: string }
  sourceKind: SourceKind;          // 'host-transcript' | 'model-report'
  contextKey: string;              // 会话/来源稳定标识
  snapshotId: string;              // 本次材料快照标识（参与幂等键）
  trigger: 'compaction' | 'manual';
  messages: readonly ExtractionMessage[];
  instructions: string;            // 传 CAPTURE_PROMPT
  targetFingerprint: string;       // provider/model 或 agent，参与幂等键
  signal?: AbortSignal;
}
```

调用方只调用 `service.extract(request)`，得到 `ExtractionOutcome`：

```ts
interface ExtractionOutcome {
  status: 'completed' | 'already-completed' | 'in-progress' | 'skipped' | 'failed';
  candidateCount: number;
  filteredCount: number;
  reason?: string;   // skipped/failed 时给出原因
}
```

## 5. 安全管线固定顺序

`ExtractionService.extract` 内部固定顺序（宿主不参与）：

1. 来源准入（§2 fail closed）
2. 逐消息脱敏（`redactCredentialText`），空消息丢弃
3. 逐消息残留扫描：命中即 `skipped`，reason `credential_residual`
4. 预算硬上限（`maxInputChars`）：先按整条淘汰旧消息，单条仍超限时确定性保留尾部（最新内容），最终材料长度不超过上限
5. **最终载荷复扫**：对拼接后的 `material` 再扫一遍凭据，命中即 `credential_residual`（防跨消息重组凭据）
6. 幂等（§7）→ 生成 → `JSON.parse` → `validateCaptureCandidates` → 写 pending 候选

## 6. 失败码（白名单）

`ExtractionService` 只把**已知安全错误码**写入 run 并回传；其余异常折叠为 `generator_failed`，禁止把任意异常文本写入或回传（可能含材料片段）。

白名单（正则 `^(invalid_json|invalid_output|extractor_no_text|session_create_failed|missing_api_key|generator_empty|generator_response_too_large|generator_http_\d{3})$`）：

| 错误码 | 来源 | 含义 |
|---|---|---|
| `invalid_json` | core | 生成文本无法 JSON.parse |
| `invalid_output` | core | 输出不是 `{candidates:[...]}` 结构 |
| `extractor_no_text` | OpenCode 生成器 | 子会话回复无文本 |
| `session_create_failed` | OpenCode 生成器 | 临时会话创建失败 |
| `missing_api_key` | MCP 生成器 | 环境变量未提供 API key |
| `generator_empty` | MCP 生成器 | 模型返回空内容 |
| `generator_response_too_large` | MCP 生成器 | 响应超过 400000 字符 |
| `generator_http_<3位>` | MCP 生成器 | HTTP 非 2xx（如 `generator_http_500`） |
| `generator_failed` | core 兜底 | 其他一切异常统一折叠 |

`skipped` 状态（非失败）的 reason：`empty_material`、`credential_residual`。

## 7. 幂等键语义

幂等键基于**最终材料的内容 hash**，不用长度（同长度不同正文不碰撞）。

```
material  = 筛选、脱敏、裁剪后的最终材料文本
digest    = sha256(sourceKind \0 targetFingerprint \0 extractorVersion \0 material)[0:16]
```

`beginCapture` 的 `contextKey = `${contextKey}:${snapshotId}:${targetFingerprint}:${digest}``，`extractorVersion = CAPTURE_EXTRACTOR_VERSION`（当前 `'extraction-v1'`）。

`snapshotId` 由适配器提供、代表一次材料快照：MCP `memory_extract` 用输入文本的 sha256 前 16 位；OpenCode 用消息 ID（manual 时 `messageID`）。

底层 `memory_capture_runs.capture_key` 由 `[contextKey, sourceId, extractorVersion, scope.scope, scope.scopeKey]` 的 sha256 派生；`beginCapture` 租约默认 120000 ms。重复提取返回 `already-completed`，并发中返回 `in-progress`。

## 8. 审批流

`ExtractionService` 只写 `status=pending`、`origin=agent`、`trust=low` 的候选，不直接落正式记忆，不自动 Pin。审批沿用候选流程：

- OpenCode 工具：`memory_candidates`（列表）→ `memory_candidate_read` → `memory_candidate_review`（`approve`/`reject`）。
- CLI：`memory-review --list` / `--approve 1,2` / `--reject 3` / `--all-approve` / `--all-reject`。
- MCP 工具：`memory_candidate_list` / `memory_candidate_read` / `memory_candidate_review`（需 `profile=full` 且 `allowCandidateReview=true`）。

批准后创建或关联正式记忆（`origin=agent`、`trust=high`），不会自动 Pin；含凭据/bidi/不可见 Unicode 的候选批准时被 `security_rejected`。

## 9. 适配器不要做什么

- 不复制 `CAPTURE_PROMPT` / `CAPTURE_EXTRACTOR_VERSION`（直接 import）。
- 不实现候选校验（`validateCaptureCandidates` 由 `ExtractionService` 统一调用）。
- 不自行实现来源准入、脱敏、预算、幂等（都在 core）。
- 不把未筛选的 role 当作作者身份（必须提供结构化来源映射 `origin`）。
- v1 无结构化来源的宿主默认拒绝提取，回退开关是显式的、默认关闭的。

## 10. 参考落点

| 宿主 | 材料来源 | 生成器 | 状态 |
|---|---|---|---|
| OpenCode（`packages/opencode`） | `client.session.typedContext` + `extractionMaterial`（v2）；v1 走 `trustRoleAsOrigin` 回退 | 宿主子会话 | 已实现（target 仅 agent / host-default，`model` 未支持） |
| MCP（`packages/mcp`） | `memory_extract` 传 `origin='model-report'` | openai-compatible HTTP | 已实现；真实模型端到端**未验证** |
