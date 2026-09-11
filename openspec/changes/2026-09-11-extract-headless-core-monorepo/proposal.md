## Why

当前 `@aifcoding/opencode-memory` 同时承担领域逻辑、SQLite 存储和 OpenCode 协议适配。虽然 `src/storage` 已基本不依赖 OpenCode，但外部使用者无法通过稳定的高层 API 复用长期记忆、检索、Pin、情景摘要和上下文 KV 能力。

项目下一阶段定位为「通用记忆内核 + 多适配器」。需要先将真实业务操作收敛到框架无关的 Headless Core，并将现有 OpenCode 插件瘦身为 Adapter，作为后续 MCP 和 CLI 的共同基础。

## What Changes

- 将仓库改为 Bun Workspaces monorepo。
- 新增 `packages/core`，发布为 `@aifcoding/memory-core`。
- 将领域类型、`MemoryStore`、SQLite 实现、迁移、检索、Pin 渲染迁入 Core。
- 新增高层领域入口 `MemoryManager`，统一提供长期知识、情景摘要、Pin 和上下文 KV API。
- Core 返回结构化结果，不返回 OpenCode 工具文案。
- 将现有插件迁入 `packages/opencode`，继续发布为 `@aifcoding/opencode-memory`。
- OpenCode Adapter 仅保留工具注册、配置解析、结果格式化、overlay、compaction Hook 和资源释放。
- 将 `sessionID` 抽象为 Adapter 提供的 `contextKey`；长期记忆继续使用 `scope + scopeKey`。
- 增加公共类型声明、包导出和依赖边界测试。
- 保持现有 npm 包、数据库结构、配置、12 个工具及用户可见行为兼容。

## Capabilities

### New Capabilities

- `headless-core`: 定义框架无关的 `MemoryManager` 公共 API、包边界、配置职责和 Adapter 依赖方向。

### Modified Capabilities

- `memory-storage`: 存储能力由 Core 提供；OpenCode 配置解析下沉为 Adapter 职责。
- `retrieval`: 长期记忆检索通过 `MemoryManager` 暴露结构化结果。
- `memory-injection`: Core 负责 Pin 生命周期与参考文本渲染，OpenCode Adapter 负责消息注入。
- `memory-compaction`: Core 负责幂等归档，OpenCode Adapter 负责事件和消息提取。

## Impact

- **仓库结构**：单包仓库改为 Bun Workspaces monorepo。
- **新增 npm 包**：`@aifcoding/memory-core`。
- **保留 npm 包**：`@aifcoding/opencode-memory` 继续作为兼容的 OpenCode Adapter。
- **代码移动**：`src/storage`、领域类型和 render 迁入 `packages/core`。
- **公共 API**：新增异步、结构化的 `MemoryManager` API。
- **测试**：现有 27 个测试按 Core/Adapter 分层迁移，并新增 Manager 和依赖边界测试。
- **数据库**：无 Schema 变更，无数据迁移。
- **用户兼容性**：安装包名、配置文件、默认数据库路径、工具参数和主要返回语义不变。

## Non-Goals

- 本变更不实现 MCP Server 或 CLI。
- 不实现向量检索、多源检索或自动记忆提取。
- 不修改 SQLite 表名和字段名。
- 不承诺默认 SQLite 实现可在非 Bun 运行时使用。
- 不引入依赖注入容器、事件总线或多层 Repository 抽象。
