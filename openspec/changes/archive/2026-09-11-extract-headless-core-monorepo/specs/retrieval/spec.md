## MODIFIED Requirements

### Requirement: recall 语义

`MemoryManager.recallMemories` SHALL 返回 `{ memories: [{ memory, score }] }` 并按 score 降序；有 query 无匹配时返回空，绝不回退最近条目。OpenCode Adapter SHALL 仅负责将结构化结果格式化为工具文本。

#### Scenario: Core 结构化召回

- **WHEN** 调用 `recallMemories` 且命中多条
- **THEN** 每条结果包含完整 MemoryEntry 和 score，并按相关度降序

#### Scenario: Adapter 保持无匹配语义

- **WHEN** Core 返回空列表
- **THEN** OpenCode Adapter 返回现有「无匹配记忆」语义，不补充最近条目

#### Scenario: 无匹配返空

- **WHEN** 检索词与库中无任何匹配
- **THEN** 返回空列表，不返回无关条目

#### Scenario: 结果带 id 与 score

- **WHEN** 检索命中多条
- **THEN** 每条含完整 memory 与 score，并按 score 降序
