# opencode-memory

**简体中文** | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh/)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-plugin-4b32c3.svg)](https://opencode.ai/)

本地优先的通用 AI 记忆内核与适配器集合，OpenCode 是首个适配器。`@aifcoding/memory-core` 提供框架无关的记忆 API；`@aifcoding/opencode-memory` 将其接入 OpenCode。

通过**长期知识、情景摘要、会话工作记忆**三层模型，让 AI 在不同生命周期内保存和检索信息。默认实现将数据保存在本地 SQLite 中，中文检索由 `jieba-wasm` 与 SQLite FTS5 提供，无需数据库服务器、向量服务或外部 API。

## 选择使用方式

| 目标 | 使用包 | 状态 |
|---|---|---|
| 给 OpenCode 增加记忆 | `@aifcoding/opencode-memory` | 已实现 |
| 在自己的 Bun/TypeScript 应用中使用 | `@aifcoding/memory-core` | 已实现 |
| 通过 MCP 或 CLI 使用 | 后续适配器 | 规划中，尚未实现 |

## 三层记忆模型

| 层级 | 数据表 | 生命周期 | 典型内容 | OpenCode 工具 | Core API |
|---|---|---|---|---|---|
| 长期知识 | `memories` | 跨会话持久保存 | 技术偏好、环境事实、架构决策、经验教训、团队约定 | `memory_*` | `storeMemory` / `recallMemories` |
| 情景摘要 | `session_summaries` | 会话压缩后自动归档 | 历史会话的目标、进展、结论和未完成事项 | `recall_summaries` | `archiveSummary` / `recallSummaries` |
| 会话工作记忆 | `session_kv` | 按 `sessionID` 隔离（持久） | 当前需求编号、临时约束、中间状态 | `kv_*` | `setContextValue` / `getContextValue` / `listContextValues` / `deleteContextValue` |

固定记忆不是第四层，而是长期知识的一种使用方式：通过 `memory_pin` 将指定长期记忆设为每轮自动注入。
## 核心特性

- **三层记忆模型**：长期知识、情景摘要、会话工作记忆。
- **本地优先**：SQLite + Bun，无需数据库服务器或外部服务。
- **中文友好检索**：jieba-wasm + SQLite FTS5 BM25，并支持代码标识符。
- **显式 Pin**：full/summary、渲染长度配额和非持久化上下文注入。
- **自动归档**：OpenCode compaction 摘要自动幂等保存并可跨会话检索。
- **可复用 Core**：异步 `MemoryManager` 与可注入 `Tokenizer`。

## 快速开始

### 使用 OpenCode 适配器

在 OpenCode 配置文件 `opencode.json` 或 `opencode.jsonc` 中加入包名：

```jsonc
{
  "plugin": ["@aifcoding/opencode-memory"]
}
```

OpenCode 启动时会通过 Bun 自动安装并缓存插件。

直接对 OpenCode 说：

```text
记住：这个项目统一使用 Bun，不使用 npm 或 yarn。安装依赖和运行脚本都使用 bun。
```

插件会调用 `memory_store`，并返回类似结果：

```text
已记住 (id=1) Bun 包管理约定
```

最小配置（可选）写入 `~/.config/opencode/opencode-memory.jsonc`；tuple options 优先于文件配置：

```jsonc
{ "dbPath": "/Users/you/.local/share/opencode/memory/memory.db", "pinQuota": 8000 }
```

### 使用 Headless Core

```bash
bun add @aifcoding/memory-core
```

```ts
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
const manager = createSqliteMemoryManager({ dbPath: '/tmp/memory.db' });
const memory = await manager.storeMemory({ title: '运行约定', content: '项目使用 Bun。', summary: '使用 Bun', type: 'convention' });
console.log((await manager.recallMemories({ query: 'Bun' })).memories);
await manager.pinMemory({ id: memory.id, pinMode: 'summary' });
console.log((await manager.getPinnedContext()).text);
await manager.close();
```

可通过 `options.tokenizer` 注入自定义分词器：

```ts
const tokenizer = { tokenize: (text: string) => text.toLowerCase().split(/\s+/u).join(' ') };
const manager = createSqliteMemoryManager({ dbPath: '/tmp/memory.db', tokenizer });
```

Tokenizer 是数据库索引格式的一部分，更换时请导出数据并用新的空数据库重新导入。
`@aifcoding/memory-core/sqlite` 使用 `bun:sqlite`，仍要求 Bun 运行时。

### 从源码运行

前置条件：OpenCode、Bun 和 Git。

```bash
git clone https://github.com/aifcoding/opencode-memory.git
cd opencode-memory
bun install
bun run build
```

源码构建后注册 `packages/opencode/dist/plugin.js`。

## OpenCode 适配器配置

配置来自 `~/.config/opencode/opencode-memory.jsonc`（或 `.json`），`.jsonc` 优先；插件 tuple options 优先于文件配置并进行严格校验。Core 不读取配置文件、XDG 目录或插件 options，只接收 Adapter 传入的已解析配置。

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `dbPath` | `string` | `$HOME/.local/share/opencode/memory/memory.db` | SQLite 路径，必须为绝对路径 |
| `pinQuota` | `number` | `8000` | 固定记忆最终渲染文本总字符上限 |

## 详细文档

- Core API：[`packages/core/README.md`](packages/core/README.md)
- OpenCode 工具与示例：[`packages/opencode/README.md`](packages/opencode/README.md)
- 架构设计：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 未来规划：[`ROADMAP.md`](ROADMAP.md)
- 行为规格：[`openspec/specs/`](openspec/specs/)

## 工作原理

### 文本检索

长期记忆和情景摘要使用相同的本地文本检索管线：

```text
输入查询
  └─ jieba-wasm 中文分词
      └─ SQLite FTS5 OR MATCH
          └─ BM25 相关度排序
              └─ 返回匹配结果
```

特点：

- 中文内容写入前使用 jieba 分词
- 查询使用相同的分词管线
- 中文二字词可以独立召回
- ASCII 标识符按下划线和 CamelCase 处理
- 无匹配结果时返回空
- 当前为单通道 FTS5 文本检索；数据模型预留 embedding 字段，向量检索尚未实现

### 固定记忆注入

固定记忆通过 OpenCode 的 `experimental.chat.messages.transform` 扩展点附加到消息末尾：

- 仅作为参考信息注入
- 注入块标记为参考数据、提示模型视为参考；该标记是提示性的，不构成对提示注入的机制防护
- 不写入持久化消息历史
- 修改或取消固定后下一轮立即生效
- `summary` 模式注入摘要，`full` 模式注入正文
- 超出配额时拒绝新的固定操作

### 会话压缩归档

OpenCode Adapter 在 `session.compacted` 后提取摘要，Core 以消息 ID 幂等写入 `session_summaries`。

### 数据持久化

数据库包含四张逻辑表：`memories`、`session_summaries`、`session_kv`、`db_migrations`，以及对应 FTS5 虚拟表。SQLite 使用 WAL、5000 ms busy timeout、busy/locked 重试和事务化迁移。

## 架构与仓库结构

### 包与依赖方向

```text
OpenCode Adapter → MemoryManager → MemoryStore → SqliteMemoryStore
```

依赖方向为 `opencode → core` 单向。Core 根入口不加载 `bun:sqlite`；`/sqlite` 入口仍要求 Bun。

### 目录结构

```text
packages/core/       # domain / application / ports / retrieval / render / sqlite
packages/opencode/   # OpenCode adapter
examples/             # Core 使用示例
```

### 当前边界

MCP、CLI 和向量检索尚未实现；Tokenizer 身份持久化与兼容检测处于规划中，自动索引重建尚未决定。

## 数据与隐私

- 记忆内容保存在 `dbPath` 指定的本地 SQLite 文件中
- 插件自身不需要远程数据库或外部检索服务
- 删除数据库文件会清除全部长期记忆、情景摘要和会话 KV
- 建议将数据库纳入本机备份，但不要提交到 Git
- 不建议保存密码、访问令牌、私钥或其他敏感凭据
- 数据库、分词和检索均在本地运行；被召回或固定的记忆会进入模型上下文，若使用远程模型提供商，内容可能随请求发送给该提供商

## 开发与测试

安装依赖：

```bash
bun install
```

类型检查：

```bash
bun run typecheck
```

运行测试：

```bash
bun test
```

测试覆盖 MemoryManager、存储 CRUD、软删除、去重、中文检索、作用域过滤、FTS 同步、会话 KV 和 OpenCode 适配器行为。

## Roadmap

当前能力边界见上文；后续方向见 [`ROADMAP.md`](ROADMAP.md)。

## 贡献

欢迎提交 Issue 和 Pull Request。

本项目采用 OpenSpec 维护行为规格。行为变更应同步更新对应文档：

| 文档 | 职责 |
|---|---|
| OpenCode 工具参数 | [`packages/opencode/src/plugin.ts`](packages/opencode/src/plugin.ts) 的 Zod 定义 |
| Core API | [`packages/core/src/index.ts`](packages/core/src/index.ts) |
| 行为语义 | [`openspec/specs/`](openspec/specs/) |
| 架构取舍 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

推荐贡献流程：

1. Fork 仓库并创建功能分支
2. 为行为变更补充或更新 OpenSpec
3. 完成实现与测试
4. 运行 `bun test`
5. 提交 Pull Request，说明动机、行为变化和验证方式

请保持实现、规格和 README 中的工具参数一致。工具接口以 [`plugin.ts`](packages/opencode/src/plugin.ts) 中的 Zod 定义为准。

## 许可证

本项目采用 [MIT License](LICENSE)。

Copyright © 2026 [aifcoding](https://github.com/aifcoding)
