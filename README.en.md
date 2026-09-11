# opencode-memory

[简体中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh/)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-plugin-4b32c3.svg)](https://opencode.ai/)

A local-first, framework-independent AI memory core with adapters. [OpenCode](https://opencode.ai/) is the first adapter.

It gives AI agents memory across three tiers — **long-term knowledge, episodic summaries, and session working memory** — each with its own lifecycle and retrieval strategy. The framework-independent API is provided by `@aifcoding/memory-core`; OpenCode is one adapter. The default implementation stores data in local SQLite; Chinese full-text search is powered by `jieba-wasm` and SQLite FTS5. No database server, no vector service, no external API.

## Choose how to use it

| Goal | Package | Status |
|---|---|---|
| Add memory to OpenCode | `@aifcoding/opencode-memory` | Implemented |
| Use it in your own Bun/TypeScript app | `@aifcoding/memory-core` | Implemented |
| Use it through MCP or CLI | Future adapters | Planned, not implemented |

## Three-tier memory model

| Tier | Table | Lifetime | Typical content | OpenCode tools | Core API |
|---|---|---|---|---|---|
| Long-term knowledge | `memories` | Persistent across sessions | Preferences, environment facts, architecture decisions, lessons learned, conventions | `memory_*` | `storeMemory` / `recallMemories` |
| Episodic summaries | `session_summaries` | Auto-archived on session compaction | A past session's goals, progress, conclusions, and open items | `recall_summaries` | `archiveSummary` / `recallSummaries` |
| Session working memory | `session_kv` | Scoped by `sessionID` (persistent) | Ticket numbers, temporary constraints, intermediate state | `kv_*` | `setContextValue` / `getContextValue` / `listContextValues` / `deleteContextValue` |

Pinned memory is not a fourth tier — it is a *usage mode* of long-term knowledge: `memory_pin` marks a long-term memory to be injected into every turn.
## Core features

- **Three-tier memory model**: long-term knowledge, episodic summaries, and session working memory.
- **Local-first**: SQLite + Bun, with no database server or external service.
- **Chinese-friendly retrieval**: jieba-wasm + SQLite FTS5 BM25, including code identifiers.
- **Explicit Pin**: full/summary modes, rendered-size quotas, and non-persistent context injection.
- **Automatic archiving**: OpenCode compaction summaries are archived idempotently and searchable across sessions.
- **Reusable Core**: async `MemoryManager` and injectable `Tokenizer`.

## Quick start

### Use the OpenCode adapter

Add the package to your OpenCode config (`opencode.json` or `opencode.jsonc`):

```jsonc
{
  "plugin": ["@aifcoding/opencode-memory"]
}
```

OpenCode installs and caches npm plugins with Bun at startup.

Just tell OpenCode in plain language:

```text
Remember: this project uses Bun everywhere, not npm or yarn.
```

The plugin calls `memory_store` and replies with something like:

```text
已记住 (id=1) Bun 包管理约定
```

Optional minimal configuration goes in `~/.config/opencode/opencode-memory.jsonc`; tuple options take precedence:

```jsonc
{ "dbPath": "/Users/you/.local/share/opencode/memory/memory.db", "pinQuota": 8000 }
```

### Use the Headless Core

```bash
bun add @aifcoding/memory-core
```

```ts
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
const manager = createSqliteMemoryManager({ dbPath: '/tmp/memory.db' });
const memory = await manager.storeMemory({ title: 'Runtime', content: 'Use Bun.', summary: 'Use Bun', type: 'convention' });
console.log((await manager.recallMemories({ query: 'Bun' })).memories);
await manager.pinMemory({ id: memory.id, pinMode: 'summary' });
console.log((await manager.getPinnedContext()).text);
await manager.close();
```

Inject a custom tokenizer with `options.tokenizer`:

```ts
const tokenizer = { tokenize: (text: string) => text.toLowerCase().split(/\s+/u).join(' ') };
const manager = createSqliteMemoryManager({ dbPath: '/tmp/memory.db', tokenizer });
```

Tokenizers are part of the database index format; export and re-import data into a new database when changing one.
The `@aifcoding/memory-core/sqlite` entry uses `bun:sqlite` and still requires Bun.

### Run from source

Prerequisites: OpenCode, Bun, and Git.

```bash
git clone https://github.com/aifcoding/opencode-memory.git
cd opencode-memory
bun install
bun run build
```

Then register `packages/opencode/dist/plugin.js`.

## OpenCode adapter configuration

Configuration comes from `~/.config/opencode/opencode-memory.jsonc` (or `.json`), with `.jsonc` taking precedence. Plugin tuple options override the file and are strictly validated. Core does not read config files, XDG directories, or plugin options; the adapter passes parsed options to Core.

| Option | Type | Default | Description |
|---|---|---:|---|
| `dbPath` | `string` | `$HOME/.local/share/opencode/memory/memory.db` | Absolute SQLite path |
| `pinQuota` | `number` | `8000` | Total final-rendered character budget for pins |

## Usage examples

Complete OpenCode conversation examples and the 12-tool reference are in [`packages/opencode/README.md`](packages/opencode/README.md).

## How it works

### Text retrieval

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

### Pinned-memory injection

Pinned memories are appended to the end of messages through OpenCode's `experimental.chat.messages.transform` extension point:

- Injected as reference information only
- The injected block is marked as reference data with a hint to treat it as reference, not instruction; this is a model-facing hint, not a security boundary against prompt injection
- Not written into persistent message history
- Changes or unpins take effect on the next turn
- `summary` mode injects the summary; `full` mode injects the content
- New pins are rejected when the quota is exceeded

### Session compaction archiving

After `session.compacted`, the adapter extracts the summary and Core archives it idempotently by message ID in `session_summaries`.

### Data persistence

The database has four logical tables: `memories`, `session_summaries`, `session_kv`, and `db_migrations`, plus FTS5 virtual tables. SQLite uses WAL, a 5000 ms busy timeout, busy/locked retries, and transactional migrations.

## Architecture and repository structure

### Packages and dependency direction

```text
OpenCode adapter → MemoryManager → MemoryStore → SqliteMemoryStore
```

The dependency direction is one-way: `opencode → core`. The Core root entry does not load `bun:sqlite`; the `/sqlite` entry still requires Bun.

### Directory structure

```text
packages/core/       # domain / application / ports / retrieval / render / sqlite
packages/opencode/   # OpenCode adapter
examples/             # Core usage example
```

### Current boundaries

MCP, CLI, and vector retrieval are not implemented. Tokenizer identity persistence and compatibility detection are planned; automatic index rebuilding has not been decided.

## Data & privacy

- Memories live in the local SQLite file specified by `dbPath`
- The plugin itself needs no remote database or external search service
- Deleting the database file removes all long-term memories, episodic summaries, and session KV
- Back the database up locally, but never commit it to Git
- Do not store passwords, access tokens, private keys, or other secrets
- Storage, tokenization, and retrieval run locally; recalled or pinned memories enter the model context and may be sent to a remote provider if you use one

## Development and testing

Install dependencies:

```bash
bun install
```

Type-check:

```bash
bun run typecheck
```

Run tests:

```bash
bun test
```

Tests cover MemoryManager, storage CRUD, soft delete, deduplication, Chinese search, scope filtering, FTS sync, session KV, and the OpenCode adapter.

## Roadmap

See the current capability boundary above and the future direction in [`ROADMAP.md`](ROADMAP.md).

## Contributing

Issues and pull requests are welcome.

The project uses OpenSpec to maintain behavioral specs. Behavior changes should update the matching document:

| Document | Responsibility |
|---|---|
| OpenCode tool parameters | Zod definitions in [`packages/opencode/src/plugin.ts`](packages/opencode/src/plugin.ts) |
| Core API | [`packages/core/src/index.ts`](packages/core/src/index.ts) |
| Behavioral semantics | [`openspec/specs/`](openspec/specs/) |
| Architecture decisions | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

Recommended flow:

1. Fork the repo and create a feature branch
2. Add or update OpenSpec for behavior changes
3. Implement and test
4. Run `bun test`
5. Open a pull request explaining the motivation, behavior change, and verification

Keep the implementation, specs, and README tool arguments in sync. Tool interfaces are authoritative in [`plugin.ts`](packages/opencode/src/plugin.ts).

## License

Licensed under the [MIT License](LICENSE).

Copyright © 2026 [aifcoding](https://github.com/aifcoding)
