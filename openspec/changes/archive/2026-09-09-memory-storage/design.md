## Context

S0 实测结论（详见 `spike/FINDINGS.md`）：存储驱动 `bun:sqlite`，SQLite 3.43.2，含 `OMIT_LOAD_EXTENSION`（无 sqlite-vec）、FTS5/bm25 可用、默认 `busy_timeout=0`（并发写 `database is locked`）、`project.id` 非 git 目录恒 "global"。本变更只做数据层，动机见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 交付可测试、可迁移、事务安全的持久化存储层（memories + session_kv）
- 保证存储层正确性与一致性：元数据更新不清 embedding、主表/FTS 同事务、迁移有序、并发安全

**Non-Goals:**
- 不做检索（FTS 查询仅保证索引同步，不实现 recall）、不做注入/overlay、不做嵌入/向量、不做 schema 类型系统（`mem_schemas` 留待后续）、不做 HTTP API

## Decisions

**D-S1.1 分层：领域接口 + bun:sqlite 实现**
- `MemoryStore` 接口（领域层，不 import 具体驱动）；`SqliteMemoryStore` 用 `bun:sqlite`
- 未来换驱动/换存储只需替换实现，不碰上层

**D-S1.2 连接与并发**
- 单连接复用；每个连接显式 `PRAGMA journal_mode=WAL` + `PRAGMA busy_timeout=5000`
- 写重试：仅对 `SQLITE_BUSY/LOCKED`，有界退避 + jitter，支持取消；写操作幂等或明确事务边界
- 短事务优先，写用 `BEGIN IMMEDIATE`

**D-S1.3 迁移（D10）**
- `db_migrations(version, applied_at)` 顺序迁移；每步事务 + 前置版本校验，失败即停、抛错可诊断，**禁静默 catch**

**D-S1.4 主表 + FTS 同事务（D12）**
- 每次写入：主表 UPSERT/UPDATE 与 FTS DELETE+INSERT 在同一事务；body = jieba 分词后空格连接（本变更先留 tokenizer 桩，jieba 接入在 S2）

**D-S1.5 元数据专用 UPDATE（D11）**
- 更新接口按意图分方法：`updateMeta`（只改 pinned_at/pin_mode/summary/description 等，不碰 content/embedding）、`updateContent`（改 content 并重算 hash/embedding、revision+1）
- 禁止用不完整实体整行覆盖

**D-S1.6 乐观锁（revision）**
- `updateContent` 走 `WHERE id=? AND revision=?`，affected rows=0 → 返回 conflict

**D-S1.7 能力自检**
- 启动时检测：`bun:sqlite` 可用、SQLite 版本、FTS5 存在、`PRAGMA compile_options`；缺 FTS5 等关键能力 fail-fast

**D-S1.8 测试**
- `bun:test`；覆盖 CRUD、软删/去重、FTS 原子性、元数据更新不清 embedding、CAS 冲突、迁移顺序升级、并发写

## Risks / Trade-offs

- [bun:sqlite 无 `loadExtension`] → 向量走 BLOB+内联余弦（D3），本变更不涉及
- [SQLite 锁在单连接内不存在，多连接才需 busy_timeout] → 仍统一设置，S3 多写入者（agent+归档+KV）时才真正触发；先建好策略
- [FTS5 body 分词在 S2 才接入 jieba] → 本变更 tokenizer 用桩（先按空格/原始文本），索引同步逻辑先跑通，S2 换 jieba 不动表结构
- [opencode 内嵌 Bun 升级导致 API 变化] → 能力自检 + 版本记录，fail-fast

## Migration Plan

- 全新项目，`db_migrations` 从 v1 起步；后续每次表结构变更新增迁移文件
- 回滚：迁移为 append-only，不提供自动回滚，靠备份 + 新增向前修复迁移

## Open Questions

- 无（S0 已消除关键未知；检索层检索的 FTS 查询语义留待 S2）
