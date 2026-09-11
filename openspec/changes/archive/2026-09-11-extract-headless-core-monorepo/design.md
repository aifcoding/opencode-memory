## Context

当前插件在 `plugin.ts` 中同时包含 OpenCode 工具注册、配置解析、部分领域判断、Pin 处理、overlay 注入和 compaction 归档；SQLite 存储、分词与迁移位于 `src/storage`。

存储实现已经基本框架无关，但外部调用者只能使用底层 `MemoryStore`，缺少稳定的应用级入口。若直接增加 MCP 和 CLI，它们将重复实现摘要校验、删除状态、Pin 配额、结果状态和默认作用域等规则。

本变更建立 `MemoryManager` 作为统一领域入口，并将 OpenCode 变成第一个 Adapter。

## Goals / Non-Goals

**Goals:**

- 提供框架无关的高层记忆 API。
- 建立 Core ← Adapter 的单向依赖。
- 保持现有 OpenCode 用户和数据库兼容。
- 让未来 MCP、CLI 共用同一业务实现。
- 输出 npm 类型声明和稳定公共入口。
- 保持设计克制，不引入当前没有第二实现的抽象体系。

**Non-Goals:**

- 不实现 MCP、CLI、向量检索和 TeamKbSource。
- 不修改数据库 Schema。
- 不将 OpenCode Hook 抽象成通用事件框架。
- 不实现自动 session 身份推断。
- 不解决所有 JavaScript 运行时的 SQLite 兼容性。

## Decisions

### D-H.1 使用 Bun Workspaces Monorepo

仓库 SHALL 包含 `packages/core`（`@aifcoding/memory-core`）和 `packages/opencode`（`@aifcoding/opencode-memory`）。MCP 和 CLI 后续通过独立 change 增加，不在本变更创建空功能包。选择 monorepo 是为了保留 Git 历史、Stars、Release 和现有 npm 包，并允许 Core 与 Adapter 在同一变更中联调。

### D-H.2 `MemoryManager` 是高层公共入口

`MemoryManager` SHALL 收敛：长期知识创建/召回/列表/读取/软删除、Pin/Unpin/固定列表/固定上下文渲染、情景摘要归档/检索、上下文 KV 设置/读取/列表/删除、资源释放。Adapter SHALL NOT 直接调用 `SqliteMemoryStore` 实现业务流程。

### D-H.3 `MemoryStore` 保持存储端口定位

`MemoryStore` 负责持久化原语、原子 Pin、检索和事务一致性。`MemoryManager` 负责默认作用域、输入验证、默认 origin/trust、删除状态解释、summary 模式校验、结构化结果。不新增 Repository、Command Bus 或依赖注入容器。

### D-H.4 公共 API 返回结构化结果

Core SHALL NOT 返回中文或 OpenCode 专属文案。Pin 使用判别联合（pinned/quota_exceeded/summary_required/trust_denied/not_found/deleted）；归档返回 inserted/duplicate。OpenCode Adapter 负责格式化为工具输出。

### D-H.5 高层 API 使用 Promise

`MemoryManager` 公共方法 SHALL 返回 Promise。当前 SQLite 实现可同步完成内部操作，但异步公共签名为未来 MCP、远程 Store 和其他运行时保留兼容性。

### D-H.6 Scope 与 Context 分离

长期知识使用 `{ scope, scopeKey }`；上下文 KV 使用 `contextKey`。Core SHALL NOT 推断 contextKey。OpenCode Adapter 使用 `ToolContext.sessionID`；未来 MCP 和 CLI 由各自协议或配置提供。

### D-H.7 配置来源属于 Adapter

Core 只接收已解析的 store/defaultScope/pinQuota/defaultOrigin/defaultTrust。OpenCode Adapter 继续负责 JSON/JSONC、XDG 路径和插件 options 优先级。Core SHALL NOT 读取 OpenCode 配置文件或环境目录。

### D-H.8 SQLite 使用子路径导出

根入口 `@aifcoding/memory-core` SHALL 不加载 `bun:sqlite`。SQLite 实现通过 `@aifcoding/memory-core/sqlite` 导出。当前默认 SQLite 实现仍要求 Bun（实现的是框架可移植，不是运行时可移植）。

### D-H.9 Core 负责通用 Pin 文本，不负责消息注入

Core 的 `getPinnedContext` 返回 entries/text/size。OpenCode Adapter 将 text 转换为 OpenCode 消息结构并执行 ephemeral 注入。Core 不依赖 OpenCode message 类型。

### D-H.10 Compaction 分为提取与归档两段

OpenCode Adapter 负责监听 `session.compacted`、读取消息、识别 compaction 消息、提取消息 ID/sessionID/时间/文本。Core 负责以事件 ID 幂等归档、主表和 FTS 原子同步、返回 inserted/duplicate。

### D-H.11 保持数据库和用户接口兼容

本变更 SHALL NOT 修改：SQLite 表结构、默认数据库路径、`global/default` 默认作用域、8000 字符默认 Pin 配额、12 个工具名称及参数、配置文件名和优先级、ephemeral 注入语义。

### D-H.12 通过自动测试约束依赖方向

自动测试 SHALL 验证：Core manifest 不依赖 `@opencode-ai/plugin`、Core 源码不导入 OpenCode 或 Adapter、OpenCode Adapter 依赖 Core、现有存储/检索/插件行为不回归。

## Public API

高层入口：`storeMemory`、`recallMemories`、`listMemories`、`readMemory`、`forgetMemory`、`pinMemory`、`unpinMemory`、`listPinnedMemories`、`getPinnedContext`、`archiveSummary`、`recallSummaries`、`setContextValue`、`getContextValue`、`listContextValues`、`deleteContextValue`、`close`，全部使用对象参数并返回 Promise。

公共输入使用 `ScopeRef { scope, scopeKey }`；摘要使用框架无关的 `contextKey` 与 `text`。召回返回带 score 的结构化结果：`{ memories: [{ memory, score }] }` 和 `{ summaries: [{ summary: { id, contextKey, text, createdAt }, score }] }`。读取、删除、Pin、Unpin、归档和 KV 删除均返回判别联合状态，不返回宿主框架文案。

## Risks / Trade-offs

- 公开 API 过早固化 → 仅暴露真实业务操作，内部 SQL 和迁移不公开；`Tokenizer` 已作为公共扩展 API 暴露。
- 异步改造扩大变更面 → 分阶段迁移，SQLite 内部事务保持同步，仅高层边界异步。
- Core 仍依赖 Bun SQLite → 根入口与 `/sqlite` 子路径分离。
- 工具输出回归 → 保留 Adapter 契约测试，逐项对照 12 个工具。
- Workspace 发布错误 → 发布前检查 npm pack 内容与依赖 manifest。
- 同时开发 MCP/CLI 导致范围膨胀 → 本变更明确排除。

## Migration Plan

1. 建立 Workspaces，不移动实现。
2. 原样迁移领域类型、Storage、SQLite、检索和 render 到 Core。
3. 迁移对应测试并保持通过。
4. 实现 `MemoryManager` 和结构化结果。
5. 将 12 个工具逐项改为调用 Manager。
6. 将 overlay 和 compaction 保留在 Adapter。
7. 增加依赖方向和兼容性测试。
8. 使用现有数据库执行升级验证，确认无 Schema 迁移。
9. 构建并打包两个 npm 包。
10. 先发布 Core，再发布 OpenCode Adapter。

回滚时，保留旧版本 npm 包和数据库；由于 Schema 未变化，可直接回退 Adapter 版本。

## Open Questions

- Core 首版是否将 `MemoryStore` 也改为全异步端口？→ 首版仅保证 `MemoryManager` 公共 API 异步；SQLite 事务内部保持同步。
- Core 包版本从 `0.1.0` 开始，还是与 OpenCode Adapter 保持相同版本？→ Core 独立从 `0.1.0` 开始。
- 是否在首版暴露低层 `MemoryStore`？→ 暴露作为扩展端口，但标记为较低层 API，不承诺内部 SQLite 类型稳定。
