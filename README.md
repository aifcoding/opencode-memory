# opencode-memory

**简体中文** | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh/)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-plugin-4b32c3.svg)](https://opencode.ai/)

面向 [OpenCode](https://opencode.ai/) 的本地持久记忆插件。

通过**长期知识、情景摘要、会话工作记忆**三层模型，让 AI 在不同生命周期内保存和检索信息。数据全部存储在本机 SQLite 中，中文检索由 `jieba-wasm` 与 SQLite FTS5 提供，无需数据库服务器、向量服务或外部 API。

## 特性

- **三层记忆模型**
  - 长期知识：保存偏好、事实、决策、解决方案和项目约定
  - 情景摘要：自动归档会话压缩摘要，可跨会话检索
  - 会话工作记忆：按 `sessionID` 隔离的持久键值存储（当前版本不自动清理）
- **纯本地运行**：基于 `bun:sqlite`，数据只写入本机
- **零外部服务**：无需云数据库、嵌入 API 或独立检索服务
- **中文友好检索**：使用 `jieba-wasm` 分词和 FTS5 BM25 排序
- **开发标识符检索**：`CamelCase` 会拆分为词元，`foo_bar` 等下划线标识符按整体保留
- **固定记忆自动注入**：每轮向主模型注入指定记忆
- **非持久化注入**：注入内容不写入消息历史，修改或取消固定后下一轮生效
- **全文与摘要模式**：固定记忆支持 `full` 和 `summary`
- **压缩自动归档**：监听 `session.compacted`，幂等保存压缩摘要
- **软删除与内容去重**：已删除记忆不再参与列表和检索
- **本地 SQLite 数据库**：启用 WAL、写入重试和版本化迁移（运行期可能有 `-wal`/`-shm` 辅助文件）

## 三层记忆模型

| 层级 | 数据表 | 生命周期 | 典型内容 | 访问方式 |
|---|---|---|---|---|
| 长期知识 | `memories` | 跨会话持久保存 | 技术偏好、环境事实、架构决策、经验教训、团队约定 | `memory_*` |
| 情景摘要 | `session_summaries` | 会话压缩后自动归档 | 历史会话的目标、进展、结论和未完成事项 | `recall_summaries` |
| 会话工作记忆 | `session_kv` | 按 `sessionID` 隔离（持久） | 当前需求编号、临时约束、中间状态 | `kv_*` |

固定记忆不是第四层，而是长期知识的一种使用方式：通过 `memory_pin` 将指定长期记忆设为每轮自动注入。

## 快速开始

### 1. 注册插件（npm）

在 OpenCode 配置文件 `opencode.json` 或 `opencode.jsonc` 中加入包名：

```jsonc
{
  "plugin": ["@aifcoding/opencode-memory"]
}
```

OpenCode 启动时会通过 Bun 自动安装并缓存插件。

### 2. 重启 OpenCode

启动日志中出现以下内容即表示插件已加载：

```text
[opencode-memory] loaded, db=/Users/you/.local/share/opencode/memory/memory.db
```

### 3. 保存第一条记忆

直接对 OpenCode 说：

```text
记住：这个项目统一使用 Bun，不使用 npm 或 yarn。安装依赖和运行脚本都使用 bun。
```

插件会调用 `memory_store`，并返回类似结果：

```text
已记住 (id=1) Bun 包管理约定
```

## 安装

### 从 npm 使用（推荐）

```jsonc
{
  "plugin": ["@aifcoding/opencode-memory"]
}
```

如需通过插件 options 配置（优先级高于独立配置文件）：

```jsonc
{
  "plugin": [
    ["@aifcoding/opencode-memory", {
      "dbPath": "/Users/you/.local/share/opencode/memory/memory.db",
      "pinQuota": 8000
    }]
  ]
}
```

### 从源码使用

前置条件：[OpenCode](https://opencode.ai/)、[Bun](https://bun.sh/)、Git。

```bash
git clone https://github.com/aifcoding/opencode-memory.git
cd opencode-memory
bun install
```

使用绝对路径注册：

```jsonc
{
  "plugin": [
    "/Users/you/tools/opencode-memory/plugin.ts"
  ]
}
```

如需自定义配置，在 `~/.config/opencode/` 下新建 `opencode-memory.jsonc`（可选，不建则用默认值）：

```jsonc
// ~/.config/opencode/opencode-memory.jsonc
{
  "dbPath": "/Users/you/.local/share/opencode/memory/memory.db",
  "pinQuota": 8000
}
```

修改配置后请重启 OpenCode。

> 自定义 `dbPath` 时请使用绝对路径。插件不会主动展开字符串中的 `~`。

## 配置

配置可通过插件 tuple options 或独立文件 `~/.config/opencode/opencode-memory.jsonc`（或 `.json`）提供，options 优先；配置采用严格校验，未知字段会导致启动失败，`dbPath` 必须为绝对路径（配置目录遵循 `XDG_CONFIG_HOME`）：

| 配置项 | 类型 | 默认值 | 单位 | 说明 |
|---|---|---:|---|---|
| `dbPath` | `string` | `$HOME/.local/share/opencode/memory/memory.db` | 文件路径 | SQLite 数据库位置（默认与 OpenCode 会话库同根目录）；父目录不存在时自动创建 |
| `pinQuota` | `number` | `8000` | 字符 | 所有固定记忆按最终渲染文本计算的注入总量上限；超额时拒绝新的固定操作 |

当前版本将长期记忆存入 `global/default` 作用域，因此不同项目共享同一个长期记忆池。会话 KV 仍按 OpenCode 的 `sessionID` 隔离。

## 使用示例

以下请求都可以直接复制到 OpenCode 对话中。模型会根据需要调用插件工具。

### 保存长期知识

**你：**

```text
记住以下项目约定：Go 服务的函数签名使用 context.Context，不要把 gin.Context 传入业务层。类型设为 convention，标签使用 go、context、architecture。
```

**OpenCode：**

```text
已记住 (id=12) Go Context 使用约定
```

对应工具调用：

```text
memory_store(
  title="Go Context 使用约定",
  content="Go 服务的函数签名使用 context.Context，不要把 gin.Context 传入业务层。",
  type="convention",
  tags=["go", "context", "architecture"]
)
```

### 检索中文记忆

**你：**

```text
检索我保存过的 Context 使用约定。
```

**OpenCode：**

```text
- [id=12] Go Context 使用约定
    Go 服务的函数签名使用 context.Context，不要把 gin.Context 传入业务层。
```

没有匹配结果时返回：

```text
无匹配记忆。
```

插件不会用"最近记忆"填充无关结果。

### 固定为每轮上下文

摘要模式适合需要长期生效、但不希望占用过多上下文的规则。

**你：**

```text
把 id=12 的记忆固定为摘要模式，摘要写成：业务层只接受 context.Context。
```

**OpenCode：**

```text
已固定 id=12 (summary)
```

此后每轮主模型调用都会收到这条参考信息。取消固定：

```text
取消固定 id=12。
```

返回：

```text
已取消固定 id=12
```

如需注入完整内容：

```text
把 id=12 的记忆用 full 模式固定。
```

### 查看和删除长期记忆

```text
列出最近 10 条长期记忆。
```

```text
读取 id=12 的完整内容。
```

```text
删除 id=12 的记忆。
```

`memory_forget` 执行软删除；删除后的条目默认不会出现在列表和检索结果中。

### 检索历史会话摘要

会话发生压缩后，插件会自动归档 OpenCode 生成的 compaction 摘要。

在后续会话中可以询问：

```text
检索历史会话摘要：头像加载失败。
```

可能返回：

```text
- [msg_ab12] 排查了微信头像加载失败问题，根因是 CDN 缓存键未包含图片版本号……
```

只有已经发生压缩并成功归档的会话才会出现在情景摘要检索结果中。

### 使用会话工作记忆

保存会话级信息：

```text
把当前需求编号 DEV-2048 存到会话工作记忆，键名使用 ticket。
```

读取：

```text
读取会话工作记忆中的 ticket。
```

列出当前会话的全部键值：

```text
列出当前会话工作记忆。
```

删除：

```text
删除会话工作记忆中的 ticket。
```

这些键值按 `sessionID` 隔离并持久保存（当前版本不自动清理），不会作为长期知识参与检索或自动注入。

## 工具参考

### 长期知识

| 工具 | 说明 | 参数 |
|---|---|---|
| `memory_store` | 存储一条长期记忆，适合保存个人偏好、环境事实、决策和经验教训 | `title: string` 必填；`content: string` 必填；`type?: "preference" \| "fact" \| "decision" \| "solution" \| "convention"`，默认 `"fact"`；`tags?: string[]`，默认 `[]` |
| `memory_recall` | 检索已存记忆；有查询但无匹配时返回空，不回退最近条目 | `query: string` 必填 |
| `memory_ls` | 按更新时间倒序列出记忆 | `limit?: number`，默认 `20` |
| `memory_read` | 按 ID 读取记忆完整内容 | `id: number` 必填 |
| `memory_forget` | 软删除记忆 | `id: number` 必填 |
| `memory_pin` | 固定或取消固定记忆；固定后每轮自动注入上下文 | `id: number` 必填；`pinned: boolean` 必填；`pinMode?: "full" \| "summary"`，默认 `"summary"`；`summary?: string`，默认使用条目已有摘要 |
| `memory_pins` | 列出当前固定的记忆 | 无 |

#### `memory_store` 类型

| 类型 | 用途 |
|---|---|
| `preference` | 个人偏好或工具选择 |
| `fact` | 环境、项目或业务事实 |
| `decision` | 已确认的技术或产品决策 |
| `solution` | 问题根因、解决方案或经验教训 |
| `convention` | 编码规范、流程约定或团队惯例 |

#### `memory_pin` 模式

| 模式 | 注入内容 | 适用场景 |
|---|---|---|
| `summary` | 一行摘要 | 长期规则、偏好和高频约定 |
| `full` | 记忆正文 | 内容较短且需要完整上下文的知识 |

`summary` 模式要求摘要非空。如果条目没有已有摘要，调用时必须提供 `summary`。固定后的总注入量受 `pinQuota` 限制；超额时插件拒绝操作，不会自动移除已有固定记忆。

### 情景摘要

| 工具 | 说明 | 参数 |
|---|---|---|
| `recall_summaries` | 检索历史会话中自动归档的压缩摘要 | `query: string` 必填 |

每次收到 `session.compacted` 事件后，插件读取 compaction agent 生成的摘要，并以压缩消息 ID 幂等写入 `session_summaries`。

### 会话工作记忆

| 工具 | 说明 | 参数 |
|---|---|---|
| `kv_set` | 保存当前会话可见的键值；同名键会覆盖旧值 | `key: string` 必填；`value: string` 必填 |
| `kv_get` | 读取当前会话的指定键值 | `key: string` 必填 |
| `kv_list` | 列出当前会话的全部键值 | 无 |
| `kv_del` | 删除当前会话的指定键值 | `key: string` 必填 |

## 检索机制

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

## 架构概览

```text
┌─────────────────────────────────────────────────────────┐
│ OpenCode 集成层                                          │
│ plugin.ts                                                │
│ ├─ 注册 12 个工具                                        │
│ ├─ messages.transform：注入固定记忆                      │
│ └─ session.compacted：归档压缩摘要                       │
├─────────────────────────────────────────────────────────┤
│ 基础设施层                                               │
│ SqliteMemoryStore / migrations / tokenize                │
├─────────────────────────────────────────────────────────┤
│ 领域接口层                                               │
│ MemoryStore                                              │
├─────────────────────────────────────────────────────────┤
│ 本地数据                                                 │
│ memories / session_summaries / session_kv / FTS5         │
└─────────────────────────────────────────────────────────┘
```

### 固定记忆注入

固定记忆通过 OpenCode 的 `experimental.chat.messages.transform` 扩展点附加到消息末尾：

- 仅作为参考信息注入
- 注入块标记为参考数据、提示模型视为参考；该标记是提示性的，不构成对提示注入的机制防护
- 不写入持久化消息历史
- 修改或取消固定后下一轮立即生效
- `summary` 模式注入摘要，`full` 模式注入正文
- 超出配额时拒绝新的固定操作

### 数据持久化

插件使用本地 SQLite 数据库（WAL 模式，运行期可能有 `-wal`/`-shm` 辅助文件），并启用：

- FTS5 全文索引
- WAL 日志模式
- `5000 ms` busy timeout
- SQLite busy/locked 写入重试
- 主表与 FTS 索引事务同步
- 顺序、事务化的数据库迁移

详细设计与决策记录见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 项目结构

```text
opencode-memory/
├── plugin.ts
├── package.json
├── README.md
├── LICENSE
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── types.ts
│   ├── render.ts
│   └── storage/
│       ├── MemoryStore.ts
│       ├── SqliteMemoryStore.ts
│       ├── tokenizer.ts
│       ├── migrations.ts
│       └── capability.ts
├── tests/
│   ├── memory-store.test.ts
│   ├── retrieval.test.ts
│   └── plugin.test.ts
└── openspec/
    └── specs/
        ├── memory-storage/spec.md
        ├── retrieval/spec.md
        ├── memory-injection/spec.md
        └── memory-compaction/spec.md
```

## 开发与测试

安装依赖：

```bash
bun install
```

运行测试：

```bash
bun test
```

测试覆盖存储 CRUD、软删除、去重、中文检索、作用域过滤、FTS 同步和会话 KV 等核心行为。

## 数据与隐私

- 记忆内容保存在 `dbPath` 指定的本地 SQLite 文件中
- 插件自身不需要远程数据库或外部检索服务
- 删除数据库文件会清除全部长期记忆、情景摘要和会话 KV
- 建议将数据库纳入本机备份，但不要提交到 Git
- 不建议保存密码、访问令牌、私钥或其他敏感凭据
- 数据库、分词和检索均在本地运行；被召回或固定的记忆会进入模型上下文，若使用远程模型提供商，内容可能随请求发送给该提供商

## 贡献

欢迎提交 Issue 和 Pull Request。

本项目采用 OpenSpec 维护行为规格。行为变更应同步更新对应文档：

| 文档 | 职责 |
|---|---|
| `openspec/specs/` | 对外行为与验收场景 |
| `docs/ARCHITECTURE.md` | 架构设计与决策记录 |
| `README.md` / `README.en.md` | 安装、配置和用户接口说明 |

推荐贡献流程：

1. Fork 仓库并创建功能分支
2. 为行为变更补充或更新 OpenSpec
3. 完成实现与测试
4. 运行 `bun test`
5. 提交 Pull Request，说明动机、行为变化和验证方式

请保持实现、规格和 README 中的工具参数一致。工具接口以 [`plugin.ts`](plugin.ts) 中的 Zod 定义为准。

## 许可证

本项目采用 [MIT License](LICENSE)。

Copyright © 2026 [aifcoding](https://github.com/aifcoding)
