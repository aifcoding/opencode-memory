## ADDED Requirements

### Requirement: 按 ID 读取情景摘要

MemoryStore SHALL 提供可选的 `getSummary(id)` 能力；SQLite 实现 SHALL 使用 session_summaries 主键读取摘要。

#### Scenario: 摘要存在

- **WHEN** getSummary 使用已归档的 Summary ID
- **THEN** 返回 id、contextKey、text 和 createdAt

#### Scenario: 摘要不存在

- **WHEN** getSummary 使用未知 ID
- **THEN** 返回 null

### Requirement: Memory Ref 零迁移

Memory Ref SHALL 由实体类型和现有 ID 计算，不新增数据库字段、索引或迁移版本。

#### Scenario: 升级读路径

- **WHEN** 现有数据库升级到本版本
- **THEN** 不执行新的 Schema 迁移，现有 memories、summaries、candidates、capture runs、KV 和 FTS 数据保持不变

#### Scenario: 数据库重开

- **WHEN** 关闭并重新打开同一数据库
- **THEN** 相同实体 ID 生成相同 Ref

### Requirement: Summary Ref 当前无 Scope 授权

session_summaries 当前没有 scope/scope_key；Core SHALL NOT 将 ReadReferenceInput.scope 解释为 Summary 的授权边界。

#### Scenario: 读取 Summary Ref

- **WHEN** Core 按 Summary Ref 读取摘要
- **THEN** 按全局唯一 Summary ID 返回，并包含 contextKey

#### Scenario: Adapter 授权

- **WHEN** Adapter 接收 Summary Ref
- **THEN** Adapter 根据自身上下文和权限决定是否展示

#### Scenario: MCP 不暴露通用 Resolver

- **WHEN** MCP Adapter 注册工具
- **THEN** 不注册通用 readReference，避免通过 Summary Ref 绕过固定 project Scope
