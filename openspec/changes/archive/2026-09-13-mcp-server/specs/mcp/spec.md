## ADDED Requirements

### Requirement: 标准 MCP Server

系统 SHALL 通过 `@aifcoding/memory-mcp` 提供标准 MCP Server，并使用官方 `@modelcontextprotocol/server` v2 实现协议与 stdio transport。

#### Scenario: 标准客户端连接

- **WHEN** 任意兼容 MCP 的客户端启动 Server
- **THEN** 客户端可以完成 initialize、tools/list 和 tools/call

#### Scenario: Core 保持独立

- **WHEN** 构建依赖图
- **THEN** memory-mcp 依赖 memory-core，memory-core 不依赖 MCP SDK 或 MCP 类型

### Requirement: stdio 传输

首版 SHALL 使用 stdio transport，stdout 只允许 MCP 协议消息。

#### Scenario: Server 启动

- **WHEN** 客户端通过 `memory-mcp` 或 bunx 启动进程
- **THEN** Server 使用 StdioServerTransport 接收 MCP 请求

#### Scenario: 日志输出

- **WHEN** Server 输出日志或错误
- **THEN** 日志写入 stderr 或文件，不写 stdout

### Requirement: 声明式工具注册

每个 MCP Tool SHALL 通过 ToolDefinition 声明名称、描述、输入 Schema、输出 Schema、requiredCapabilities、annotations 和 Handler。

#### Scenario: 注册允许工具

- **WHEN** Server 根据 Profile 初始化
- **THEN** 只注册 Profile capability 允许的 ToolDefinition

#### Scenario: 未授权工具不可见

- **WHEN** 客户端调用 tools/list
- **THEN** 未授权工具不出现在结果中

### Requirement: Profile 与 Capability

系统 SHALL 支持 readonly 和 full Profile，并用六个 capability 控制工具注册：memory:read、memory:write、pin:read、pin:write、candidate:read、candidate:review。

#### Scenario: 默认 Profile

- **WHEN** 配置未指定 profile
- **THEN** Server 使用 readonly Profile

#### Scenario: Profile 不可由客户端切换

- **WHEN** MCP 客户端调用工具
- **THEN** 客户端不能通过输入参数修改当前 Profile 或 capability

### Requirement: Server 固定 Project Scope

首版 MCP Server SHALL 绑定一个配置提供的 project Scope。工具输入不得包含 scope 或 scopeKey。

#### Scenario: Scope 注入

- **WHEN** Handler 调用 MemoryManager
- **THEN** Handler 将 Server Scope 注入 Manager 调用

#### Scenario: 客户端尝试指定 Scope

- **WHEN** 客户端在工具输入中提供 scope、scopeKey、dbPath 或 projectRoot
- **THEN** 严格 Schema 拒绝未知字段

#### Scenario: 跨项目读取

- **WHEN** Server 绑定 project A，客户端请求 project B 中的 memory ID
- **THEN** MemoryManager 返回 not_found，不泄露 project B 内容

### Requirement: readonly Profile

readonly Profile SHALL 只暴露 memory_search、memory_read 和 memory_list。

#### Scenario: 搜索记忆

- **WHEN** 调用 memory_search
- **THEN** 返回固定 Scope 内匹配的正式记忆及 id、title、preview、type、tags、origin、trust、score、scope 和 updatedAt

#### Scenario: 读取记忆

- **WHEN** 调用 memory_read
- **THEN** 返回固定 Scope 内的 found/not_found/deleted 结构化状态

#### Scenario: 列出记忆

- **WHEN** 调用 memory_list
- **THEN** 按更新时间倒序返回固定 Scope 内记忆元数据，不返回完整正文

#### Scenario: readonly 没有写能力

- **WHEN** readonly 客户端执行 tools/list
- **THEN** store、forget、pin、unpin、candidate review 和其他写工具均不可见

### Requirement: full Profile

full Profile SHALL 在 readonly 工具之外提供 memory_store、memory_forget、memory_pin、memory_unpin 和 memory_pins。

#### Scenario: 写入记忆

- **WHEN** full 客户端调用 memory_store
- **THEN** Server 使用固定 Scope、origin=agent 和配置的 writeTrust 写入，客户端不能覆盖这些字段

#### Scenario: 默认低信任写入

- **WHEN** 未配置 writeTrust
- **THEN** memory_store 使用 trust=low

#### Scenario: 删除记忆

- **WHEN** full 客户端调用 memory_forget
- **THEN** 只软删除固定 Scope 内的 memory

#### Scenario: Pin 记忆

- **WHEN** full 客户端调用 memory_pin
- **THEN** 返回 Core 的 pinned、quota_exceeded、summary_required、trust_denied、not_found 或 deleted 状态

### Requirement: Candidate 工具

当依赖的 Core Candidate API 可用时，full Profile SHALL 支持 Candidate list/read；Candidate review 还需显式启用 allowCandidateReview。

#### Scenario: 查看候选

- **WHEN** full Client 调用 memory_candidate_list 或 memory_candidate_read
- **THEN** 返回固定 Scope 内的候选，并标记为低信任参考数据

#### Scenario: Candidate Review 默认关闭

- **WHEN** profile=full 但 allowCandidateReview=false
- **THEN** memory_candidate_review 不出现在 tools/list

#### Scenario: 启用 Candidate Review

- **WHEN** profile=full 且 allowCandidateReview=true
- **THEN** 注册 memory_candidate_review，并通过 Core Candidate API 执行 approve/reject

#### Scenario: 批准后不自动 Pin

- **WHEN** Candidate 被批准为正式 memory
- **THEN** MCP Server 不自动固定该 memory

### Requirement: 结构化结果

所有 MCP Tool SHALL 提供带 schemaVersion、kind、notice、scope 和 data 的 structuredContent，并提供文本 fallback。

#### Scenario: 参考数据提示

- **WHEN** search、read、list 或 Candidate 工具返回记忆数据
- **THEN** 结果明确标记为历史参考数据，提示调用方以当前事实源验证

#### Scenario: 文本围栏

- **WHEN** 记忆正文包含与围栏相同的标签、引号或属性文本
- **THEN** 文本 fallback 转义正文和属性，正文不能关闭或伪造外层围栏

### Requirement: 稳定错误输出

MCP Tool 错误 SHALL 使用稳定错误码，不泄露内部实现。

#### Scenario: 内部错误

- **WHEN** SQLite、配置或其他内部操作失败
- **THEN** 客户端不收到 SQL、Stack、完整数据库路径或完整配置内容

### Requirement: 严格配置

Server SHALL 从 JSONC 配置读取 dbPath、project Scope、Profile、stdio transport 和限制参数，并严格拒绝未知字段。

#### Scenario: 最小配置

- **WHEN** 配置包含绝对 dbPath、非空 project scopeKey 和 stdio transport
- **THEN** Server 成功启动

#### Scenario: 缺少 Scope

- **WHEN** 配置未提供 project Scope
- **THEN** Server fail-fast，不默认读取所有作用域

#### Scenario: 非法 dbPath

- **WHEN** dbPath 不是绝对路径
- **THEN** Server fail-fast 并向 stderr 输出不含敏感内容的错误

### Requirement: 数据库版本兼容

共享数据库的 MCP 与其他 Adapter SHALL 使用兼容的 Core Schema 版本。

#### Scenario: 数据库版本过新

- **WHEN** 当前 MCP Core 版本无法识别数据库迁移版本
- **THEN** Server fail-fast，不以未知 Schema 启动

#### Scenario: 共享数据库

- **WHEN** OpenCode Adapter 和 MCP Adapter 使用同一数据库
- **THEN** 两者通过兼容的 Core 版本读取相同固定 Scope 数据

### Requirement: 首版能力边界

首版 SHALL NOT 暴露情景摘要、Context KV、archiveSummary、自动 Capture、HTTP/SSE、Resources 或 Prompts。

#### Scenario: tools/list

- **WHEN** 任一首版 Profile 调用 tools/list
- **THEN** 不返回摘要、KV、Capture、HTTP 管理、Resource 或 Prompt 相关工具
