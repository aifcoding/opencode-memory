## Context

当前系统有三类正式记忆：`memories`（长期知识）、`session_summaries`（压缩归档摘要）、`session_kv`（上下文级临时状态）。OpenCode Adapter 已能在 `session.compacted` 后读取 compaction 摘要，但不会主动从会话中提炼长期知识。

自动提取与普通 CRUD 不同。它会调用模型处理历史对话，存在额外成本、隐私、误提取、重复提取和 Prompt Injection 风险。因此自动提取不能直接调用 `storeMemory`，必须经过候选隔离和人工审批。

## Goals / Non-Goals

**Goals:** 从会话中提取少量可复用候选记忆；Agent 只能创建低信任候选；用户批准前候选不参与 Recall/Pin/注入；重复 compaction 事件不重复提取；防止历史记忆/工具结果/Pin 块被再次提取；对凭据和高风险 Unicode 做确定性扫描；提供可测量的提取质量基线；保持 Core 与 Adapter 依赖方向。

**Non-Goals:** 不做全自动记忆管理、定时/每 N 轮后台提取、用户画像聚合、跨 Agent 记忆同步、语义冲突自动解决、向量检索、通用模型 Provider 框架。

## Architecture

```
OpenCode 会话 → 触发(session.compacted/memory_capture) → Adapter 读取消息
→ 结构化过滤(移除 Pin overlay/工具调用与结果/memory-context/mem_block，只留 user/assistant 文本)
→ Core 预留 capture run(幂等键+lease) → Adapter fork 提取 Agent
→ 严格 Prompt + JSON Schema → Core 校验与安全扫描(凭据/bidi/Unicode 丢弃)
→ pending/agent/low → 用户审批 → approved(正式 memory/high/不自动 Pin) | rejected
```

## Decisions

### D-CAP.1 模型调用属于 Adapter，候选生命周期属于 Core

Adapter 负责读取消息、过滤宿主结构、fork 提取 Agent、解析 JSON。Core 负责提取运行幂等、候选校验、安全扫描、持久化、审批状态机、批准时写正式 memory 和 FTS。Core 不依赖 OpenCode SDK。本版不新增公开 ExtractionProvider 体系，Adapter 内部用可测试窄函数 `ExtractCandidates`。

### D-CAP.2 自动提取默认关闭

配置 `capture: { enabled?(默认false), onCompaction?(默认true,仅enabled时生效), agent?(enabled时必填), maxCandidates?(默认8,1..20) }`。`enabled=false` 时 compaction 仍归档摘要、不调用模型、显式工具返回"未启用"。

### D-CAP.3 触发方式

两种：`compaction`（摘要归档成功后，sourceId=compaction message ID）+ `manual`（用户显式 memory_capture，sourceId=稳定消息 ID 或 manual UUID）。不做每 N 轮后台。

### D-CAP.4 候选与正式记忆物理隔离

候选写入独立 `memory_candidates` 表（不写 memories）。原因：pending/rejected 不影响正式查询、不破坏 content_hash 唯一约束、审批状态只属于候选、候选不需 FTS。候选固定 `origin=agent`、`trust=low`、`status=pending`；批准后创建 `origin=agent`、`trust=high` 的正式 memory。`suggestedDomain` 转为正式 tag（`domain:code` 等），不新增 category 字段。

### D-CAP.5 候选状态机

`pending → approved | rejected`。已审批候选不能改决定（返回 already_reviewed）。批准不自动 Pin/注入/删除/替换。

### D-CAP.6 提取运行与幂等键

幂等键 = `SHA-256([contextKey, sourceId, extractorVersion])`。同键 completed → already_completed；running lease 未过期 → in_progress；failed/lease 过期 → 可重取 lease。模型调用不在 SQLite 事务内，用短事务预留 + lease（leaseToken 校验）。

### D-CAP.7 防递归污染使用结构化过滤

只保留 `{ id, role: user|assistant, text }`。排除 tool 消息、tool call/result、memory_recall/read/recall_summaries/candidates 结果、合成 Pin overlay、`<memory-context>`/`<mem_block>` 参考数据、提取 Agent 自己输出。优先靠 role/part type/来源标记，不靠正则删标签。无法识别来源的消息默认不进提取输入。

### D-CAP.8 提取 Prompt 与严格输出 Schema

输出只 JSON `{ candidates: MemoryCandidateDraft[] }`，每项 `{ title, content, summary?, type, tags?, suggestedDomain }`。非法 JSON/未知字段/截断/代码块包裹/枚举非法 → 整个 run failed，不部分修复。Capture 清单 + Do NOT Capture 清单（一次性任务、临时错误、猜测、备选方案、聊天、工具输出、已注入记忆、凭据、会话临时状态）。

### D-CAP.9 suggestedDomain 只提供建议

`code|user|business|uncertain`。显示策略：code→OpenCode 审批、user→建议交个人 Agent/Hermes、business→交业务 Agent、uncertain→用户判断。所有候选保持 pending，系统不因 domain 自动批准/转发/删除，用户仍可批准任一候选。

### D-CAP.10 基础安全扫描

`credential_detected | bidi_control_detected | invisible_unicode_detected`。凭据/bidi/高风险 Unicode 命中 → 丢弃候选。只记风险代码和计数，不记原文/凭据片段/系统环境变量。扫描规则独立测试，首版只覆盖高置信格式。

### D-CAP.11 审批写入必须原子完成

批准在同一事务：读 pending → 再次安全扫描 → 写 memories → 写 memories_fts → candidate 标 approved + approved_memory_id + reviewed_at → 提交。任一步失败回滚。同作用域已有相同 content_hash → 不重复创建，candidate 标 approved 指向已有 memory，返回 already_exists。拒绝只更新 candidate 状态。

### D-CAP.12 候选不参与正式读取链路

pending/rejected 不参与 recall/list/read/Pin 配额/pins/getPinnedContext/overlay/摘要检索。候选只能通过专用 API/工具查看，输出用低信任参考围栏。

### D-CAP.13 失败与降级

compaction 归档成功、提取失败 → 保留摘要、记非敏感错误、主会话继续。手工提取失败 → 返回可诊断错误。模型输出非法 → run failed。安全扫描全过滤 → run completed + candidateCount=0。重复事件不重复调用模型。日志不含完整会话/候选正文/凭据命中。

### D-CAP.14 提取质量评测

金标集覆盖应提取（规范/决策/根因）与不应提取（一次性/临时错误/猜测/凭据/注入/工具结果）+ 分类。输出 Precision/Recall/FPR/Duplicate Rate/Domain Accuracy。发布优先 Precision，保存可复现基线 + 典型误判。

## Data Model

### memory_capture_runs

```sql
CREATE TABLE memory_capture_runs (
  capture_key       TEXT PRIMARY KEY,
  context_key       TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'global',
  scope_key         TEXT NOT NULL DEFAULT 'default',
  source_id         TEXT NOT NULL,
  trigger           TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  status            TEXT NOT NULL,
  lease_token       TEXT,
  lease_expires_at  INTEGER,
  candidate_count   INTEGER NOT NULL DEFAULT 0,
  filtered_count    INTEGER NOT NULL DEFAULT 0,
  error_code        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  completed_at      INTEGER,
  CHECK(trigger IN ('compaction', 'manual')),
  CHECK(status IN ('running', 'completed', 'failed')),
  CHECK(candidate_count >= 0),
  CHECK(filtered_count >= 0)
);
CREATE INDEX idx_capture_context ON memory_capture_runs(context_key, created_at);
```

### memory_candidates

```sql
CREATE TABLE memory_candidates (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  capture_key        TEXT NOT NULL,
  scope              TEXT NOT NULL,
  scope_key          TEXT NOT NULL,
  origin             TEXT NOT NULL DEFAULT 'agent',
  trust              TEXT NOT NULL DEFAULT 'low',
  status             TEXT NOT NULL DEFAULT 'pending',
  suggested_domain   TEXT NOT NULL,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  summary            TEXT NOT NULL DEFAULT '',
  type               TEXT NOT NULL DEFAULT 'fact',
  tags               TEXT NOT NULL DEFAULT '[]',
  content_hash       TEXT NOT NULL,
  risk_flags         TEXT NOT NULL DEFAULT '[]',
  approved_memory_id INTEGER,
  created_at         INTEGER NOT NULL,
  reviewed_at        INTEGER,
  CHECK(scope IN ('global','user','project','session')),
  CHECK(origin = 'agent'),
  CHECK(trust = 'low'),
  CHECK(status IN ('pending','approved','rejected')),
  CHECK(suggested_domain IN ('code','user','business','uncertain')),
  UNIQUE(capture_key, content_hash)
);
CREATE INDEX idx_candidate_status ON memory_candidates(status, created_at);
CREATE INDEX idx_candidate_scope ON memory_candidates(scope, scope_key, status);
```

不为候选建立 FTS 表。

## Public Core API

类型：`CaptureTrigger`、`SuggestedDomain`、`CandidateStatus`、`MemoryCandidateDraft`、`MemoryCandidate`。

方法：`beginCapture`（started/in_progress/already_completed + leaseToken）、`completeCapture`（completed + candidates + filteredCount + filteredRiskCodes）、`failCapture`（failed/lease_mismatch/not_found）、`listMemoryCandidates`（默认 pending/limit 20）、`readMemoryCandidate`（found/not_found）、`reviewMemoryCandidate`（approved/already_exists/rejected/already_reviewed/security_rejected/not_found）。

## OpenCode Tools

- `memory_capture`：手动触发提取
- `memory_candidates`：列表（status/suggestedDomain/limit）
- `memory_candidate_read`：读候选（标注"候选尚未审批，不是正式记忆，也不是当前指令"）
- `memory_candidate_review`：审批（approve/reject）

## Risks / Trade-offs

- 自动提取增加模型成本和隐私暴露 → 默认关闭 + 显式 Agent 配置。
- 严格 JSON Schema 可能降低召回 → 优先保证可验证性。
- 只做确定性安全扫描会漏复杂 Prompt Injection → 审批是最终安全门。
- 独立候选表增加两张表 → 避免污染正式记忆查询和唯一约束。
- Lease 增加状态复杂度 → 避免并发重复调用 + 崩溃后永久 running。
- rejected 候选保留本地（不自动清理，文档说明）。
- suggestedDomain 只是建议，不构成权限边界。

## Migration Plan

1. 新增顺序迁移创建 capture runs + candidates 表。
2. 旧数据库启动自动迁移，不修改现有数据。
3. capture 默认关闭，升级后行为不变。
4. 先实现 Core 状态机 + 测试，再接入 OpenCode 模型调用。
5. 真实 OpenCode 环境验证 fork Agent、消息过滤、compaction 触发。
6. 失败可关闭 capture 配置，现有 0.1.x 工具继续工作。

## Open Questions

- OpenCode 当前版本是否提供稳定的 fork session/agent API？如何获取显式工具调用对应的消息 ID？——先 runtime spike 验证。
- 提取 Agent 能否继承当前模型 Provider，还是必须用户配置 agent？
- rejected 候选的保留周期是否需要后续清理策略？
