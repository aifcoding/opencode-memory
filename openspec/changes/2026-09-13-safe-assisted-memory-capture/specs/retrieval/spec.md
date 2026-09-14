## ADDED Requirements

### Requirement: 正式检索排除候选

正式长期记忆检索 SHALL 只查询 memories 与 memories_fts，不查询 memory_candidates。

#### Scenario: Pending 候选不参与检索

- **WHEN** candidate 为 pending 或 rejected
- **THEN** recallMemories 和 memory_recall 不返回该候选

#### Scenario: 批准后可检索

- **WHEN** pending candidate 被批准并创建正式 memory
- **THEN** 正式 memory 进入 memories_fts，并可通过现有检索管线召回
