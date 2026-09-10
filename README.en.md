# opencode-memory

[简体中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh/)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-plugin-4b32c3.svg)](https://opencode.ai/)

A local, persistent memory plugin for [OpenCode](https://opencode.ai/).

It gives AI agents memory across three tiers — **long-term knowledge, episodic summaries, and session working memory** — each with its own lifecycle and retrieval strategy. All data lives in a local SQLite database; Chinese full-text search is powered by `jieba-wasm` and SQLite FTS5. No database server, no vector service, no external API.

## Features

- **Three-tier memory model**
  - Long-term knowledge: preferences, facts, decisions, solutions, and conventions
  - Episodic summaries: session compaction summaries, auto-archived and searchable across sessions
  - Session working memory: a persistent key-value store scoped by `sessionID` (no auto-cleanup in the current version)
- **Fully local**: built on `bun:sqlite`; storage, tokenization, and retrieval all run on your machine
- **Zero external services**: no cloud database, no embedding API, no separate search service
- **Chinese-friendly search**: `jieba-wasm` tokenization with FTS5 BM25 ranking
- **Identifier-aware search**: `CamelCase` is split into words, while underscore identifiers like `foo_bar` are preserved as whole tokens
- **Pinned-memory injection**: chosen memories are injected into every turn automatically
- **Non-persistent injection**: injected content is never written into message history; changes take effect on the next turn
- **Full & summary pin modes**: pin a memory as `full` or `summary`
- **Auto-archive on compaction**: listens for `session.compacted` and idempotently stores the summary
- **Soft delete & deduplication**: deleted memories are excluded from lists and search
- **Local SQLite database**: WAL, write retries, and versioned migrations (may create `-wal`/`-shm` sidecar files while running)

## Three-tier memory model

| Tier | Table | Lifetime | Typical content | Accessed via |
|---|---|---|---|---|
| Long-term knowledge | `memories` | Persistent across sessions | Preferences, environment facts, architecture decisions, lessons learned, conventions | `memory_*` |
| Episodic summaries | `session_summaries` | Auto-archived on session compaction | A past session's goals, progress, conclusions, and open items | `recall_summaries` |
| Session working memory | `session_kv` | Scoped by `sessionID` (persistent) | Ticket numbers, temporary constraints, intermediate state | `kv_*` |

Pinned memory is not a fourth tier — it is a *usage mode* of long-term knowledge: `memory_pin` marks a long-term memory to be injected into every turn.

## Quick start

### 1. Register the plugin (npm)

Add the package to your OpenCode config (`opencode.json` or `opencode.jsonc`):

```jsonc
{
  "plugin": ["@aifcoding/opencode-memory"]
}
```

OpenCode installs and caches npm plugins with Bun at startup.

### 2. Restart OpenCode

The plugin is loaded when you see a log line like:

```text
[opencode-memory] loaded, db=/Users/you/.local/share/opencode/memory/memory.db
```

### 3. Store your first memory

Just tell OpenCode in plain language:

```text
Remember: this project uses Bun everywhere, not npm or yarn.
```

The plugin calls `memory_store` and replies with something like:

```text
已记住 (id=1) Bun 包管理约定
```

## Installation

### Use from npm (recommended)

```jsonc
{
  "plugin": ["@aifcoding/opencode-memory"]
}
```

With plugin options (these take precedence over the standalone config file):

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

### Build from source

Prerequisites: [OpenCode](https://opencode.ai/), [Bun](https://bun.sh/), and Git.

```bash
git clone https://github.com/aifcoding/opencode-memory.git
cd opencode-memory
bun install
```

Register it with an absolute path:

```jsonc
{
  "plugin": [
    "/Users/you/tools/opencode-memory/plugin.ts"
  ]
}
```

To customize, create `~/.config/opencode/opencode-memory.jsonc` (optional; defaults apply when absent):

```jsonc
// ~/.config/opencode/opencode-memory.jsonc
{
  "dbPath": "/Users/you/.local/share/opencode/memory/memory.db",
  "pinQuota": 8000
}
```

Restart OpenCode after changing the config.

> Use an absolute path for `dbPath`; the plugin does not expand `~`.

## Configuration

Configuration is provided via plugin tuple options or a standalone file `~/.config/opencode/opencode-memory.jsonc` (or `.json`); options take precedence. Validation is strict: unknown fields fail startup, and `dbPath` must be an absolute path (the config directory honors `XDG_CONFIG_HOME`):

| Option | Type | Default | Unit | Description |
|---|---|---:|---|---|
| `dbPath` | `string` | `$HOME/.local/share/opencode/memory/memory.db` | path | SQLite database location (under the same root as OpenCode's session database); parent directories are created automatically |
| `pinQuota` | `number` | `8000` | characters | Total budget for all pinned memories, measured by final rendered text length; new pins are rejected when exceeded |

The current version stores long-term memories under the `global/default` scope, so different projects share one long-term memory pool. Session KV stays isolated by OpenCode's `sessionID`.

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

## Tool reference

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

## Retrieval mechanism

Long-term memories and episodic summaries share one local text-retrieval pipeline:

```text
query
  └─ jieba-wasm Chinese tokenization
      └─ SQLite FTS5 OR MATCH
          └─ BM25 relevance ranking
              └─ ranked results
```

Characteristics:

- Chinese content is tokenized with jieba before indexing
- Queries use the same tokenization pipeline
- Two-character Chinese words are recalled independently
- CamelCase identifiers are split into searchable words, while underscore identifiers like `foo_bar` are preserved as whole tokens
- Returns empty when nothing matches
- The current implementation is single-channel FTS5 text retrieval; the data model reserves an embedding field, but vector retrieval is not yet implemented

## Architecture overview

```text
┌─────────────────────────────────────────────────────────┐
│ OpenCode integration layer                               │
│ plugin.ts                                                │
│ ├─ registers 12 tools                                    │
│ ├─ messages.transform: injects pinned memories           │
│ └─ session.compacted: archives compaction summaries      │
├─────────────────────────────────────────────────────────┤
│ Infrastructure layer                                     │
│ SqliteMemoryStore / migrations / tokenize                │
├─────────────────────────────────────────────────────────┤
│ Domain interface layer                                   │
│ MemoryStore                                              │
├─────────────────────────────────────────────────────────┤
│ Local data                                               │
│ memories / session_summaries / session_kv / FTS5         │
└─────────────────────────────────────────────────────────┘
```

### Pinned-memory injection

Pinned memories are appended to the end of messages through OpenCode's `experimental.chat.messages.transform` extension point:

- Injected as reference information only
- The injected block is marked as reference data with a hint to treat it as reference, not instruction; this is a model-facing hint, not a security boundary against prompt injection
- Not written into persistent message history
- Changes or unpins take effect on the next turn
- `summary` mode injects the summary; `full` mode injects the content
- New pins are rejected when the quota is exceeded

### Data persistence

The plugin uses a single SQLite database with:

- FTS5 full-text index
- WAL journal mode
- A `5000 ms` busy timeout
- Retry on SQLite busy/locked
- Transactional sync between the main table and the FTS index
- Sequential, transactional migrations

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and decision log.

## Project structure

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

## Development

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun test
```

Tests cover storage CRUD, soft delete, deduplication, Chinese search, scope filtering, FTS sync, and session KV.

## Data & privacy

- Memories live in the local SQLite file specified by `dbPath`
- The plugin itself needs no remote database or external search service
- Deleting the database file removes all long-term memories, episodic summaries, and session KV
- Back the database up locally, but never commit it to Git
- Do not store passwords, access tokens, private keys, or other secrets
- Storage, tokenization, and retrieval run locally; recalled or pinned memories enter the model context and may be sent to a remote provider if you use one

## Contributing

Issues and pull requests are welcome.

The project uses OpenSpec to maintain behavioral specs. Behavior changes should update the matching document:

| Document | Responsibility |
|---|---|
| `openspec/specs/` | Public behavior and acceptance scenarios |
| `docs/ARCHITECTURE.md` | Architecture design and decision log |
| `README.md` / `README.en.md` | Installation, configuration, and user-facing interface |

Recommended flow:

1. Fork the repo and create a feature branch
2. Add or update OpenSpec for behavior changes
3. Implement and test
4. Run `bun test`
5. Open a pull request explaining the motivation, behavior change, and verification

Keep the implementation, specs, and README tool arguments in sync. Tool interfaces are authoritative in [`plugin.ts`](plugin.ts).

## License

Licensed under the [MIT License](LICENSE).

Copyright © 2026 [aifcoding](https://github.com/aifcoding)
