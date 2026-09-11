# @aifcoding/opencode-memory

[简体中文](#中文) | [English](#english)

## 中文

OpenCode 本地持久记忆插件，基于 [`@aifcoding/memory-core`](https://github.com/aifcoding/opencode-memory/tree/main/packages/core)。

前置条件：OpenCode 与 Bun。

在 `opencode.json` 或 `opencode.jsonc` 中注册：

```jsonc
{ "plugin": ["@aifcoding/opencode-memory"] }
```

可通过 tuple options 配置数据库路径和 Pin 配额：

```jsonc
{ "plugin": [["@aifcoding/opencode-memory", {
  "dbPath": "/Users/you/.local/share/opencode/memory/memory.db",
  "pinQuota": 8000
}]] }
```

`dbPath` 必须是绝对路径；默认路径为
`$HOME/.local/share/opencode/memory/memory.db`，默认 `pinQuota` 为 8000 字符。
更多功能、配置和工具说明见仓库根目录的 [`README.md`](https://github.com/aifcoding/opencode-memory/blob/main/README.md)。

## OpenCode adapter overview

This package is the first adapter for `@aifcoding/memory-core` and provides:

| Tier | Meaning | Storage |
|---|---|---|
| Long-term knowledge | Preferences, facts, decisions, solutions, conventions | `memories` |
| Episodic summaries | Compaction summaries searchable across sessions | `session_summaries` |
| Session working memory | Persistent per-session key-value context | `session_kv` |

Pinned memories are appended as ephemeral reference context on each turn. Compaction summaries are extracted from `session.compacted` and archived idempotently by message ID. The default database is local SQLite at `$HOME/.local/share/opencode/memory/memory.db`; recalled or pinned content enters the model context and may be sent to a remote provider.

Tool descriptions and results are currently in Simplified Chinese; English localization is not implemented.

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
## OpenCode 工具参考

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

## Usage examples

These prompts can be pasted directly into an OpenCode conversation. The model calls the relevant tool as needed.

> Note: tool descriptions and user-facing tool results are currently emitted in Simplified Chinese. English localization is not yet implemented.

### Store long-term knowledge

**You:**

```text
Remember this convention: Go service functions take context.Context and never pass gin.Context into the business layer. Type it as convention, tags go, context, architecture.
```

**OpenCode:**

```text
已记住 (id=12) Go Context 使用约定
```

Underlying tool call:

```text
memory_store(
  title="Go Context 使用约定",
  content="Go 服务的函数签名使用 context.Context，不要把 gin.Context 传入业务层。",
  type="convention",
  tags=["go", "context", "architecture"]
)
```

### Search memories in Chinese

**You:**

```text
检索我保存过的 Context 使用约定。
```

**OpenCode:**

```text
- [id=12] Go Context 使用约定
    Go 服务的函数签名使用 context.Context，不要把 gin.Context 传入业务层。
```

With no match, it returns:

```text
无匹配记忆。
```

The plugin never pads results with "recent" unrelated memories.

### Pin a memory into every turn

Summary mode suits rules that should persist long-term without consuming much context.

**You:**

```text
把 id=12 的记忆固定为摘要模式，摘要写成：业务层只接受 context.Context。
```

**OpenCode:**

```text
已固定 id=12 (summary)
```

From then on, every main-model turn receives this reference. To unpin:

```text
取消固定 id=12。
```

```text
已取消固定 id=12
```

To inject the full content instead:

```text
把 id=12 的记忆用 full 模式固定。
```

### List and delete long-term memories

```text
列出最近 10 条长期记忆。
```

```text
读取 id=12 的完整内容。
```

```text
删除 id=12 的记忆。
```

`memory_forget` soft-deletes; deleted entries no longer appear in lists or search results.

### Search archived session summaries

After a session is compacted, the plugin auto-archives the compaction summary OpenCode generated.

In a later session, ask:

```text
检索历史会话摘要：头像加载失败。
```

A possible result:

```text
- [msg_ab12] 排查了微信头像加载失败问题，根因是 CDN 缓存键未包含图片版本号……
```

Only sessions that have been compacted and successfully archived appear in episodic search.

### Use session working memory

Store session-scoped info:

```text
把当前需求编号 DEV-2048 存到会话工作记忆，键名使用 ticket。
```

Read:

```text
读取会话工作记忆中的 ticket。
```

List all keys for this session:

```text
列出当前会话工作记忆。
```

Delete:

```text
删除会话工作记忆中的 ticket。
```

These keys are scoped by `sessionID` and persist (no auto-cleanup in the current version); they do not participate in long-term search or injection.
## English

## OpenCode tool reference

### Long-term knowledge

| Tool | Description | Arguments |
|---|---|---|
| `memory_store` | Store a long-term memory (preferences, facts, decisions, lessons learned) | `title: string` required; `content: string` required; `type?: "preference" \| "fact" \| "decision" \| "solution" \| "convention"`, default `"fact"`; `tags?: string[]`, default `[]` |
| `memory_recall` | Search stored memories; returns empty when nothing matches | `query: string` required |
| `memory_ls` | List memories, most recently updated first | `limit?: number`, default `20` |
| `memory_read` | Read a memory's full content by ID | `id: number` required |
| `memory_forget` | Soft-delete a memory | `id: number` required |
| `memory_pin` | Pin or unpin a memory; pinned memories are injected every turn | `id: number` required; `pinned: boolean` required; `pinMode?: "full" \| "summary"`, default `"summary"`; `summary?: string`, defaults to the entry's existing summary |
| `memory_pins` | List currently pinned memories | none |

#### `memory_store` types

| Type | Purpose |
|---|---|
| `preference` | Personal preference or tool choice |
| `fact` | Environment, project, or business fact |
| `decision` | A confirmed technical or product decision |
| `solution` | Root cause, solution, or lesson learned |
| `convention` | Coding standard, process convention, or team practice |

#### `memory_pin` modes

| Mode | Injected content | Best for |
|---|---|---|
| `summary` | A one-line summary | Long-lived rules, preferences, high-frequency conventions |
| `full` | The full content | Short knowledge that needs complete context |

`summary` mode requires a non-empty summary. If the entry has none, you must provide `summary` in the call. Total injected size is bounded by `pinQuota`; when exceeded, the plugin rejects the operation instead of silently dropping existing pins.

### Episodic summaries

| Tool | Description | Arguments |
|---|---|---|
| `recall_summaries` | Search auto-archived compaction summaries from past sessions | `query: string` required |

On each `session.compacted` event, the plugin reads the summary produced by the compaction agent and idempotently writes it to `session_summaries`, keyed by the compaction message ID.

### Session working memory

| Tool | Description | Arguments |
|---|---|---|
| `kv_set` | Store a session-scoped key-value pair; overwrites on duplicate key | `key: string` required; `value: string` required |
| `kv_get` | Read a session-scoped value | `key: string` required |
| `kv_list` | List all key-value pairs for the current session | none |
| `kv_del` | Delete a session-scoped key | `key: string` required |
