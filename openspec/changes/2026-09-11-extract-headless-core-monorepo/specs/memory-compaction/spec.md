## MODIFIED Requirements

### Requirement: 压缩自动归档

OpenCode Adapter SHALL 在 `session.compacted` 事件发生时读取并提取 compaction 摘要；Core SHALL 接收稳定事件 ID、contextKey、文本和创建时间，幂等归档到 `session_summaries`。

#### Scenario: Adapter 提取归档参数

- **WHEN** OpenCode 触发 `session.compacted`
- **THEN** Adapter 从 compaction 消息提取 message id、sessionID、消息时间和文本，并调用 `MemoryManager.archiveSummary`

#### Scenario: Core 幂等归档

- **WHEN** Core 第一次收到某个摘要 ID
- **THEN** 主表和 FTS 同事务写入，并返回 `status=inserted`

#### Scenario: 重复归档

- **WHEN** Core 再次收到相同摘要 ID
- **THEN** 不新增主表或 FTS 记录，并返回 `status=duplicate`

### Requirement: 情景记忆检索

`MemoryManager.recallSummaries` SHALL 返回结构化摘要结果；OpenCode Adapter SHALL 负责转换为工具输出。检索继续使用 jieba、FTS5 和 BM25，无匹配返回空。

#### Scenario: 结构化摘要召回

- **WHEN** Core 检索命中历史摘要
- **THEN** 返回 id、contextKey、text、createdAt 和 score
