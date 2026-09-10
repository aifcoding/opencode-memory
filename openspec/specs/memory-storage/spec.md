# memory-storage Specification

## Purpose
定义长期记忆与会话 KV 的持久化、作用域隔离、软删除、去重、并发更新和数据库迁移行为。

## Requirements

### Requirement: 记忆条目 CRUD

系统 SHALL 支持创建、按 id 读取、更新、软删除记忆条目，字段覆盖 `ARCHITECTURE.md` 数据模型（origin/trust/scope/scope_key/type/content/summary/pin_mode/embedding/embed_model/embed_dim/content_hash/revision/created_at/updated_at/deleted_at）。

#### Scenario: 创建条目
- **WHEN** 调用 create 且 content/scope/scope_key 合法
- **THEN** 返回自增 id，且 content_hash 自动计算、revision=1、CHECK 约束校验通过

#### Scenario: 元数据更新不覆盖 embedding
- **WHEN** 仅更新 pinned_at/pin_mode/summary 等元数据字段
- **THEN** embedding 与 content 保持原值不变（专用 UPDATE，不整行覆盖）

#### Scenario: 非法枚举拒绝
- **WHEN** origin/trust/scope/pin_mode 传非法值
- **THEN** CHECK 约束拒绝写入并报错

### Requirement: 作用域隔离

条目 SHALL 支持按 `(scope, scope_key)` 隔离查询；不提供 scope 过滤时执行跨作用域查询。

#### Scenario: 按 scope 过滤
- **WHEN** 以 scope=project + scope_key=/path 查询
- **THEN** 仅返回该 scope 下条目，不返回其他 project/global 条目

### Requirement: 软删与去重

条目删除 SHALL 为软删（置 deleted_at）；`(scope, scope_key, content_hash)` 在未删除状态下 SHALL 唯一。

#### Scenario: 软删排除检索
- **WHEN** 删除条目
- **THEN** 置 deleted_at 而非物理删除，检索与列表默认排除

#### Scenario: 去重唯一约束
- **WHEN** 同 scope 下写入 content_hash 相同的未删除条目
- **THEN** 唯一索引冲突，返回已有 id 或明确错误

### Requirement: 事务化 FTS 同步

主表写入与 FTS 索引更新 SHALL 在同一事务内，写入失败不产生主表/FTS 不一致。

#### Scenario: 原子写入
- **WHEN** 创建/更新条目
- **THEN** 主表行与 FTS 行在同事务提交，任一步失败整体回滚

### Requirement: 会话 KV

系统 SHALL 提供 session 级键值存储，`(session_key, kv_key)` 唯一，仅当前会话可见。

#### Scenario: upsert 与清理
- **WHEN** kv_set 同 key 重复写入
- **THEN** 覆盖旧值；kv_del 删除；按 session 列出全部键值

### Requirement: 乐观锁 CAS 更新

内容更新 SHALL 使用 `WHERE id=? AND revision=?` 的 CAS，冲突不静默覆盖。

#### Scenario: 并发冲突
- **WHEN** 两个写入者基于同一 revision 更新同一条目
- **THEN** 后提交者 affected rows=0，返回 conflict，不覆盖先提交者的内容

### Requirement: 版本化迁移

数据库结构变更 SHALL 走顺序迁移（`db_migrations`），每步事务 + 前置版本校验，失败即停且可诊断。

#### Scenario: 顺序升级
- **WHEN** 从旧版本启动
- **THEN** 依次执行未应用的迁移，版本号递增；任一迁移失败则中止并报错
