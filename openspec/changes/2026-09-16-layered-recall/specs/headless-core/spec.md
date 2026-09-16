## ADDED Requirements

### Requirement: 统一分层召回 API

Core SHALL 提供 title、summary、full 三种 Memory Projection。`recallMemories` SHALL 只有一种投影结果结构，未提供 projection 时默认使用 summary。

#### Scenario: 默认 Summary

- **WHEN** 调用 recallMemories 未提供 projection
- **THEN** 使用 summary 投影，不返回完整 content

#### Scenario: Title 投影

- **WHEN** projection=title
- **THEN** 返回标题与公共元数据，不返回 summary 或 content

#### Scenario: Summary 投影

- **WHEN** projection=summary 且存在非空 summary
- **THEN** 返回已保存摘要并标记 summarySource=stored

#### Scenario: Summary 回退

- **WHEN** projection=summary 且 summary 为空
- **THEN** 返回正文前 200 个 UTF-16 code unit，并标记 summarySource=content_preview，且不修改数据库

#### Scenario: Full 投影

- **WHEN** projection=full
- **THEN** 返回完整 content

### Requirement: Recall 默认预算

Core SHALL 提供 RecallBudget 和 DEFAULT_RECALL_BUDGET。未提供的预算字段使用默认值。

默认值：maxCharacters=3000、preferSummary=true、maxOverflowItems=10、maxOverflowCharacters=1500。

#### Scenario: 部分覆盖预算

- **WHEN** 调用者只提供部分 RecallBudget 字段
- **THEN** 其余字段使用 DEFAULT_RECALL_BUDGET

#### Scenario: 字符定义

- **WHEN** Core 计算 Detail 或 Overflow 长度
- **THEN** 使用 JavaScript string.length，即 UTF-16 code unit，不解释为 Token

#### Scenario: 非法预算

- **WHEN** 预算字段超出允许范围或类型非法
- **THEN** 抛出 MemoryValidationError

### Requirement: Overflow 轻量导航

详细预算外的 considered hits SHALL 进入独立 Overflow 阶段，并仅返回 id、ref、title、trust 和 score。

#### Scenario: Overflow 内容

- **WHEN** 候选因 Detail Budget 未按详细路径返回
- **THEN** 在 Overflow 预算允许时返回 L0 导航项

#### Scenario: Score 语义

- **WHEN** Overflow 返回 score
- **THEN** score 仅表示当前 BM25 查询中的相对相关度，不得用于跨查询比较

#### Scenario: Overflow 双预算

- **WHEN** Overflow 达到 maxOverflowItems 或 maxOverflowCharacters
- **THEN** 停止返回后续 Overflow 项，剩余 considered hits 计入 omittedCount

#### Scenario: Overflow 关闭

- **WHEN** maxOverflowItems=0 或 maxOverflowCharacters=0
- **THEN** 不返回 Overflow，所有 Detail 溢出项计入 omittedCount

### Requirement: Recall 统计元数据

RecallMemoriesResult SHALL 返回 consideredCount、usedCharacters、overflowUsedCharacters、truncated、degradedCount 和 omittedCount。

#### Scenario: 计数恒等关系

- **WHEN** Recall 完成
- **THEN** consideredCount 等于 memories.length + overflow.length + omittedCount

#### Scenario: 空结果

- **WHEN** Store 没有返回候选
- **THEN** 两个数组为空，字符数和计数为 0，truncated=false

### Requirement: 本地稳定 Memory Ref

Core SHALL 为 memory、summary 和 candidate 提供 `memory://local/...` 计算型 Ref；Ref 在同一数据库内跨重启和 Adapter 保持稳定。

#### Scenario: Memory Ref

- **WHEN** 为正式 Memory 生成 Ref
- **THEN** 使用 `memory://local/memories/{positive-id}`

#### Scenario: Summary Ref

- **WHEN** 为 Summary 生成 Ref
- **THEN** 使用 `memory://local/summaries/{percent-encoded-id}`

#### Scenario: Candidate Ref

- **WHEN** 为 Candidate 生成 Ref
- **THEN** 使用 `memory://local/candidates/{positive-id}`

#### Scenario: Ref 不持久化

- **WHEN** 生成 Ref
- **THEN** Ref 由实体类型和 ID 计算，不写入数据库

### Requirement: Ref 严格解析

parseMemoryReference SHALL 拒绝非法 scheme、host、身份信息、port、query、fragment、路径、ID 和 percent encoding。

#### Scenario: 合法 Ref

- **WHEN** Ref 使用 memory scheme、local host 和合法实体路径
- **THEN** 返回 kind、canonical ref 和解码后的 ID

#### Scenario: 非法 Ref

- **WHEN** 任一 Ref 规则不满足
- **THEN** 抛出 InvalidMemoryReferenceError，错误不回显完整 Ref

### Requirement: 按 Ref 读取

MemoryManager SHALL 提供 `readReference({ref, scope})`，并返回 found、not_found、deleted 或 unsupported。

#### Scenario: Memory Scope

- **WHEN** Memory Ref 指向当前 Scope 的有效 Memory
- **THEN** 返回 found；Scope 不匹配时返回 not_found

#### Scenario: Candidate Scope

- **WHEN** Candidate Ref 指向当前 Scope 的 Candidate
- **THEN** 返回 found；Scope 不匹配时返回 not_found

#### Scenario: Summary

- **WHEN** Summary Ref 指向已有 Summary 且 Store 支持 getSummary
- **THEN** 返回 SummaryEntry

#### Scenario: 不支持的能力

- **WHEN** Store 不支持 Ref 对应的 Summary 或 Candidate 能力
- **THEN** 返回 unsupported

#### Scenario: 已删除 Memory

- **WHEN** Ref 指向软删除 Memory
- **THEN** 返回 deleted

### Requirement: 第一方 Recall 配置

OpenCode 和 MCP Adapter SHALL 提供 recall 配置节，用于覆盖 Detail 与 Overflow 默认预算。

#### Scenario: OpenCode 配置

- **WHEN** opencode-memory.jsonc 或 Plugin Tuple Options 提供 recall 配置
- **THEN** memory_recall 使用该配置，工具 maxCharacters 只覆盖本次 Detail Budget

#### Scenario: MCP 配置

- **WHEN** memory-mcp.jsonc 提供 recall 配置
- **THEN** memory_search 使用该配置，工具 maxCharacters 只覆盖本次 Detail Budget
