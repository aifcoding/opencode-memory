## Why

opencode-memory 已将记忆能力抽离为框架无关的 `@aifcoding/memory-core`，但目前只有 OpenCode Adapter 可以直接使用这些能力。Hermes、Claude Code、Cursor 等外部 Agent 无法通过标准协议查询同一份本地记忆库。

为每个 Agent 分别实现私有集成会造成重复开发，也容易产生多份互相冲突的记忆。MCP 已提供跨 Agent 的标准工具协议，因此应增加一个独立 MCP Adapter，让外部客户端按需查询或管理同一份 Core 数据。

首版优先解决安全的本地只读访问：使用 stdio、readonly Profile 和 Server 固定的 project scope，向任意 MCP 客户端暴露正式长期记忆的 search/read/list。写入、Pin 和候选审批通过显式 full Profile 控制，客户端不能自行扩大权限或切换 Scope。

## What Changes

- 新增 monorepo 包 `packages/mcp`，npm 包 `@aifcoding/memory-mcp`
- 使用官方 MCP TypeScript SDK v2：`@modelcontextprotocol/server`
- MCP Adapter 依赖 `@aifcoding/memory-core` 的 `MemoryManager`，Core 不依赖 MCP
- 提供可执行命令 `memory-mcp` / `bunx @aifcoding/memory-mcp`
- 首版支持 stdio transport
- 增加声明式工具注册（ToolDefinition + requiredCapabilities + Registry）
- 增加 readonly/full 两个 Profile
- 增加六个 capability：memory:read/write、pin:read/write、candidate:read/review
- readonly Profile 暴露 memory_search/read/list；full 额外暴露 store/forget/pin/unpin/pins
- 在 Safe Assisted Memory Capture API 可用后增加 candidate_list/read/review
- MCP Server 启动时绑定一个固定 project Scope，客户端不能传入或覆盖 Scope
- 严格 JSONC 配置（dbPath/scope/profile/transport/limits/writeTrust/allowCandidateReview）
- 工具结果提供 MCP structuredContent + 文本 fallback，标注为历史参考数据
- stdio 模式禁止向 stdout 输出日志

## Capabilities

### New Capabilities

- `mcp`: 通过标准 MCP 协议向外部 Agent 暴露固定 Scope 内的记忆查询、受控写入、Pin 和候选审批能力。

### Modified Capabilities

（无。MCP 是新的 Adapter，不改变现有 Core 和 OpenCode Adapter 行为。）

## Dependencies

- 基础 search/read/list/store/forget/pin 能力依赖 `@aifcoding/memory-core`
- Candidate 工具依赖 `2026-09-13-safe-assisted-memory-capture` 提供的 Candidate API
- 本 change 可先完成 readonly/full 基础工具；只有 Candidate API 合入后才能完成并启用 candidate capability
- 发布 `@aifcoding/memory-mcp` 前，必须确认其依赖的 Core 版本与 OpenCode Adapter 使用的数据库 Schema 兼容

## Impact

- **新增包**：`@aifcoding/memory-mcp`
- **新增依赖**：官方 `@modelcontextprotocol/server`
- **仓库结构**：增加 `packages/mcp`
- **数据库**：不新增 MCP 专属表，复用 Core 数据库和迁移
- **安全**：默认 readonly，Scope 由 Server 固定
- **运行时**：首版要求 Bun，默认 stdio
- **兼容性**：不修改现有 Core API、OpenCode 工具和数据库路径

## Non-Goals

- 首版不实现 Streamable HTTP / Legacy HTTP+SSE
- 不实现认证、OAuth、远程 RBAC 或多租户
- 不允许客户端按请求传入任意 Scope
- 不实现自动 project identity（首版由配置显式提供稳定 scopeKey）
- 不暴露情景摘要检索、Context KV、archiveSummary
- 不让 MCP Server 自行调用模型提取候选
- 不实现 MCP Resources / Prompts
- 不实现 TeamKbSource、多源检索、向量检索
- 不自实现 MCP JSON-RPC，不设计动态加载第三方代码的 Tool 插件系统
