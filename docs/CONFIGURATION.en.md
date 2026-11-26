# opencode-memory configuration

This document covers the OpenCode adapter configuration. It mirrors
`docs/CONFIGURATION.md` (Chinese) for the fields that matter to users.

## Sources and priority

Later sources override earlier ones per field:

```text
built-in defaults
→ agent-memory.json / legacy opencode-memory.jsonc/.json (read-only compatibility)
→ agent-memory.jsonc
→ plugin options in opencode.jsonc
```

`options` override file values per field; the `recall` object is merged per field.

Config directory: `$XDG_CONFIG_HOME/opencode` or `$HOME/.config/opencode`.

## Generated on first load (never overwrites existing files)

- `agent-memory.jsonc`: default switches (auto capture/recall on, LLM extraction off), editable.
- `memory-capture.rules.md`: extraction-rules template.
- `memory.db`: SQLite database (created on first use).

## Full example (`~/.config/opencode/agent-memory.jsonc`)

```jsonc
{
  // Optional absolute SQLite path. Default:
  // $XDG_DATA_HOME/opencode/memory/memory.db
  "dbPath": "/Users/you/.local/share/opencode/memory/memory.db",

  // Total final-rendered character budget for pins
  "pinQuota": 8000,

  // Default budget for the manual memory_recall tool
  "recall": {
    "maxCharacters": 3000,
    "maxOverflowItems": 10,
    "maxOverflowCharacters": 1500
  },

  // Explicit memory instructions only
  "autoCapture": {
    "enabled": true,
    "mode": "on",            // on | shadow
    "maxWritesPerTurn": 3    // LLM/candidate path only; explicit saves are not capped
  },

  // Automatic recall injection
  "autoRecall": {
    "mode": "auto",          // off | hint | shadow | auto
    "maxItems": 3,
    "maxCharacters": 300
  },

  // LLM-assisted extraction (off by default; sends redacted material to a model)
  "capture": {
    "enabled": true,
    "onCompaction": true,
    "model": { "provider": "deepseek", "model": "deepseek-flash" },
    "instructionsFile": "/Users/you/.config/opencode/memory-capture.rules.md",
    "maxCandidates": 8,
    "autoApprove": false     // true: store extracted memories directly (trust=high)
  },

  "autoUpdate": true
}
```

## Fields

| Option | Type | Default | Purpose |
|---|---|---|---|
| `dbPath` | `string` | see above | Absolute SQLite path; relative paths fail at startup |
| `pinQuota` | `number` | `8000` | Pin rendering character budget |
| `recall.maxCharacters` | `number` | `3000` | Manual `memory_recall` body budget |
| `recall.maxOverflowItems` | `number` | `10` | Overflow navigation items |
| `recall.maxOverflowCharacters` | `number` | `1500` | Overflow character budget |
| `autoCapture.enabled` | `boolean` | `true` | Execute explicit memory instructions |
| `autoCapture.mode` | `'shadow' \| 'on'` | `'on'` | `on` writes; `shadow` diagnoses only. Use `enabled:false` to disable |
| `autoCapture.maxWritesPerTurn` | `number` | `3` | LLM/candidate writes per turn; explicit saves are not capped |
| `autoRecall.mode` | `'off' \| 'hint' \| 'shadow' \| 'auto'` | `'auto'` | `auto` retrieves and injects; `hint` only injects a fixed prompt |
| `autoRecall.maxItems` | `number` | `3` | Max injected memories (1..10) |
| `autoRecall.maxCharacters` | `number` | `300` | Injected block budget (50..1200, `auto` only) |
| `capture.enabled` | `boolean` | `false` | Enable LLM-assisted extraction |
| `capture.onCompaction` | `boolean` | `true` | Extract after compaction |
| `capture.model` | `object` | none | `{provider, model, variant?}`; host default when omitted; a configured but unavailable model fails |
| `capture.instructionsFile` | `string` | none | Absolute path to rules markdown; unreadable/empty/oversized fails |
| `capture.maxCandidates` | `number` | `8` | Max candidates per run (1..20) |
| `capture.autoApprove` | `boolean` | `false` | `true`: approve extracted candidates immediately (`trust=high`, recallable, marked verified, excluded from C1 auto-correction, pinnable). **Requires 2.5.0+**; 2.4.0 and earlier use a strict `capture` schema and reject the field |
| `autoUpdate` | `boolean` | `true` | Refresh the adapter cache at startup |

## TUI commands (generated on first load)

| Command | Tool | Purpose |
|---|---|---|
| `/memory-list` | `memory_ls` | List memories (id, type, title; newest first) |
| `/memory-candidates` | `memory_candidates` | List pending candidates |
| `/memory-review` | `memory_candidate_review` | Approve/reject one candidate at a time |
| `/memory-search` | `memory_recall` + `memory_read` | Search summaries; read full text by id |

Commands are prompts that ask the model to call these tools; each invocation costs one model turn.

## Explicit save syntax

Chinese: `记住：…`, `记一下：…`, `保存下来：…`.

English (strict, colon and body required):

```text
Remember: this project uses Bun for scripts.
Save to memory: the staging API is https://staging.example.com
Please remember: never commit to main.
```

Bare `remember …`, `note that …`, `keep in mind …` are ordinary conversation and are **not** stored.
English natural-language corrections are not auto-applied; use `memory_update` by id.

## Behavior and limits

- Only explicit saves and explicit corrections are written by the rule layer; behavior rules require an explicit save.
- Explicit saves keep the body verbatim (code blocks, indentation, line breaks); no question/length quality gate.
- Same title with a different body creates a new uniquely titled entry instead of overwriting.
- Corrections require an explicit memory intent, a unique target and matching old value; they store the normalized new value.
- Implicit content is not captured by the rule layer; use LLM extraction or manual tools.
- Pending candidates never participate in recall; approval is the only path into `memories`.
- `capture.autoApprove=true` bypasses approval and stores directly with `trust=high`.
- Credential redaction is regex-based and does not detect every secret. Do not store credentials.
- Reasoning about memory requires reading it: recalled/pinned content enters the model context and may be sent to a remote model provider.

## Capture model and rules

- `capture.model` is required to pin a specific model; otherwise the host default is used. A configured but unavailable model fails instead of falling back.
- `capture.instructionsFile` replaces the bundled rules (no merge). The file is read on each run; its hash joins the idempotency key.
- Instructions are user rules first, program constraints last; program constraints win on conflict.
- Candidate titles/content/summary follow the source material language; they are not translated.

## Migration

- `capture.agent` and `capture.target.kind="agent"` fail at startup; use `capture.model`.
- `capture.target.kind="model"` maps to `capture.model`.
- Legacy `opencode-memory.jsonc/.json` remains readable; new files use `agent-memory.jsonc`.
