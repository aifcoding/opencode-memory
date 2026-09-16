## Why

当前长期记忆已经包含 `title`、`summary` 和 `content`，但 Recall 仍缺少统一的分层读取、内容预算和跨 Adapter 引用：

- 搜索阶段通常只需要标题和摘要，不应默认返回全文。
- 仅限制结果条数无法约束实际上下文长度。
- 超出详细预算的候选如果只返回数量，模型无法直接选择其中某条继续读取。
- OpenCode、MCP、情景摘要和候选缺少统一的引用格式。

本变更将 `title/summary/content` 正式定义为 L0/L1/L2，默认使用 Summary 投影；详细结果受字符预算限制，溢出候选以轻量 L0 列表返回；所有实体使用计算型 `memory://local/...` Ref。

项目处于单用户开发阶段，本变更不保留旧 Recall 返回路径。

## What Changes

- `recallMemories` 统一返回投影结果和预算元数据
- 默认 `projection=summary`；只有显式 `projection=full` 才返回全文
- 新增三种投影：`title`（L0）/ `summary`（L1）/ `full`（L2）
- Summary 为空时使用正文前 200 个 UTF-16 code unit 作为 `content_preview`，不修改数据库
- 新增 Recall 详细字符预算：`maxCharacters` / `preferSummary`
- 新增 Overflow 双预算：`maxOverflowItems` / `maxOverflowCharacters`
- 详细结果按 BM25 score 降序形成连续前缀，不跳过高分大条目
- `projection=full` 且全文放不下时，可降级为 Summary
- 详细预算溢出的候选进入 `overflow`，返回：id / ref / title / trust / score
- 新增结果元数据：consideredCount / usedCharacters / overflowUsedCharacters / truncated / degradedCount / omittedCount
- 新增计算型 Ref：`memory://local/memories/{id}` / `memory://local/summaries/{encoded-id}` / `memory://local/candidates/{id}`
- 新增 Ref 生成、严格解析和 `readReference({ref, scope})`
- `MemoryStore` 增加可选 `getSummary(id)` 端口
- OpenCode `memory_recall`：固定 Summary 投影、新增可选 `maxCharacters`、输出 Ref/Overflow/截断提示、不暴露 Projection
- MCP `memory_search`：固定 Summary 投影、新增可选 `maxCharacters`、保留 `preview`、新增 `ref`/`previewSource`、envelope.meta 返回预算与 Overflow
- OpenCode/MCP 配置文件新增 `recall` 配置节
- 新增 `docs/CONFIGURATION.md` 统一说明配置
- 本变更不修改数据库 Schema

## Capabilities

### New Capabilities

（无。该变更升级现有读路径。）

### Modified Capabilities

- `headless-core`：新增 Projection、RecallBudget、Overflow、Memory Ref 和 `readReference`
- `retrieval`：Recall 默认改为 Summary 投影，并增加详细预算与 Overflow 双预算
- `memory-storage`：增加按 ID 读取 Summary 的可选端口，确认 Ref 零持久化
- `mcp`：`memory_search` 增加分层预览、Ref 和预算元数据

## Dependencies

- MCP 增量依赖 `2026-09-13-mcp-server` 已归档为 canonical `mcp` capability
- OpenCode 和 MCP Adapter 必须依赖包含本变更 API 的 Core 版本
- 本变更不依赖 D15、向量检索或 Recall@K/MRR 评测

## Impact

- **项目版本**：`2.1.0`
- **Core**：`@aifcoding/memory-core@0.3.0`
- **OpenCode Adapter**：`@aifcoding/opencode-memory@2.1.0`
- **MCP Adapter**：`@aifcoding/memory-mcp@0.2.0`
- **Core API**：`recallMemories` 返回结构发生变化，现有调用方必须迁移
- **OpenCode**：Recall 默认返回摘要或正文预览，全文继续通过 `memory_read` 获取
- **MCP**：Search 保留 `preview`，非破坏性增加 Ref、Preview 来源和预算 Meta
- **数据库**：零迁移；不增加表、列或索引
- **检索算法**：继续使用 FTS5/BM25 和现有 Tokenizer
- **Token 经济性**：第一方 Adapter 默认不再在搜索阶段返回多条全文
- **文档**：新增统一配置文档并更新三个包的 README

## Non-Goals

- 不保留旧 Recall 返回结构
- 不提供泛型双返回、方法重载或 Legacy 分支
- 不自动生成或持久化缺失 Summary
- 不精确计算模型 Token
- 不执行额外 SQL Count 查询
- 不跳过高分大条目以填充低分小条目
- 不实现跨数据库稳定 UUID
- 不实现导入导出时的 Ref 保留
- 不实现 D15 项目身份或 Summary Scope
- 不实现向量检索、RRF 或目录感知检索
- 不建立 Recall@K/MRR 评测
- 不修改 OpenCode `memory_read` 的数字 ID 参数
- 不在 MCP 中暴露通用 `readReference`
- 不通过 Ref 绕过 MCP Scope、Profile 或 Candidate Capability
