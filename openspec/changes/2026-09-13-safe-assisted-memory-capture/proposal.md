## Why

opencode-memory 当前提供长期知识、情景摘要和会话 KV，但长期知识主要依赖用户显式调用 `memory_store`。有价值的项目约定、架构决策和故障根因仍可能随着会话结束而丢失。

直接让 Agent 自动写入正式记忆风险过高：临时状态、中间猜测、凭据、工具输出或已注入的历史记忆可能被永久保存，形成错误记忆或「记忆→注入→再次提取」的递归污染。

本变更引入「安全辅助记忆提取」：Agent 只从经过过滤的会话内容中提出低信任候选，用户审批后候选才转为正式记忆。自动提取默认关闭，不自动批准、不自动 Pin。

## What Changes

- 增加会话记忆候选提取能力：`session.compacted` 后可选触发 + 用户显式工具触发；自动提取默认关闭。
- 增加候选审批生命周期：`pending → approved` / `pending → rejected`；候选固定 `origin=agent`、`trust=low`。
- 增加候选存储和提取运行记录，保证重复 compaction 事件幂等。
- 提取前过滤 Pin 注入、memory recall/read 结果、工具输出及已有参考块。
- 使用严格 JSON 输出 Schema 和 Do NOT Capture 清单约束提取 Agent。
- 候选携带 `suggestedDomain=code|user|business|uncertain`，不修改正式 memories 表的 category 模型。
- 增加基础安全扫描：常见凭据模式、双向控制字符、高风险不可见 Unicode。
- 凭据或高风险 Unicode 候选不得进入候选库，原文不得写入日志。
- 用户批准候选后，在同一事务中创建正式 memory、同步 FTS 并更新候选状态。
- 批准后的记忆保留 `origin=agent`，升级为 `trust=high`，但不自动 Pin。
- 增加记忆提取金标集，优先评估 Precision、错误提取率和重复率。
- OpenCode Adapter 新增候选提取、列表、读取和审批工具。

## Capabilities

### New Capabilities

- `memory-capture`: 从会话中安全提取候选记忆，执行安全过滤、幂等记录和用户审批。

### Modified Capabilities

- `headless-core`: MemoryManager 增加候选与提取运行的结构化 API。
- `memory-storage`: 增加 capture run 和 candidate 持久化、审批事务。
- `memory-injection`: pending/rejected 候选不得参与 Pin 或上下文注入。
- `memory-compaction`: compaction 归档完成后可选触发候选提取。
- `retrieval`: 未批准候选不得参与正式记忆检索。

## Impact

- **数据库**：新增 `memory_capture_runs` 和 `memory_candidates` 表及迁移版本；现有表和数据保持兼容。
- **Core API**：MemoryManager 新增提取运行、候选查询和审批方法。
- **OpenCode Adapter**：增加提取配置及 4 个候选相关工具。
- **模型调用**：提取需要额外模型调用；默认关闭，启用时需显式配置提取 Agent。
- **安全**：候选默认低信任且与正式检索、Pin、注入隔离。
- **兼容性**：现有 12 个工具、数据库路径、Pin 配额和用户行为保持不变。

## Non-Goals

- 不做每 N 轮后台提取。
- 不自动批准、自动 Pin 或自动覆盖已有记忆。
- 不增加用户画像表或 `target=user` 字段。
- 不增加正式 memory 的 category 字段。
- 不实现语义去重、知识图谱或自动冲突合并。
- 不实现完整 Curator、快照、Ledger 或回滚系统。
- 不实现多模型 Provider 插件体系。
- 不实现向量检索、RRF、MCP Server 或 TeamKbSource。
- 不承诺启发式 Prompt Injection 检测能够构成安全边界。
