# memory-compaction Specification

## Purpose
定义会话压缩摘要的自动、幂等归档及跨会话检索行为。

## Requirements

### Requirement: 压缩自动归档

OpenCode Adapter SHALL 在 `session.compacted` 事件发生时提取摘要；Core SHALL 接收稳定 ID、contextKey、文本和时间，幂等归档到 `session_summaries`。

#### Scenario: 压缩后归档
- **WHEN** 会话压缩完成、`session.compacted` 事件触发
- **THEN** 读取 compaction agent 生成的摘要文本，写入 `session_summaries`

#### Scenario: 幂等
- **WHEN** 同一压缩消息重复归档
- **THEN** 以压缩消息 id 为键，不产生重复记录

### Requirement: 情景记忆检索

`MemoryManager.recallSummaries` SHALL 支持跨会话检索归档摘要并返回结构化结果。

#### Scenario: 检索摘要
- **WHEN** 以关键词检索历史摘要
- **THEN** 返回匹配摘要（jieba 分词 + FTS5 BM25 排序），无匹配返回空

### Requirement: Compaction 后可选触发候选提取

OpenCode Adapter SHALL 在 compaction 摘要归档成功后，根据 capture 配置决定是否启动候选提取。

#### Scenario: 默认不提取

- **WHEN** session.compacted 发生但 capture 未启用
- **THEN** 摘要正常归档，不调用提取 Agent

#### Scenario: 启用自动提取

- **WHEN** capture.enabled=true、onCompaction=true 且摘要首次归档
- **THEN** Adapter 使用 sessionID、compaction ID 和 extractorVersion 启动一次 capture

#### Scenario: 重复事件

- **WHEN** 相同 compaction 事件重复到达
- **THEN** 摘要归档和候选提取均保持幂等

#### Scenario: 提取失败

- **WHEN** 摘要归档成功但候选提取失败
- **THEN** 已归档摘要保持有效，主会话和 compaction 流程不失败
