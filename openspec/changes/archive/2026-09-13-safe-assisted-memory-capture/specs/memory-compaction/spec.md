## ADDED Requirements

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
