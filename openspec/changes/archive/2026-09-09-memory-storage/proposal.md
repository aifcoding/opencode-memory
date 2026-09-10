## Why

S0 spike 已实测定案：存储驱动为 `bun:sqlite`（node:sqlite 不可用），并确认了 WAL/FTS5/bm25/事务能力与 `OMIT_LOAD_EXTENSION`、`busy_timeout=0` 等约束。现在需要把记忆系统的持久化地基实现出来——没有存储层，检索（S2）、注入（S3）都无从谈起。这是 S1 最小范围：只做数据层，不做检索/注入/嵌入。

## What Changes

- 新建仓库脚手架（npm 包结构 + 领域接口定义）
- 实现 `SqliteMemoryStore`（基于 `bun:sqlite`）：
  - `memories` 表 CRUD + 元数据专用 UPDATE（不覆盖 embedding/content）
  - `session_kv` 表（会话级 KV）
  - 软删（`deleted_at`）与去重唯一索引
  - 主表 + FTS 同事务同步
  - 乐观锁 CAS 更新（`revision`）
  - 版本化顺序迁移（`db_migrations`，禁静默 catch）
- 显式 `PRAGMA busy_timeout` + 写重试；WAL 启用
- 存储/迁移/并发单元测试（bun test）

## Capabilities

### New Capabilities
- `memory-storage`: 持久化记忆存储——memories CRUD、软删、去重、事务 FTS、乐观锁、会话 KV、版本化迁移

### Modified Capabilities
（无）

## Impact

- **代码**：新建 `src/storage/`（领域接口 + bun:sqlite 实现 + migrations）、`src/kv/`、测试目录
- **依赖**：无新增 npm 依赖（`bun:sqlite` 为内嵌模块；测试用 `bun:test`）
- **运行时约束**：仅支持 opencode 内嵌 Bun（≥1.3.14）；启动时做能力自检（FTS5/busy_timeout 等），不满足 fail-fast
- **兼容**：不触碰现有 spike/、docs/、openspec/ 结构
