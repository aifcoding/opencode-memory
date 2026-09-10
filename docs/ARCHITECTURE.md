# opencode-memory 架构设计

给 opencode（AI 编码工具）用的本地持久记忆插件。三层记忆模型（长期知识 / 情景摘要 / 会话工作记忆），纯本地（SQLite + jieba-wasm），零外部服务。

## 设计目标

1. 跨会话持久记忆，分三层：长期知识 / 情景摘要 / 会话工作记忆
2. 中文友好的全文检索（jieba + FTS5）
3. 固定记忆每轮自动注入（可撤回、不污染历史）
4. 多用户各自独立使用（数据本地隔离）
5. 干净的扩展点（存储层接口化），为团队知识库预留多源检索方向

## 运行时约束

opencode 插件运行在其内嵌 Bun 运行时内（非系统 Node），因此：

- 可用 Bun 内建（如 `bun:sqlite`）及其 Node 兼容内建模块（如 `node:fs`/`node:crypto`）；第三方依赖须为纯 JS/WASM
- C++ 原生模块（`better-sqlite3`、`sqlite-vec`、`nodejieba`）不可用
- 中文分词用 jieba-wasm（纯 WASM）

## 决策记录

> 「规划中」为预留设计方向，当前版本尚未实现。

| # | 决策 | 选择 | 状态 |
|---|------|------|------|
| D1 | 存储引擎 | SQLite + `bun:sqlite`（内嵌 Bun 无 `node:sqlite`） | 已实现 |
| D2 | 检索 | FTS5(BM25) 文本检索；embedding 字段预留 | 部分（FTS 已实现，向量未实现） |
| D3 | 向量 | BLOB + 内联余弦 | 规划中 |
| D4 | 嵌入 | 默认关闭，`EmbeddingProvider` 接口 | 规划中 |
| D5 | 中文分词 | jieba-wasm 预分词写 FTS body | 已实现 |
| D6 | 上下文注入 | `messages.transform` 消息末尾注入（ephemeral） | 已实现 |
| D7 | 信任分级 | trust=high/low，入口决定 | 部分（MVP 统一 user/high） |
| D8 | Pin 策略 | 仅显式 pin；full/summary 双模式 + 按渲染长度配额、`BEGIN IMMEDIATE` 原子校验与更新 | 已实现 |
| D9 | 作用域 | scope + scope_key | 部分（MVP 仅 global） |
| D10 | 迁移 | 版本化顺序迁移；`BEGIN IMMEDIATE` 取写锁后单事务内完成校验/迁移/记录 | 已实现 |
| D11 | 更新策略 | 元数据专用 UPDATE；内容 CAS 乐观锁 | 已实现 |
| D12 | 一致性 | 主表 + FTS 同事务；WAL + busy_timeout + 写重试 | 已实现 |
| D13 | 召回语义 | 无匹配返回空；结果带 id+score | 已实现 |
| D14 | 多源检索缝 | 只读 `MemorySource[]` fan-out | 规划中 |
| D15 | 身份键 | project 用 `realpath`/安装 UUID | 规划中 |

**已实现的核心**：`bun:sqlite` 存储、jieba-wasm + FTS5 单通道检索、`messages.transform` 末尾注入、显式 pin + 配额、软删去重、CAS 乐观锁、WAL + 写重试、顺序迁移。

**规划中（数据模型已预留字段，代码未实现）**：向量检索/内联余弦、`EmbeddingProvider`、`TokenizerProvider`、多源 `MemorySource[]`、project 身份键隔离、严格信任分级。

## 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ 领域接口                                                      │
│   MemoryStore（存储层接口）                                   │
├──────────────────────────────────────────────────────────────┤
│ 基础设施实现                                                   │
│   SqliteMemoryStore (bun:sqlite)   tokenize (jieba-wasm)     │
│   migrations (版本化顺序)                                      │
├──────────────────────────────────────────────────────────────┤
│ opencode 集成层                                                │
│   plugin.ts：注册 tools / hooks                               │
│   overlay 注入 (messages.transform 末尾)                       │
│   compaction 归档 (session.compacted 事件 + SDK 读产物)        │
├──────────────────────────────────────────────────────────────┤
│ 对外接口：自定义工具 + 配置文件                                 │
└──────────────────────────────────────────────────────────────┘
```

依赖方向：集成层 → 基础设施 → 领域层。

### opencode 扩展点映射

| 功能 | opencode 机制 |
|---|---|
| 每轮注入固定记忆 | `experimental.chat.messages.transform`（仅主模型触发、output.messages 带 agent/sessionID） |
| 压缩时归档 | `session.compacted` 事件 + `client.session.messages` 读产物 |
| 主动读写工具 | plugin `tool: { ... }`（zod 定义参数） |
| 配置 | `opencode.json` → `plugin: [["@aifcoding/opencode-memory", {...}]]` |

## 数据模型

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

-- 长期记忆
CREATE TABLE memories (
  id            INTEGER PRIMARY KEY,
  scope         TEXT NOT NULL,              -- global|user|project|session
  scope_key     TEXT NOT NULL,              -- 规范化项目路径 / 用户标识 / session id
  origin        TEXT NOT NULL,              -- user|agent|compact（入口决定，调用者不可传）
  trust         TEXT NOT NULL DEFAULT 'low',-- D7：入口决定；默认 low
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',   -- pin_mode=summary 时注入用
  type          TEXT NOT NULL DEFAULT 'fact',
  tags          TEXT NOT NULL DEFAULT '[]',
  pinned_at     INTEGER,                    -- 显式 pin，无自动；仅 trust=high 可 pin
  pin_mode      TEXT NOT NULL DEFAULT 'summary', -- full|summary
  embedding     BLOB,                       -- 可空（未向量化）
  embed_model   TEXT,
  embed_dim     INTEGER,
  content_hash  TEXT NOT NULL,              -- 原始 content 的 SHA-256，用于同作用域精确去重
  revision      INTEGER NOT NULL DEFAULT 1, -- 乐观锁（CAS 更新）
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,                    -- 软删（存储层支持恢复，公开工具未暴露）
  CHECK(scope    IN ('global','user','project','session')),
  CHECK(origin   IN ('user','agent','compact')),
  CHECK(trust    IN ('high','low')),
  CHECK(pin_mode IN ('full','summary')),
  CHECK(pinned_at IS NULL OR trust = 'high'),
  CHECK(revision >= 1),
  CHECK(embed_dim IS NULL OR embed_dim > 0)
);
CREATE INDEX idx_mem_scope ON memories(scope, scope_key);
CREATE INDEX idx_mem_type  ON memories(type);
CREATE INDEX idx_mem_pin   ON memories(pinned_at) WHERE pinned_at IS NOT NULL;
CREATE INDEX idx_mem_hash  ON memories(content_hash);
CREATE UNIQUE INDEX idx_mem_dedup ON memories(scope, scope_key, content_hash) WHERE deleted_at IS NULL;
CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, body, tokenize='unicode61');

-- 会话级 KV
CREATE TABLE session_kv (
  session_key TEXT NOT NULL, kv_key TEXT NOT NULL, kv_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL, UNIQUE(session_key, kv_key)
);

-- 情景摘要（压缩自动归档）
CREATE TABLE session_summaries (
  id           TEXT PRIMARY KEY,           -- 压缩消息 id（幂等键）
  session_id   TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE VIRTUAL TABLE session_summaries_fts USING fts5(id UNINDEXED, body, tokenize='unicode61');

-- 数据库结构迁移版本
CREATE TABLE db_migrations (
  version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL
);
```

## 检索管线

```
query
 ├─ jieba 分词
 ├─ FTS5: OR MATCH + bm25 排序        → rank 列表
 └─ 输出: [id, score]（无匹配返回空）
```

- 无 query 或无匹配 → 返回空（绝不回退最新）
- 结果带 id + score，可继续 read/forget/pin（update 为存储层能力，公开工具未暴露）
- 中文检索用 jieba 预分词写 FTS body + unicode61
- 当前仅单通道 FTS5 文本检索；向量检索为规划中（数据模型已预留 embedding 字段）

## 写入与生命周期

```
写入口
 ├─ memory_store（长期记忆）
 ├─ compaction 归档（session.compacted 事件 → 情景记忆 session_summaries）
 └─ kv_set/kv_del（会话工作记忆，不进长期库）

读入口
 ├─ 每轮 overlay：固定记忆（full/summary，配额）注入消息末尾
 └─ memory_recall / recall_summaries：显式检索

更新/删除
 ├─ 元数据：专用 SQL 只 UPDATE 目标列（D11）
 ├─ 内容：CAS 乐观锁（WHERE id AND revision）
 └─ memory_forget：软删（deleted_at，删除后不参与检索）
```

## 安全设计

当前面向单用户本地环境。已实现的安全性质：

1. **参考块标记**：记忆以 reference 块注入，并提示模型视为参考数据；该标记是模型侧提示，不构成对提示注入的机制防护
2. **注入隔离**：固定记忆由 `memory_pin` 显式指定，非固定内容不自动注入
3. **无动态 SQL**：过滤用结构化参数，LLM 不接触 SQL 文本
4. **软删与去重**：删除为软删（不参与检索），`(scope, scope_key, content_hash)` 去重

边界（当前版本未实现，勿据此做安全承诺）：

- 信任分级为简化实现：工具写入统一标记 `origin=user`、`trust=high`，未做多来源分级与升级审批
- 未做 secret 检测（token/api key/.env）与日志脱敏
- 召回/固定的内容会进入模型上下文；若使用远程模型提供商，内容可能随请求发送给该提供商

## 测试现状

已自动覆盖（`bun test`）：

- 存储：CRUD、软删去重、FTS 同步、元数据更新不清 embedding、CAS 冲突、归档幂等
- 检索：中文召回（2 字词/标识符）、无匹配返空、scope 过滤、排序
- plugin：store/recall 往返、软删拒绝、pin 配额、重新 pin 不重复计算、compaction event 提取与幂等归档

尚未自动覆盖：并发迁移/写入、overlay 消息结构、真实 OpenCode compaction 端到端、配置错误分支（部分运行时链路曾通过 spike 手动验证）。
