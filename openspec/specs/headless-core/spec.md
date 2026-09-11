# headless-core Specification

## Purpose

定义框架无关的 AI 记忆 Core、MemoryManager、结构化结果、配置职责、SQLite 子路径和 Adapter 单向依赖边界。

## Requirements

### Requirement: 框架无关的高层领域入口

系统 SHALL 通过 `@aifcoding/memory-core` 暴露 `MemoryManager`，统一提供长期知识、Pin、情景摘要和上下文 KV 操作。调用者不需要直接组织底层 Store 调用完成业务流程。

#### Scenario: 非 OpenCode 调用者使用 Core

- **WHEN** TypeScript 调用者提供 `MemoryStore` 和 `MemoryManagerOptions`
- **THEN** 调用者可以在不导入任何 OpenCode 类型的情况下创建、召回、固定和删除记忆

### Requirement: 结构化公共结果

Core SHALL 返回结构化对象或判别联合，不返回 OpenCode 专属中文文案。

#### Scenario: Pin 超出配额

- **WHEN** `pinMemory` 会使最终渲染长度超过配额
- **THEN** 返回 `status=quota_exceeded`、size 和 quota

#### Scenario: 摘要模式缺少摘要

- **WHEN** 以 summary 模式固定且没有可用摘要
- **THEN** 返回 `status=summary_required`

#### Scenario: 低信任记忆禁止固定

- **WHEN** 调用 `pinMemory` 固定 `trust=low` 的记忆
- **THEN** 返回 `status=trust_denied`，且不进入 SQLite Pin 事务

### Requirement: Adapter 单向依赖

`packages/opencode` SHALL 依赖 `packages/core`；Core SHALL NOT 依赖 OpenCode 包、类型或消息结构。

#### Scenario: 检查 Core 依赖边界

- **WHEN** 执行依赖边界测试
- **THEN** Core manifest 和源码中均不存在 OpenCode 依赖或反向导入

### Requirement: Core 配置与宿主配置分离

Core SHALL 只接收已解析的运行配置，不读取 OpenCode 配置文件、XDG 目录或插件 options。

#### Scenario: 配置由 Adapter 解析

- **WHEN** Adapter 完成文件和 options 合并
- **THEN** Core 只接收已解析的配置，不读取宿主配置

#### Scenario: Adapter 传入配置

- **WHEN** OpenCode Adapter 完成文件和 options 合并
- **THEN** Adapter 将 dbPath 和 pinQuota 传给 Core；未显式配置的作用域使用 Core 的 `global/default` 默认值

### Requirement: Scope 与 Context Key 分离

长期知识 SHALL 使用 `(scope, scopeKey)` 隔离；上下文 KV SHALL 使用 Adapter 提供的 `contextKey` 隔离。Core 不自动猜测 contextKey。

#### Scenario: 显式提供 contextKey

- **WHEN** 无会话概念的调用者使用 KV
- **THEN** 调用者显式提供稳定的 contextKey

### Requirement: SQLite 子路径隔离

Core 根入口 SHALL 不加载 `bun:sqlite`；默认 SQLite 实现 SHALL 通过 `@aifcoding/memory-core/sqlite` 导出。

#### Scenario: 仅导入 Core 根入口

- **WHEN** 调用者仅导入 `@aifcoding/memory-core`
- **THEN** 模块不加载 `bun:sqlite`

### Requirement: OpenCode 包向后兼容

`@aifcoding/opencode-memory` SHALL 保留现有包名、12 个工具、配置语义和默认数据库位置。

#### Scenario: 现有用户升级

- **WHEN** 用户使用原有 OpenCode 配置升级
- **THEN** 插件继续读取原数据库并提供相同工具，无需迁移配置或数据
