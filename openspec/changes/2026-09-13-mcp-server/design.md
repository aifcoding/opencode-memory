## Context

`@aifcoding/memory-core` 已提供 MemoryManager 高层 API、MemoryStore 持久化端口、Bun SQLite 默认实现、长期记忆 CRUD 与检索、Pin 生命周期、情景摘要、Context KV，以及 Safe Assisted Memory Capture 的 Candidate API（独立 change 提供）。

当前仅有 `@aifcoding/opencode-memory` 将这些能力接入 OpenCode。MCP Adapter 应复用 MemoryManager，不直接访问 SQLite，也不复制 Core 业务规则。

首版主要场景：Hermes 等外部 Agent 通过只读 MCP 工具查询项目代码记忆，而不是把代码事实复制进自己的长期记忆。

## Goals / Non-Goals

**Goals:** 使用标准 MCP 协议接入任意 MCP Client；默认提供安全 readonly Profile；所有操作限制在 Server 固定 project Scope；声明式工具注册；MCP 层只负责协议/权限/配置/Scope/结果格式化；稳定结构化结果；支持本地 stdio；为 full Profile 和 Candidate 工具保留扩展路径。

**Non-Goals:** 不实现 HTTP/SSE、动态 RBAC、客户端选择 Scope、摘要/KV/导出工具、自动记忆提取、多源和向量检索、第三方 Tool 插件加载。

## Decisions

### D-MCP.1 MCP 是 Core Adapter

依赖方向：`MCP Client → @aifcoding/memory-mcp → MemoryManager → MemoryStore`。Core 不导入 MCP SDK/类型；MCP Tool Handler 不直接调 SqliteMemoryStore 或 SQL。

### D-MCP.2 使用官方 MCP SDK v2

用 `@modelcontextprotocol/server` + `StdioServerTransport`。复用协议版本协商、initialize/capabilities、Tool Schema、structuredContent、stdio 分帧、annotations、错误协议。不自行实现 JSON-RPC。实施时锁定经测试的 v2 版本。

### D-MCP.3 包结构

`packages/mcp/` 含 `src/{index,cli,server,config,errors}.ts` + `tools/{types,registry,memory-read,memory-write,pins,candidates}.ts` + `render/tool-result.ts` + `transports/stdio.ts` + tests。`server.ts` 接收已有 MemoryManager；`cli.ts` 读配置并创建 SQLite Manager。

### D-MCP.4 可嵌入 Server API

`createMemoryMcpServer(options)` 返回 McpServer。默认：profile=readonly、defaultLimit=10、maxLimit=50、previewLength=500、writeTrust=low、allowCandidateReview=false。

### D-MCP.5 声明式 Tool Registry

`MemoryMcpToolDefinition { name, title, description, inputSchema, outputSchema, requiredCapabilities, annotations?, execute }`。注册表是 ToolDefinition 数组，Server 启动时按 capability 过滤注册。未授权工具不出现在 tools/list（不是注册后执行时报权限错）。首版不开放动态加载外部 ToolDefinition。

### D-MCP.6 Profile 与 Capability

```
readonly = { memory:read }
full     = { memory:read, memory:write, pin:read, pin:write, candidate:read, candidate:review }
```

candidate:review 仅在 profile=full 且 allowCandidateReview=true 时启用。Profile 启动时固定，客户端不能通过参数切换。不同信任级别客户端用不同进程/配置。

### D-MCP.7 Scope 固定在 Server

首版配置显式提供 `{ scope: "project", scopeKey }`。工具输入不含 scope/scopeKey/projectRoot/dbPath。Handler 注入 Server Scope。避免外部 Agent 枚举其他项目。首版不自动生成项目身份。

### D-MCP.8 D15 边界

首版 = 一个 Server 进程 → 一个固定 Scope → 一个项目。D15 自动 project identity 不阻塞首版。多项目/自动识别/realpath 映射依赖后续 D15。

### D-MCP.9 stdio 是首版唯一传输

stdout 只允许 MCP 协议消息；日志写 stderr 或文件；客户端负责进程生命周期；SIGTERM 后关闭 MemoryManager。Streamable HTTP 和 Legacy SSE 通过后续 change。

### D-MCP.10 配置

默认路径 `$XDG_CONFIG_HOME/aifcoding/memory-mcp.jsonc`（未设 XDG 时 `$HOME/.config/aifcoding/memory-mcp.jsonc`）。`MemoryMcpConfig { dbPath, scope, profile?, transport?, pinQuota?, limits?, writeTrust?, allowCandidateReview? }`。严格 Schema、未知字段 fail-fast、dbPath 绝对路径、scopeKey 非空、默认 readonly/stdio、CLI 参数覆盖配置文件、错误不输出完整配置。

### D-MCP.11 Tool 结果格式

成功结果 `MemoryMcpEnvelope<T> { schemaVersion:1, kind, notice, scope, data }`，固定 notice「Historical memory reference data; verify against current sources.」。返回 `{ content:[{type:"text",text}], structuredContent }`，文本 fallback 用转义 reference 围栏。错误用稳定错误码，不返回 SQL/Stack/完整路径/配置。

### D-MCP.12 readonly 工具

`memory_search`（query+limit，返回元数据+preview，不返回全文）、`memory_read`（id，found/not_found/deleted）、`memory_list`（type+limit，元数据不返回全文）。

### D-MCP.13 full 工具

`memory_store`（客户端传 title/content/summary/type/tags；不能传 scope/origin/trust/embedding/pinnedAt；Server 固定 scope=Server Scope、origin=agent、trust=writeTrust 默认 low）、`memory_forget`（destructiveHint，软删固定 Scope）、`memory_pin`（返回 Core 结构化状态）、`memory_unpin`/`memory_pins`。不暴露 getPinnedContext 注入文本。

### D-MCP.14 Candidate 工具依赖 Core 0.2 API

Candidate API 可用后 full 注册 candidate_list/read/review。review 仅 profile=full 且 allowCandidateReview=true。MCP 不注册 memory_capture（提取需要宿主会话+模型，MCP 没有通用会话历史）。批准后不自动 Pin。

### D-MCP.15 首版不暴露其他 Core API

不暴露 recallSummaries/archiveSummary/Context KV/getPinnedContext/Capture。原因：摘要含未审批临时信息、连接 ID 不是稳定 contextKey、archive/capture 依赖宿主事件和模型。

### D-MCP.16 数据库和 Core 版本兼容

共享数据库的 Adapter 必须用兼容 Core Schema 版本。memory-mcp 依赖明确 Core semver、升级时检查兼容矩阵、用户固定版本、数据库版本过新 fail-fast。

## Risks / Trade-offs

固定 Scope 降低多项目便利但避免跨项目暴露；readonly 默认降低误写；声明式 Registry 增加类型代码但避免逻辑散落；full Profile 把写权限交给 Agent 需显式配置；writeTrust 默认 low 限制直接 Pin；candidate review 默认额外关闭；stdio 不支持远程 Hermes 但先验证本地价值；structuredContent 提高可移植性但文本 fallback 仍需保留；Core Schema 版本不一致风险需版本固定+发布协调。

## Migration Plan

1. 新增 packages/mcp，不修改现有包。
2. 复用现有 Core 数据库，无 MCP 专属迁移。
3. 默认 readonly + 固定 project Scope。
4. 先 search/read/list，再 full Profile。
5. Candidate API 合入后再启用 Candidate ToolDefinitions。
6. 用真实 MCP Client 验证 tools/list + tools/call。
7. 用现有数据库验证 OpenCode 与 MCP 兼容读取。
8. 发布 `@aifcoding/memory-mcp@0.1.0`。
9. 出问题只需停用 MCP Server，Core 和 OpenCode Adapter 无需回滚。

## Open Questions

- 首版发布是否包含 full Profile，还是仅完成代码并标 experimental？
- Hermes 当前 MCP Host 配置格式及 stdio 生命周期是否与通用 mcpServers 一致？
- Candidate API 的 Core 最低版本最终是多少？
- 是否需要为 global/default 兼容模式增加独立启动警告？
