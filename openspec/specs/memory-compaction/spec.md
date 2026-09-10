# memory-compaction Specification

## Purpose
定义会话压缩摘要的自动、幂等归档及跨会话检索行为。

## Requirements

### Requirement: 压缩自动归档

系统 SHALL 在会话压缩发生时（`session.compacted` 事件）自动读取压缩摘要并归档到 `session_summaries`，且归档幂等。

#### Scenario: 压缩后归档
- **WHEN** 会话压缩完成、`session.compacted` 事件触发
- **THEN** 读取 compaction agent 生成的摘要文本，写入 `session_summaries`

#### Scenario: 幂等
- **WHEN** 同一压缩消息重复归档
- **THEN** 以压缩消息 id 为键，不产生重复记录

### Requirement: 情景记忆检索

系统 SHALL 支持跨会话检索归档摘要。

#### Scenario: 检索摘要
- **WHEN** 以关键词检索历史摘要
- **THEN** 返回匹配摘要（jieba 分词 + FTS5 BM25 排序），无匹配返回空
