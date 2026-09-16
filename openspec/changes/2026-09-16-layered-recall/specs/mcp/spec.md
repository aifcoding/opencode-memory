> 本增量依赖 `2026-09-13-mcp-server` 先归档。

## ADDED Requirements

### Requirement: MCP Summary Search

`memory_search` SHALL 固定使用 summary Projection，并接受可选 maxCharacters。

#### Scenario: 默认 Summary

- **WHEN** Client 调用 memory_search 且未提供 maxCharacters
- **THEN** 使用 MCP recall 配置中的 maxCharacters 和 Overflow 双预算

#### Scenario: 单次预算覆盖

- **WHEN** Client 提供合法 maxCharacters
- **THEN** 只覆盖本次 Detail Budget，不覆盖 Overflow 预算

#### Scenario: 已存摘要

- **WHEN** 命中记忆具有非空 summary
- **THEN** preview 使用该摘要，previewSource=stored_summary

#### Scenario: 正文预览

- **WHEN** 命中记忆没有 summary
- **THEN** preview 使用正文前 200 字符，previewSource=content_preview

### Requirement: MCP Search Ref

每个 memory_search Detail 结果 SHALL 包含同库稳定的 Memory Ref。

#### Scenario: 返回 Ref

- **WHEN** memory_search 返回正式 Memory
- **THEN** 每项包含 `memory://local/memories/{id}`

#### Scenario: 保留 Preview

- **WHEN** 旧 Client 读取 Search Item
- **THEN** preview 字段继续存在

### Requirement: MCP Search Budget Meta

memory_search 的 structuredContent SHALL 保持 data 为 Detail 数组，并通过可选 meta 返回预算和 Overflow 信息。

#### Scenario: Meta 结构

- **WHEN** memory_search 完成
- **THEN** meta 包含 consideredCount、usedCharacters、overflowUsedCharacters、truncated、degradedCount、omittedCount 和 overflow

#### Scenario: Overflow 结构

- **WHEN** Detail Budget 被截断且 Overflow Budget 允许
- **THEN** meta.overflow 包含 id、ref、title、trust 和 score

#### Scenario: Score 语义

- **WHEN** MCP 返回 score
- **THEN** Tool description 说明 Score 仅能在当前 BM25 查询内比较

#### Scenario: Output Schema

- **WHEN** memory_search 返回预算 meta
- **THEN** structuredContent 通过 MCP output Schema 校验

### Requirement: MCP Search 文本回退

memory_search 的文本 fallback SHALL 同时渲染 Detail 和 Overflow，并放入安全 reference 围栏。

#### Scenario: Detail 文本

- **WHEN** 存在 Detail 结果
- **THEN** 文本包含 Ref、标题和 Summary/Preview

#### Scenario: Overflow 文本

- **WHEN** 存在 Overflow
- **THEN** 文本包含轻量 id/ref/title/trust/score，不包含正文或摘要

#### Scenario: 安全转义

- **WHEN** 标题或摘要包含围栏标记
- **THEN** 内容被转义，不能关闭或伪造外层 memory-context

### Requirement: MCP 不暴露 readReference

本版本 MCP Adapter SHALL 不注册通用 Ref Resolver。

#### Scenario: tools/list

- **WHEN** Client 调用 tools/list
- **THEN** 不包含 memory_reference_read 或其他通用 readReference 工具

#### Scenario: 正式记忆全文

- **WHEN** Client 需要读取 Search Ref 对应的正式记忆
- **THEN** 继续使用固定 Scope 的 memory_read

#### Scenario: Candidate 全文

- **WHEN** Full Profile Client 需要读取 Candidate
- **THEN** 继续使用受 candidate:read Capability 控制的 memory_candidate_read

### Requirement: MCP Recall 配置

memory-mcp.jsonc SHALL 支持 recall 配置节，并严格校验字段范围。

#### Scenario: 默认配置

- **WHEN** recall 配置缺失
- **THEN** 使用 maxCharacters=3000、maxOverflowItems=10、maxOverflowCharacters=1500

#### Scenario: 自定义配置

- **WHEN** 配置提供合法 recall 字段
- **THEN** memory_search 使用该 Detail 和 Overflow 预算

#### Scenario: 非法配置

- **WHEN** 任一 recall 字段超出范围或出现未知字段
- **THEN** MCP Server fail-fast，不以错误预算启动
