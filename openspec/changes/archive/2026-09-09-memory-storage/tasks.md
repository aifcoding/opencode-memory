## 1. 仓库脚手架

- [ ] 1.1 建 npm 包结构（package.json + tsconfig + src/ 目录），验证 `bun test` 可运行一个空用例
- [ ] 1.2 定义领域接口 `MemoryStore`（CRUD/updateMeta/updateContent/scope 查询/软删/kv）与 `MemoryEntry` 类型，验证类型可编译

## 2. 存储实现（bun:sqlite）

- [ ] 2.1 实现 `SqliteMemoryStore` 建表（memories + session_kv + memories_fts + db_migrations，含 CHECK 约束与去重唯一索引），验证建表成功
- [ ] 2.2 实现 create（自动 content_hash、revision=1），验证插入返回 id 且 hash 正确
- [ ] 2.3 实现 updateMeta 专用 UPDATE，验证只改目标列、embedding/content 不变
- [ ] 2.4 实现 updateContent（CAS `WHERE id AND revision`，content 变更 revision+1），验证 conflict 返回正确
- [ ] 2.5 实现软删 + 恢复 + 去重唯一约束，验证重复写入返回已有 id 或明确错误
- [ ] 2.6 实现 scope 隔离查询（按 scope+scope_key 过滤），验证不跨 scope
- [ ] 2.7 实现 session_kv（upsert/delete/list），验证唯一性与隔离

## 3. 事务与并发

- [ ] 3.1 主表 + FTS 同事务同步（写入时 DELETE+INSERT FTS 与主表同事务），验证模拟 FTS 失败时整体回滚
- [ ] 3.2 连接配置：WAL + busy_timeout=5000 + 写重试（仅 BUSY/LOCKED），验证双连接并发写不报 `database is locked`

## 4. 迁移

- [ ] 4.1 实现 `db_migrations` 顺序迁移框架（事务 + 前置版本校验 + 失败即停），验证从 v1 顺序升级
- [ ] 4.2 写首个迁移 v1（建全量表结构），验证迁移幂等

## 5. 能力自检与测试

- [ ] 5.1 启动自检：bun:sqlite/SQLite 版本/FTS5/compile_options，缺 FTS5 时 fail-fast，验证正常与异常两分支
- [ ] 5.2 补齐单元测试（CRUD/软删去重/FTS 原子性/元数据不清 embedding/CAS 冲突/迁移/并发），`bun test` 全绿

## 6. 收尾

- [ ] 6.1 `openspec validate --changes` 通过，回填设计偏差（若有）到 design.md
- [ ] 6.2 归档本变更（`/opsx-archive`）
