## MODIFIED Requirements

### Requirement: recall 语义

`MemoryManager.recallMemories` SHALL 始终返回投影结果、Overflow 和预算元数据，并保持 Store 的 score 降序。未提供 projection 时默认使用 summary；只有显式 projection=full 才返回完整正文。有 query 无匹配时返回空结果，绝不回退最近条目。

#### Scenario: 无匹配返空

- **WHEN** 检索词与库中无任何匹配
- **THEN** 返回空 memories、空 overflow、usedCharacters=0、overflowUsedCharacters=0、consideredCount=0、degradedCount=0、omittedCount=0、truncated=false

#### Scenario: 结果带 id 与 score

- **WHEN** 检索命中多条
- **THEN** Detail 与 Overflow 每条含 id、ref 与 score，并保持当前查询的 score 降序

#### Scenario: 默认不返回全文

- **WHEN** 调用者未提供 projection
- **THEN** 每条使用 summary 或 content_preview，不返回完整 content

#### Scenario: 显式返回全文

- **WHEN** 调用者指定 projection=full 且预算允许
- **THEN** 返回完整 content

## ADDED Requirements

### Requirement: Detail 连续前缀

Detail 阶段 SHALL 按 score 降序逐条累加，并保持连续前缀。

#### Scenario: 精确边界

- **WHEN** 加入下一条后的长度等于 maxCharacters
- **THEN** 允许加入

#### Scenario: 超出边界

- **WHEN** 加入下一条后的长度大于 maxCharacters
- **THEN** 不加入该条，并从该条开始进入 Overflow

#### Scenario: 不跳过高分条目

- **WHEN** 当前高分条目无法放入 Detail
- **THEN** 停止 Detail 阶段，不跳过它去返回后续低分条目

#### Scenario: Detail 分隔符

- **WHEN** 返回多条 Detail
- **THEN** usedCharacters 包含条目间两个换行字符

### Requirement: Full 降级

projection=full 时，Core SHALL 根据 preferSummary 决定是否将放不下的全文降级为 Summary。

#### Scenario: 允许降级

- **WHEN** Full 放不下、preferSummary=true 且 Summary 可以放入
- **THEN** 返回实际 projection=summary 的条目，degradedCount 增加，并继续处理后续候选

#### Scenario: 禁止降级

- **WHEN** Full 放不下且 preferSummary=false
- **THEN** 停止 Detail 并进入 Overflow

#### Scenario: Summary 不再降级

- **WHEN** Summary 放不下
- **THEN** 不自动降级为 Title，而是进入 Overflow

### Requirement: Overflow 连续前缀

Overflow SHALL 从首个无法进入 Detail 的候选开始，按 score 顺序生成 L0 导航项。

#### Scenario: 首条 Detail 放不下

- **WHEN** 第一条无法进入 Detail
- **THEN** memories 为空、truncated=true，并尝试将第一条加入 Overflow

#### Scenario: Overflow 字符预算

- **WHEN** 加入下一条 Overflow 会超过 maxOverflowCharacters
- **THEN** 停止 Overflow，不跳过该条

#### Scenario: Overflow 条数预算

- **WHEN** Overflow 已达到 maxOverflowItems
- **THEN** 停止 Overflow

#### Scenario: Overflow 分隔符

- **WHEN** 返回多条 Overflow
- **THEN** overflowUsedCharacters 包含条目间一个换行字符

### Requirement: Truncated 与 Omitted 语义

truncated SHALL 只表示 considered hits 中存在因 Detail Budget 未按详细路径返回的条目；omittedCount SHALL 只统计 Detail 和 Overflow 都未返回的 considered hits。

#### Scenario: 全部溢出项有 L0

- **WHEN** Detail 被截断但所有剩余候选均进入 Overflow
- **THEN** truncated=true 且 omittedCount=0

#### Scenario: Overflow 预算耗尽

- **WHEN** 部分剩余候选未进入 Overflow
- **THEN** omittedCount 等于完全未展示的 considered hits 数量

#### Scenario: Limit 不算截断

- **WHEN** Store 因 limit 只返回有限候选且这些候选都在 Detail Budget 内
- **THEN** truncated=false 且 omittedCount=0

### Requirement: OpenCode Summary Recall

OpenCode memory_recall SHALL 固定使用 summary Projection，并允许调用者仅覆盖 maxCharacters。

#### Scenario: 有已存摘要

- **WHEN** Recall 命中的记忆有非空 summary
- **THEN** 输出标题、Ref 和已存摘要

#### Scenario: 无摘要

- **WHEN** Recall 命中的记忆 summary 为空
- **THEN** 输出标题、Ref 和正文前 200 字符

#### Scenario: Overflow 输出

- **WHEN** Detail Budget 被截断
- **THEN** 输出预算允许的 Overflow id、ref、title、trust 和 score

#### Scenario: Score 说明

- **WHEN** memory_recall 输出 Overflow score
- **THEN** 工具说明 Score 只能用于本次查询相对排序，不能跨查询比较

#### Scenario: 按需全文

- **WHEN** 用户调用 memory_read
- **THEN** 继续按数字 ID 返回完整正文
