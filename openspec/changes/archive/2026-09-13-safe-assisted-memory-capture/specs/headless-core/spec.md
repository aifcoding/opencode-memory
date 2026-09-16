## ADDED Requirements

### Requirement: 候选记忆公共 API

MemoryManager SHALL 提供结构化的 capture run、candidate 查询和 candidate 审批 API，不包含 OpenCode 类型或模型调用逻辑。

#### Scenario: Core 不调用模型

- **WHEN** 非 OpenCode 调用者使用候选 API
- **THEN** Core 只处理运行状态、校验、持久化和审批，不创建或调用 Agent

#### Scenario: 结构化 Capture 结果

- **WHEN** begin、complete、fail 或 review 操作完成
- **THEN** Core 返回判别联合状态，不返回 OpenCode 专属文案

### Requirement: Capture Scope 与 Context 分离

候选的正式记忆目标 SHALL 使用 ScopeRef；提取来源 SHALL 使用 contextKey 和 sourceId。

#### Scenario: OpenCode 映射

- **WHEN** OpenCode Adapter 创建 capture run
- **THEN** sessionID 映射为 contextKey，compaction 或消息 ID 映射为 sourceId
