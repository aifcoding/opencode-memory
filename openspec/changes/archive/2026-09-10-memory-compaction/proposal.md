## Why

S3 实现了会话压缩自动归档（情景记忆，`session_summaries` 表）与 `recall_summaries` 检索，已端到端验证，但未走 OpenSpec 流程，`openspec/specs/` 缺失这一能力。本变更回填正式 spec，补齐三层记忆模型的第二层（情景记忆）。

## What Changes

- 新增能力 spec `memory-compaction`，覆盖：
  - 压缩自动归档（`session.compacted` 事件 → 读 compaction 摘要 → 幂等入库）
  - 情景记忆检索（`recall_summaries`，jieba + BM25）
- 无新代码（实现已在 `SqliteMemoryStore.ts` + `plugin.ts`，19 测试通过 + 端到端实测）

## Capabilities

### New Capabilities
- `memory-compaction`: 情景记忆——会话压缩自动归档摘要 + 跨会话检索

### Modified Capabilities
（无）

## Impact

- **文档**：`openspec/specs/memory-compaction/spec.md` 新增，补齐 specs 层
- **代码**：无（回填既有实现）
- **对齐**：三层记忆模型（长期/情景/工作）的 specs 齐全
