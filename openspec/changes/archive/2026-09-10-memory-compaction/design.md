## Context

S3 实现压缩自动归档。S0 spike 已验证完整链路：`summarize` 触发 → compaction agent（`info.agent==="compaction"`）生成摘要（text part）→ `session.compacted` 事件 → `client.session.messages({path:{id}})` 可读回摘要。本变更回填 spec（实现已完成）。

## Goals / Non-Goals

**Goals:**
- 固化情景记忆（压缩归档 + 检索）为正式 spec

**Non-Goals:**
- 不新增代码；不改实现

## Decisions

**D-C.1 触发：`session.compacted` 事件**
- 插件 `event` 钩子过滤 `event.type === "session.compacted"`，取 sessionID

**D-C.2 摘要来源：compaction agent 消息的 text part**
- `client.session.messages` 返回的消息中，找 `info.agent === "compaction"`（或 `mode === "compaction"`）的 assistant 消息，取其 `type === "text"` part

**D-C.3 幂等：压缩消息 id 作主键**
- `session_summaries.id` = compaction 消息 id，`INSERT OR IGNORE`

**D-C.4 检索：jieba + FTS5 BM25**（与长期记忆一致）

## Risks / Trade-offs

- [compaction 用 OpenAI provider（可能欠费）] → 属用户 provider 配置，插件仅被动归档，不主动触发压缩
- [summarize 是 fire-and-forget] → 归档靠事件驱动，不依赖 summarize 返回值

## Migration Plan

- 迁移 v2 建 `session_summaries` + FTS（已实现）

## Open Questions

- 无
