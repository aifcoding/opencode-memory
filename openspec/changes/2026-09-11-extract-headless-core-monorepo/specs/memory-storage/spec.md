## MODIFIED Requirements

### Requirement: 记忆条目 CRUD

Core 的 `MemoryStore` SHALL 支持创建、读取、元数据更新、CAS 内容更新、软删除和恢复；`MemoryManager` SHALL 将面向应用的创建、读取和删除操作暴露为结构化高层 API。OpenCode Adapter 当前仅公开创建、读取和软删除工具。

#### Scenario: 通过 Manager 创建条目

- **WHEN** 调用 `MemoryManager.storeMemory` 且输入合法
- **THEN** Core 应用默认作用域、origin 和 trust，并返回创建后的 MemoryEntry

#### Scenario: Adapter 不直接操作 Store

- **WHEN** OpenCode 的 `memory_store`、`memory_read` 或 `memory_forget` 被调用
- **THEN** Adapter 通过 MemoryManager 完成操作，不自行组织底层 Store 流程

### Requirement: 会话 KV

Core SHALL 通过 `contextKey` 提供上下文级键值存储，底层继续使用 `(session_key, kv_key)` 唯一约束。Adapter SHALL 负责将宿主会话身份映射为 contextKey。

#### Scenario: OpenCode sessionID 映射

- **WHEN** OpenCode Adapter 调用 KV API
- **THEN** 使用当前 `ToolContext.sessionID` 作为 contextKey，不改变现有会话隔离语义

### Requirement: 配置

OpenCode Adapter SHALL 从 `~/.config/opencode/opencode-memory.jsonc` 或 `.json` 读取配置，`.jsonc` 优先；插件 options 覆盖文件配置。Core SHALL 仅接收 Adapter 解析后的 dbPath、pinQuota 和默认作用域，不直接读取 OpenCode 配置。

#### Scenario: 配置职责分离

- **WHEN** 插件启动
- **THEN** Adapter 完成读取、合并和严格校验，再使用结果创建 MemoryManager
