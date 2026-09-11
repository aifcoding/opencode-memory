# opencode-memory 架构设计

本地优先的通用 AI 记忆内核，以及基于它的 OpenCode 适配器。三层记忆模型（长期知识 / 情景摘要 / 会话工作记忆），纯本地（SQLite + jieba-wasm），零外部服务。

## 设计目标

1. 跨会话持久记忆，分三层：长期知识 / 情景摘要 / 会话工作记忆
2. 中文友好的全文检索（jieba + FTS5）
3. 固定记忆每轮自动注入（可撤回、不污染历史）
4. 多用户各自独立使用（数据本地隔离）
5. 干净的扩展点（存储层接口化），为团队知识库预留多源检索方向

## 运行时约束

运行时边界分为四类：

- **Core 根入口**：不加载 `bun:sqlite`，只提供框架无关 API。
- **SQLite 子路径**：`@aifcoding/memory-core/sqlite` 使用 `bun:sqlite`，要求 Bun；第三方依赖须为纯 JS/WASM。
- **OpenCode Adapter**：运行于 OpenCode 内嵌 Bun（非系统 Node），不可使用 C++ 原生模块（如 `better-sqlite3`、`sqlite-vec`、`nodejieba`）。
- **自定义 MemoryStore**：由宿主决定运行时和存储实现，Core 只依赖 `MemoryStore` 端口。

## 决策记录

> 「规划中」为预留设计方向，当前版本尚未实现。

| # | 决策 | 选择 | 状态 |
|---|------|------|------|
| D1 | 存储引擎 | SQLite + `bun:sqlite`（内嵌 Bun 无 `node:sqlite`） | 已实现 |
| D2 | 检索 | FTS5(BM25) 文本检索；embedding 字段预留 | 部分（FTS 已实现，向量未实现） |
| D3 | 向量 | BLOB + 内联余弦 | 规划中 |
| D4 | 嵌入 | 默认关闭，`EmbeddingProvider` 接口 | 规划中 |
| D5 | 分词 | 单方法 `Tokenizer` 接口；默认 jieba-wasm；写入和查询共用同一实例 | 已实现 |
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

**Core 已实现**：MemoryManager、MemoryStore 端口、Tokenizer 注入、SQLite/FTS5 存储与检索、显式 pin + 配额、软删去重、CAS 乐观锁、WAL + 写重试、顺序迁移。

**OpenCode Adapter 已实现**：`messages.transform` 末尾注入、12 个工具和 `session.compacted` 摘要归档。

**规划中（数据模型已预留字段，代码未实现）**：向量检索/内联余弦、`EmbeddingProvider`、Tokenizer 身份持久化和兼容检测、多源 `MemorySource[]`、project 身份键隔离、严格信任分级，以及 MCP、CLI 等新的 Core 适配器。自动索引重建尚未决定；当前已实现单方法 `Tokenizer` 注入，默认实现为 jieba-wasm。

## 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ Core：@aifcoding/memory-core                                  │
│ domain（类型/结果）                                           │
│ application（MemoryManager 高层领域入口）                     │
│ ports（MemoryStore 端口）                                     │
│ retrieval / render（检索与通用 Pin 文本渲染）                  │
│ sqlite（bun:sqlite 实现，独立 /sqlite 导出）                   │
├──────────────────────────────────────────────────────────────┤
│ Adapter：@aifcoding/opencode-memory                           │
│ plugin.ts：配置、12 个工具、overlay、compaction 事件           │
└──────────────────────────────────────────────────────────────┘
```

依赖方向：OpenCode Adapter → Core；Core 不依赖 OpenCode。`MemoryManager` 负责默认作用域、输入校验、删除状态、Pin 配额和结构化结果；`MemoryStore` 只负责持久化原语、检索和事务一致性。

Core 根入口不加载 `bun:sqlite`；需要 SQLite 时使用 `@aifcoding/memory-core/sqlite`。该子路径仍要求 Bun。

### Monorepo 包结构

```text
packages/core/
├── src/domain       # 领域类型与结构化结果
├── src/application  # MemoryManager
├── src/ports        # MemoryStore 存储端口
├── src/retrieval    # Tokenizer 接口与默认 jieba 实现
├── src/render       # Pin 文本渲染
└── src/sqlite       # SQLite 实现与迁移

packages/opencode/
└── src/plugin.ts    # OpenCode 配置、工具与事件适配
```

`MemoryManager` 是 Core 的统一高层入口，所有公共方法使用对象参数并返回 Promise；Adapter 负责把结构化结果转换为 OpenCode 工具文案和消息结构。

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
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,              -- global|user|project|session
  scope_key     TEXT NOT NULL,              -- 规范化项目路径 / 用户标识 / session id
  origin        TEXT NOT NULL,              -- user|agent|compact（OpenCode 工具调用者不可传；可信 Core SDK 可传，Adapter 负责入口信任策略）
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
- 分词器可插件化：`Tokenizer` 接口（默认 jieba-wasm），可在 `createSqliteMemoryManager` 注入自定义实现（英文词干/停用词等）；更换分词器需新建库
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

- 信任分级为简化实现：工具写入统一标记 `origin=user`、`trust=high`；Core 已支持 `trust=low` 且低信任内容固定时返回 `trust_denied`，但未做多来源分级与升级审批
- 未做 secret 检测（token/api key/.env）与日志脱敏
- 召回/固定的内容会进入模型上下文；若使用远程模型提供商，内容可能随请求发送给该提供商

## 测试现状

已自动覆盖（`bun test`，36 个测试）：

- 存储：CRUD、软删去重、FTS 同步、元数据更新不清 embedding、CAS 冲突、归档幂等
- 检索：中文召回（2 字词/标识符）、无匹配返空、scope 过滤、排序
- MemoryManager：默认 scope、输入校验、Pin 状态（含 trust_denied）、摘要归档、contextKey KV
- 依赖边界：Core 不依赖 opencode、adapter 单向依赖 core
- 可插件分词器：自定义 tokenizer 的写入/查询一致性
- opencode adapter：store/recall 往返、软删拒绝、pin 配额、compaction event 提取与幂等归档

尚未自动覆盖：并发迁移/写入、overlay 消息结构、真实 OpenCode compaction 端到端、配置错误分支（部分运行时链路曾通过 spike 手动验证）。
