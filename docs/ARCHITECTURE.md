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

## 安全辅助记忆提取

Capture 将「模型提取」和「正式记忆写入」分开：

```
OpenCode 会话
  → compaction 或显式 memory_capture
  → 读取会话消息
  → 过滤工具调用、工具结果、Pin overlay 和历史记忆块
  → 创建全新的空 Session（不是 fork，fork 会继承未过滤历史导致递归污染）
  → 调用配置的提取 Agent
  → 严格 JSON Schema 校验
  → Core 执行凭据、bidi 和不可见 Unicode 扫描
  → 保存 pending / agent / low 候选
  → 用户 approve 或 reject
  → approve 后事务化写入正式 memory 和 FTS
```

Capture 默认关闭，启用后会增加模型调用成本，并将过滤后的会话文本发送给配置的 Agent。

### 职责边界

| 层 | 职责 |
|---|---|
| OpenCode Adapter | 读取和过滤消息、创建空 Session、调用提取 Agent、严格解析 JSON |
| MemoryManager | 默认 Scope、Capture API、结构化结果 |
| SqliteMemoryStore | 幂等 Lease、候选持久化、安全扫描、审批事务 |
| 用户 | 批准或拒绝候选，决定是否进一步 Pin |

### 候选状态机

```
pending → approve → approved（创建或关联正式 memory）
pending → reject  → rejected
```

approved/rejected 候选再次审批返回 already_reviewed。候选固定 origin=agent + trust=low；批准后创建 origin=agent + trust=high 的正式 memory，不自动 Pin。

### 防递归污染

提取输入只保留可确认来源的用户和助手自然语言文本，排除 tool call/result、非文本 Part、Pin overlay 及 msg_mem_/prt_mem_ marker、memory_recall/read/recall_summaries/候选工具结果、memory-context/mem_block 参考块、提取 Agent 自身输出。过滤优先依赖消息角色、Part 类型、synthetic 标记和插件 marker。

### 安全扫描

候选写入前和批准前都执行确定性扫描：高置信凭据、私钥标记、Bearer/JWT/云访问键、Cookie/Token/API Key 键值、双向控制字符、高风险不可见 Unicode。命中候选不持久化，只记录风险代码和数量，不记原文。扫描不构成 Prompt Injection 完整防护，最终安全门是用户审批。

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
│ Adapters                                                     │
│ ├─ @aifcoding/opencode-memory：tools / overlay / compaction   │
│ └─ @aifcoding/memory-mcp：stdio / profiles / MCP tools        │
└──────────────────────────────────────────────────────────────┘
```

依赖方向：`opencode → core`、`mcp → core`，均单向；Core 不依赖 OpenCode 或 MCP SDK。`MemoryManager` 负责默认作用域、输入校验、删除状态、Pin 配额和结构化结果；`MemoryStore` 只负责持久化原语、检索和事务一致性。

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

packages/mcp/
├── src/server.ts    # MCP Server + 声明式工具注册
├── src/tools/       # 工具定义（read / write / pins / candidates）
├── src/config.ts    # JSONC 配置
├── src/cli.ts       # memory-mcp 可执行入口
└── src/render/      # 结果围栏与转义
```

`MemoryManager` 是 Core 的统一高层入口，所有公共方法使用对象参数并返回 Promise；Adapter 负责把结构化结果转换为 OpenCode 工具文案和消息结构。

### opencode 扩展点映射

| 功能 | opencode 机制 |
|---|---|
| 每轮注入固定记忆 | `experimental.chat.messages.transform`（仅主模型触发、output.messages 带 agent/sessionID） |
| 压缩时归档 | `session.compacted` 事件 + `client.session.messages` 读产物 |
| 主动读写工具 | plugin `tool: { ... }`（zod 定义参数） |
| 配置 | `opencode.json` → `plugin: [["@aifcoding/opencode-memory", {...}]]` |

## MCP Adapter

`@aifcoding/memory-mcp` 是 `@aifcoding/memory-core` 的第二个 Adapter，用标准 MCP 协议向外部 Agent 暴露记忆能力。

```text
MCP Client
  → @aifcoding/memory-mcp
  → MemoryManager
  → MemoryStore
  → SqliteMemoryStore
```

依赖方向为 `mcp → core`。Core 不导入 MCP SDK、MCP Tool 或 Transport 类型；MCP Handler 只调用 MemoryManager，不直接执行 SQL。

### SDK 与传输

首版使用 `@modelcontextprotocol/server@2.0.0` + `StdioServerTransport`。选择官方 SDK 是为了复用 MCP initialize 与版本协商、`tools/list`、`tools/call`、Tool 输入/输出 Schema、structuredContent、stdio 消息分帧和 Tool annotations。

首版只实现 stdio。Streamable HTTP、Legacy SSE、认证和远程 RBAC 不在当前范围。stdio 模式下 stdout 只能承载 MCP 协议消息；日志和启动错误必须写入 stderr。

### 声明式工具注册

每个工具通过 `MemoryMcpToolDefinition` 描述（name / title / description / inputSchema / outputSchema / requiredCapabilities / annotations / execute）。所有定义进入统一 Registry，Server 启动时根据 capability 过滤后再调用 `registerTool`：

```text
ToolDefinitions → requiredCapabilities → Profile capabilities → registerAllowed → McpServer.registerTool
```

未授权工具不会出现在 `tools/list`，而不是等到调用时再返回权限错误。首版使用统一的成功/错误 envelope output Schema；未来可逐步为每个 Tool 收紧独立 output Schema，不改变 Registry 结构。

### Profile 与 Capability

六个 capability：`memory:read` / `memory:write` / `pin:read` / `pin:write` / `candidate:read` / `candidate:review`。

| Profile | Capability |
|---|---|
| `readonly` | `memory:read` |
| `full` | `memory:read`、`memory:write`、`pin:read`、`pin:write`、`candidate:read`、`candidate:review` |

`candidate:review` 还受独立配置控制（`profile=full` 且 `allowCandidateReview=true`）。Profile 在 Server 启动时固定，MCP 客户端不能通过工具参数切换权限；不同信任等级的客户端应启动不同 MCP 进程。

### 固定 Scope

Scope 是 MCP Adapter 的核心安全边界：一个 MCP Server 进程绑定一个固定 project Scope，所有 Handler 使用同一 Scope。

```jsonc
{ "scope": { "scope": "project", "scopeKey": "/absolute/project" } }
```

工具输入不接受 `scope`、`scopeKey`、`dbPath`、`projectRoot`；每个 Handler 在调用 Manager 时注入 Server Scope。因此外部 Agent 不能通过输入参数枚举其他项目；ID 属于其他 Scope 时返回 `not_found`。

首版不实现 D15 的自动项目身份，`scopeKey` 由配置显式提供。当前 OpenCode Adapter 仍可能写入 `global/default`；MCP project Scope 不会自动读取或迁移这些记录；两个 Adapter 要共享记忆必须使用相同 Scope。

### 工具与权限

| 工具 | readonly | full | 说明 |
|---|---:|---:|---|
| `memory_search` | ✓ | ✓ | 搜索正式记忆，返回预览 |
| `memory_read` | ✓ | ✓ | 读取完整正式记忆 |
| `memory_list` | ✓ | ✓ | 列出正式记忆元数据 |
| `memory_store` | — | ✓ | 固定 Scope、`origin=agent` |
| `memory_forget` | — | ✓ | 软删除 |
| `memory_pin` | — | ✓ | 固定高信任记忆 |
| `memory_unpin` | — | ✓ | 取消固定 |
| `memory_pins` | — | ✓ | 列出固定记忆元数据 |
| `memory_candidate_list` | — | ✓ | 列出候选元数据和预览 |
| `memory_candidate_read` | — | ✓ | 读取候选 |
| `memory_candidate_review` | — | 条件启用 | 还要求 `allowCandidateReview=true` |

MCP Server 不暴露 `memory_capture`：候选提取需要宿主会话和模型调用能力，而通用 MCP Server 没有可假设的会话历史。

### readonly 边界与写入策略

readonly 是 MCP 工具权限（不注册写入/删除/Pin/审批工具），**不是 SQLite 文件级只读**：创建 SqliteMemoryStore 时仍可能检查或执行兼容迁移、创建 WAL/SHM 文件。

`memory_store` 的客户端参数不包括 scope/origin/trust/embedding/pinnedAt；Server 强制 `scope=固定 Server Scope`、`origin=agent`、`trust=writeTrust`（默认 `low`）。默认低信任写入不能 Pin。

### 结果协议与数据库兼容

成功结果返回 `{ schemaVersion, kind, notice, scope, data }`；错误返回 `{ schemaVersion, ok:false, error:{code,message,retryable} }`。文本 fallback 统一包 `<memory-context source="mcp">` 并转义，正文不能伪造关闭标记。

OpenCode Adapter 和 MCP Adapter 可指向同一个 SQLite 文件，但必须使用 Schema 兼容的 Core 版本；数据库版本过新时 fail-fast。MCP Host 配置建议固定 package 版本。

### D-MCP 决策摘要

| 决策 | 选择 | 理由 |
|---|---|---|
| SDK | 官方 MCP Server SDK v2 | 避免自行实现协议 |
| 首版传输 | stdio | 本地、零端口、无需认证 |
| 默认 Profile | readonly | 外部 Agent 默认不应修改记忆 |
| 权限模型 | Profile → capability → Tool Registry | 未授权工具不注册 |
| Scope | Server 固定 project Scope | 防止客户端跨项目枚举 |
| 写入来源/信任 | `origin=agent` / 默认 `low` | 保留来源语义、安全默认值 |
| Candidate Review | 独立显式开关 | 审批是高权限操作 |
| 输出 | structuredContent + 文本围栏 | 兼容不同 MCP Client |
| HTTP/SSE | 暂不实现 | 避免提前引入认证和远程攻击面 |

## 记忆读路径

读路径采用「分层投影 + 两阶段预算 + 稳定 Ref」：

```text
query → Tokenizer → FTS5 OR MATCH → BM25 score 排序
  → L0/L1/L2 Projection → Detail Budget → Overflow Budget → Adapter
```

### L0/L1/L2

现有字段直接对应：

| 层级 | Projection | 字段 |
|---|---|---|
| L0 | `title` | `title` |
| L1 | `summary` | `title + summary` |
| L2 | `full` | `title + content` |

`recallMemories` 默认使用 `summary`；只有显式 `projection=full` 或后续 `readMemory/readReference` 才返回完整正文。Summary 为空时使用正文前 200 个 UTF-16 code unit 作为 `content_preview`，不修改数据库、不调用模型。

### 两阶段预算

第一阶段按 BM25 score 降序生成 Detail 连续前缀：`≤ maxCharacters` 加入；`> maxCharacters` 时 full 可尝试降级 summary；仍放不下 → 停止 Detail、进入 Overflow。

第二阶段将剩余候选降级为 L0（id + ref + title + trust + score），同时受 `maxOverflowItems` 和 `maxOverflowCharacters` 限制。两个阶段都保持连续 score 前缀，不跳过高分大条目去填充低分小条目。

### 结果元数据

`consideredCount / usedCharacters / overflowUsedCharacters / truncated / degradedCount / omittedCount`。语义：consideredCount = Store 本次按 limit 取回的候选数；truncated = 至少一条未按 Detail 返回；degradedCount = Full 降级 Summary 数量；omittedCount = Detail 和 Overflow 均未返回的数量；limit 不算预算截断。恒等关系 `consideredCount === memories.length + overflow.length + omittedCount`。

字符数按 JS `string.length`（UTF-16 code unit）计算，不等于模型 Token。Core 预算不含 Adapter 围栏/JSON/协议开销。

### Stable Memory Ref

`memory://local/memories/{id}` / `summaries/{encoded-id}` / `candidates/{id}`。Ref 是运行时计算值、不存库 → 本升级零迁移。只保证同一数据库内稳定。

### readReference

Core 提供 `readReference({ref, scope})`：Memory/Candidate 执行 Scope 校验；Summary 当前无 Scope、仅按全局唯一 ID 读取；Store 不支持 → `unsupported`；软删 Memory → `deleted`。由于 Summary 无 Scope，MCP 不暴露通用 `readReference`，避免绕过固定 project Scope 和 Candidate Capability。

### Adapter 策略

- OpenCode：`memory_recall` → 固定 Summary Projection；`memory_read` → Full
- MCP：`memory_search` → Summary Projection + Budget Meta；`memory_read` → Full

两个 Adapter 均允许单次 `maxCharacters` 覆盖，但不向模型暴露 Projection 和 Overflow 配置。

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
