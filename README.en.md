# opencode-memory

[简体中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh/)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-plugin-4b32c3.svg)](https://opencode.ai/)

A local-first, framework-independent AI memory core with adapters. [OpenCode](https://opencode.ai/) is the first adapter.

It gives AI agents memory across three tiers — **long-term knowledge, episodic summaries, and session working memory** — each with its own lifecycle and retrieval strategy. The framework-independent API is provided by `@aifcoding/memory-core`; OpenCode is one adapter. The default implementation stores data in local SQLite; Chinese full-text search is powered by `jieba-wasm` and SQLite FTS5. No database server, no vector service, no external API.

![Memory plugin demo](docs/assets/memory-demo.gif)

*Save → recall in a new session → pin → inject every turn (real tool output)*

## Choose how to use it

| Goal | Package | Status |
|---|---|---|
| Add persistent memory to OpenCode | `@aifcoding/opencode-memory` | Implemented |
| Use the headless API from a Bun/TypeScript application | `@aifcoding/memory-core` | Implemented |
| Connect Claude Code, Cursor, Hermes, or another MCP client | `@aifcoding/memory-mcp` | Implemented, pending release |
| Use HTTP/SSE or a management CLI | Future capabilities | Planned, not implemented |

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
- **Layered recall**: returns title + summary (L1) by default, with a character budget; overflow candidates become a lightweight title-only navigation list, and full content is fetched on demand via `readMemory`.
- **Safe assisted capture (disabled by default)**: session-derived low-trust candidates require explicit approval before becoming formal memories; the plugin does not enforce human confirmation.
- **Automatic memory (OpenCode v2 only)**: by default, rule-matched user input is stored as low-trust long-term memory, and relevant summaries are retrieved, filtered, and injected automatically. `hint` mode only injects a fixed retrieval prompt; it does not automatically retrieve summaries.

## Quick start

### Use the OpenCode adapter

The same package supports OpenCode v1 and v2.

**v1 (1.18.29+)** uses `plugin`:

```jsonc
{
  "plugin": ["@aifcoding/opencode-memory"]
}
```

**v2 (2.x)** uses `plugins`:

```jsonc
{
  "plugins": [{ "package": "@aifcoding/opencode-memory" }]
}
```

v1 uses the object entrypoint's `server()`; v2 uses `setup(ctx)`. Tools, Pin, capture, and compaction archive work in both. v2 has no TUI toast; auto-update messages go to the server log, and local plugin paths must be directories.

OpenCode installs and caches npm plugins with Bun at startup.

Just tell OpenCode in plain language:

```text
Remember: this project uses Bun everywhere, not npm or yarn.
```

The model may call `memory_store`; an example reply:

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

After building, v1 uses `packages/opencode/dist/plugin.js`. For v2, local plugin configuration must point to the `packages/opencode` package directory, not that JS file.

#### Safe assisted memory capture (optional)

Safe assisted capture is disabled by default. Configure it with:

```jsonc
{
  "capture": {
    "enabled": true,
    "onCompaction": true,
    "agent": "memory-extractor",
    "maxCandidates": 8
  }
}
```

It can run after successful compaction archival or through explicit `memory_capture`. Candidates use `origin=agent`, `trust=low`, and `status=pending`, then go through `memory_candidates`, `memory_candidate_read`, and `memory_candidate_review`. `suggestedDomain` means code: OpenCode approval; user: personal Agent; business: business Agent; uncertain: user decides. Extraction uses an empty Session and deterministic credential, bidi, and invisible-Unicode scans.

## OpenCode adapter configuration

Configuration comes from `~/.config/opencode/opencode-memory.jsonc` (or `.json`), with `.jsonc` taking precedence. Plugin tuple options override the file and are strictly validated. Core does not read config files, XDG directories, or plugin options; the adapter passes parsed options to Core.

| Option | Type | Default | Description |
|---|---|---:|---|
| `dbPath` | `string` | `$HOME/.local/share/opencode/memory/memory.db` | Absolute SQLite path |
| `pinQuota` | `number` | `8000` | Total final-rendered character budget for pins |
| `autoUpdate` | `boolean` | `true` | Check and refresh this adapter's OpenCode cache at startup; restart to apply |
| `capture.enabled` | `boolean` | `false` | Enable safe assisted memory capture |
| `capture.onCompaction` | `boolean` | `true` | Trigger after successful compaction archival when enabled |
| `capture.agent` | `string` | none | Extractor agent; required when enabled |
| `capture.maxCandidates` | `number` | `8` | Maximum candidates per run (1..20) |
| `autoCapture.enabled` | `boolean` | `true` | Write high-confidence signals as low-trust memories |
| `autoCapture.mode` | `'on' \| 'shadow'` | `'on'` | `shadow` generates candidates without writing; it still advances the session cursor and records no decisions |
| `autoCapture.maxWritesPerTurn` | `number` | `3` | Maximum writes per turn (0..10) |
| `autoRecall.mode` | `'off' \| 'hint' \| 'shadow' \| 'auto'` | `'auto'` | `auto` retrieves and injects summaries; `hint` injects only a fixed retrieval rule |
| `autoRecall.maxItems` | `number` | `3` | Maximum injected memories (1..10) |
| `autoRecall.maxCharacters` | `number` | `300` | Character budget for the injected block (50..1200, fences included); applies to `auto` only, `hint` is a fixed prompt |

Capture adds model cost and processes session content. It is disabled by default; candidates do not participate in recall, Pin, or injection before approval.

`capture` and `autoCapture` are independent paths. `capture` is disabled by default and creates pending `memory_candidates` for approval. In v2, `autoCapture` is enabled by default and writes directly to `memories` without candidate approval; these entries can immediately participate in retrieval and automatic recall, while remaining marked `origin=agent`, `trust=low`. Credential filtering only rejects input matching the implemented rules; it cannot detect every secret. Do not enter or store credentials. Automatically recalled content may be sent to your model provider when using a remote model.

To disable automatic memory (this does not affect separately configured `capture`):

```jsonc
{
  "autoCapture": { "enabled": false },
  "autoRecall": { "mode": "off" }
}
```

`autoCapture` and `autoRecall` replace their objects rather than merging individual fields; omitted fields use code defaults.

## Usage examples

Complete OpenCode conversation examples and the tool reference are in [`packages/opencode/README.md`](packages/opencode/README.md).

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

Pinned memories are appended to the end of messages through v1 `experimental.chat.messages.transform` or v2 `session.hook("context")`:

- Injected as reference information only
- The injected block is marked as reference data with a hint to treat it as reference, not instruction; this is a model-facing hint, not a security boundary against prompt injection
- Not written into persistent message history
- Changes or unpins take effect on the next turn
- `summary` mode injects the summary; `full` mode injects the content
- New pins are rejected when the quota is exceeded

### Automatic memory (v2)

> These features are available as the pre-release `@aifcoding/opencode-memory@2.3.0-rc.2` (npm `next` tag, requires `@aifcoding/memory-core@0.4.0`); `latest` is still `2.2.2`, which does not include them.

On every model request, v2 runs one automatic memory pass:

1. **Capture**: extracts only from the last message recognized as genuine user input. Assistant text only assists Q&A detection; final assistant replies are not archived. Detects five signal kinds (explicit, correction, Q&A, structured values, decisions/negations) and writes `memories` with `origin=agent` and `trust=low`.
2. **Recall**: defaults to `auto` and always uses `global/default`; FTS plus title-keyword admission (English word boundaries, generic-term filtering) produces a summary block. `hint` injects only a fixed retrieval prompt. The cache is keyed by user message plus the latest tool result.
3. **Isolation**: the automatic-memory call has an outer error handler; capture and recall are separately wrapped, but the Pin transform sits outside it. Injected content is not persisted.

Limitations: the cursor deduplicates by user-text hash, so later identical input may be skipped; at most the first 3 sentence segments are considered; a correction without a title match overwrites the latest agent/low memory and may target a different entity; rules primarily target Chinese and are not quality-calibrated; user-authored memories are never overwritten; credential filtering only rejects rule matches and is not a complete guarantee; v1 does not enable this.

### Session compaction archiving

After v1 `session.compacted` or v2 `session.compaction.ended`, the adapter extracts the summary and Core archives it idempotently by message ID in `session_summaries`. Automatic capture and recall are enabled only in v2.

### Data persistence

The database has six ordinary tables: `memories`, `session_summaries`, `session_kv`, `db_migrations`, `memory_capture_runs`, and `memory_candidates`, plus FTS5 virtual tables for formal memories and summaries. Candidates are not indexed in FTS. SQLite uses WAL, a 5000 ms busy timeout, busy/locked retries, and transactional migrations.

## Architecture and repository structure

### Packages and dependency direction

```text
OpenCode Adapter ─┐
                  ├─→ MemoryManager → MemoryStore → SqliteMemoryStore
MCP Adapter ──────┘
```

Dependencies remain one-way:

```text
@aifcoding/opencode-memory → @aifcoding/memory-core
@aifcoding/memory-mcp      → @aifcoding/memory-core
```

Core does not depend on OpenCode or the MCP SDK; the Core root entry does not load `bun:sqlite`, and the `/sqlite` entry still requires Bun.

The MCP adapter uses the official MCP SDK v2 and exposes a fixed project scope over stdio. Its default readonly profile only registers `memory_search`, `memory_read`, and `memory_list`.

### Directory structure

```text
packages/core/       # Domain API, MemoryStore, SQLite, retrieval, and Capture
packages/opencode/   # OpenCode adapter
packages/mcp/        # MCP stdio adapter
examples/            # Core usage example
```

### Current boundaries

- The first MCP release supports stdio only; Streamable HTTP and legacy SSE are not implemented. One MCP process binds one fixed project scope.
- MCP readonly is a tool-permission profile, not filesystem-level SQLite read-only mode.
- The OpenCode adapter may still use `global/default`; project-scoped MCP tools do not automatically migrate or read other scopes.
- Vector retrieval, TeamKbSource, automatic project identity, HTTP remote access, and a CLI are not implemented.
- Tokenizer identity persistence and compatibility detection are planned; automatic index rebuilding has not been decided.
- The capture golden set currently has 20 samples and uses a deterministic extractor, so it is only a deterministic pipeline self-test, not real-model quality.

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
| OpenCode tool parameters | Zod definitions in [`packages/opencode/src/plugin-v1.ts`](packages/opencode/src/plugin-v1.ts) |
| Core API | [`packages/core/src/index.ts`](packages/core/src/index.ts) |
| Behavioral semantics | [`openspec/specs/`](openspec/specs/) |
| Architecture decisions | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

Recommended flow:

1. Fork the repo and create a feature branch
2. Add or update OpenSpec for behavior changes
3. Implement and test
4. Run `bun test`
5. Open a pull request explaining the motivation, behavior change, and verification

Keep the implementation, specs, and README tool arguments in sync. Tool interfaces are authoritative in [`plugin-v1.ts`](packages/opencode/src/plugin-v1.ts).

## License

Licensed under the [MIT License](LICENSE).

Copyright © 2026 [aifcoding](https://github.com/aifcoding)
