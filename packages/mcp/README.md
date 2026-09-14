# @aifcoding/memory-mcp

A local MCP adapter for [`@aifcoding/memory-core`](https://github.com/aifcoding/opencode-memory).

It exposes a fixed project scope to MCP clients such as Claude Code, Cursor, Hermes, and other compatible hosts. The default profile is read-only.

- Official MCP TypeScript SDK v2
- Local stdio transport
- Fixed project scope
- Structured results with text fallback
- Read-only and full profiles
- No HTTP/SSE in the current release

## Requirements

- [Bun](https://bun.sh/)
- An MCP-compatible client
- A local SQLite database managed by `@aifcoding/memory-core`

The SQLite implementation requires Bun because it uses `bun:sqlite`.

## Installation

Install globally:

```bash
bun add --global @aifcoding/memory-mcp
```

Start it with:

```bash
memory-mcp --config "/absolute/path/memory-mcp.jsonc"
```

It can also be run through `bunx`:

```bash
bunx @aifcoding/memory-mcp \
  --config "/absolute/path/memory-mcp.jsonc"
```

Pinning the package version is recommended when multiple adapters share the same database.

## Configuration

The default configuration path is:

```text
$XDG_CONFIG_HOME/aifcoding/memory-mcp.jsonc
```

If `XDG_CONFIG_HOME` is not set:

```text
$HOME/.config/aifcoding/memory-mcp.jsonc
```

Minimal read-only configuration:

```jsonc
{
  "dbPath": "/absolute/path/memory.db",

  "scope": {
    "scope": "project",
    "scopeKey": "/absolute/project"
  },

  "profile": "readonly",

  "transport": {
    "type": "stdio"
  }
}
```

Full configuration:

```jsonc
{
  "dbPath": "/absolute/path/memory.db",

  "scope": {
    "scope": "project",
    "scopeKey": "/absolute/project"
  },

  "profile": "full",

  "transport": {
    "type": "stdio"
  },

  "pinQuota": 8000,
  "writeTrust": "low",
  "allowCandidateReview": false,

  "limits": {
    "defaultLimit": 10,
    "maxLimit": 50,
    "previewLength": 500
  }
}
```

| Option | Type | Default | Description |
|---|---|---:|---|
| `dbPath` | absolute path | required | SQLite database path |
| `scope.scope` | `"project"` | required | The first release only supports a fixed project scope |
| `scope.scopeKey` | non-empty string | required | Stable project identity shared by all callers |
| `profile` | `"readonly" \| "full"` | `"readonly"` | Tool permission profile |
| `transport.type` | `"stdio"` | `"stdio"` | The current release only supports stdio |
| `pinQuota` | positive integer | `8000` | Rendered-character quota for pinned memories |
| `writeTrust` | `"low" \| "high"` | `"low"` | Trust assigned to direct MCP writes |
| `allowCandidateReview` | boolean | `false` | Allow an MCP client to approve or reject candidates |
| `limits.defaultLimit` | integer, 1–50 | `10` | Default search/list result count |
| `limits.maxLimit` | integer, 1–50 | `50` | Maximum search/list result count |
| `limits.previewLength` | integer, 1–5000 | `500` | Maximum preview length |

Configuration is strictly validated. Unknown fields, relative database paths, and missing project scopes fail startup.

## Fixed project scope

Scope is a server-side security boundary.

The server binds one configured scope at startup:

```json
{
  "scope": {
    "scope": "project",
    "scopeKey": "/absolute/project"
  }
}
```

MCP tools do not accept `scope`, `scopeKey`, `dbPath`, or `projectRoot`. A client therefore cannot switch projects or enumerate another scope through tool arguments.

The server follows this model:

```text
one MCP process
→ one fixed project scope
→ one local database
```

The first release does not automatically derive project identity from the working directory. Use the same stable `scopeKey` for every adapter that should share project memories.

> The current OpenCode adapter may still use `global/default`. Project-scoped MCP tools only see entries stored under the configured project scope; they do not automatically migrate or expose `global/default` memories.

## Profiles

### readonly

This is the default and recommended profile for external Agents such as Hermes.

It exposes:

```text
memory_search
memory_read
memory_list
```

No write, delete, Pin, or candidate tool is registered. Unauthorized tools do not appear in `tools/list`.

`readonly` means **MCP tool permissions are read-only**. It is not a filesystem-level SQLite read-only mode. Opening the database may still run compatible migrations or create SQLite WAL/SHM files.

### full

The full profile additionally exposes:

```text
memory_store
memory_forget
memory_pin
memory_unpin
memory_pins
memory_candidate_list
memory_candidate_read
```

`memory_candidate_review` is registered only when:

```json
{
  "profile": "full",
  "allowCandidateReview": true
}
```

Direct MCP writes always use:

```text
scope  = configured server scope
origin = agent
trust  = configured writeTrust
```

Clients cannot override these fields.

`writeTrust` defaults to `low`. Low-trust memories cannot be pinned. Set it to `high` only for a trusted MCP client and configuration.

## Tool reference

### Read-only tools

#### `memory_search`

Search formal memories in the fixed scope.

Input:

```ts
{
  query: string;
  limit?: number;
}
```

Output items contain:

```text
id
title
preview
type
tags
origin
trust
score
scope
updatedAt
```

Search returns a preview rather than the full body. Use `memory_read` for the complete content.

#### `memory_read`

Read one formal memory.

Input:

```ts
{
  id: number;
}
```

Possible states:

```text
found
not_found
deleted
```

#### `memory_list`

List formal memory metadata, most recently updated first.

Input:

```ts
{
  type?: "preference" | "fact" | "decision" | "solution" | "convention";
  limit?: number;
}
```

The list does not expose full content, embeddings, or content hashes.

### Full-profile tools

#### `memory_store`

Store a formal memory in the fixed scope.

```ts
{
  title: string;       // max 200
  content: string;     // max 50000
  summary?: string;    // max 500
  type?: "preference" | "fact" | "decision" | "solution" | "convention";
  tags?: string[];     // max 20, each max 100
}
```

The client cannot provide scope, origin, trust, embedding, or Pin metadata.

#### `memory_forget`

Soft-delete a formal memory.

```ts
{
  id: number;
}
```

#### `memory_pin`

Pin a high-trust formal memory.

```ts
{
  id: number;
  pinMode?: "full" | "summary";
  summary?: string;
}
```

Possible states include:

```text
pinned
quota_exceeded
summary_required
trust_denied
not_found
deleted
```

#### `memory_unpin`

```ts
{
  id: number;
}
```

#### `memory_pins`

List pinned-memory metadata in the fixed scope.

Input:

```ts
{}
```

### Candidate tools

Candidate tools require a Core version with Safe Assisted Memory Capture support.

#### `memory_candidate_list`

```ts
{
  status?: "pending" | "approved" | "rejected";
  suggestedDomain?: "code" | "user" | "business" | "uncertain";
  limit?: number;
}
```

Returns public candidate metadata and a content preview.

#### `memory_candidate_read`

```ts
{
  id: number;
}
```

Reads one candidate in the fixed scope.

#### `memory_candidate_review`

```ts
{
  id: number;
  decision: "approve" | "reject";
}
```

This tool is disabled by default, even in the full profile. Enable it only for clients whose tool calls receive appropriate human review.

Approving a candidate creates or links a formal memory but never pins it automatically.

## Result format

Tools return both MCP `structuredContent` and a text fallback.

Successful structured results use:

```ts
{
  schemaVersion: 1;
  kind: string;
  notice: string;
  scope: {
    scope: "project";
    scopeKey: string;
  };
  data: unknown;
}
```

Text results are wrapped as historical reference data:

```xml
<memory-context source="mcp">
Historical memory reference data; verify against current sources.

...
</memory-context>
```

Memory text is escaped so it cannot close or forge the outer fence.

Errors use:

```ts
{
  schemaVersion: 1,
  ok: false,
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

Internal errors do not expose SQL, stack traces, database contents, or full configuration.

## MCP host configuration

The following is a common MCP host configuration shape. Exact field names may vary by client.

```json
{
  "mcpServers": {
    "opencode-memory": {
      "command": "memory-mcp",
      "args": ["--config", "/absolute/path/memory-mcp.jsonc"]
    }
  }
}
```

Using `bunx`:

```json
{
  "mcpServers": {
    "opencode-memory": {
      "command": "bunx",
      "args": ["@aifcoding/memory-mcp", "--config", "/absolute/path/memory-mcp.jsonc"]
    }
  }
}
```

Use an absolute config path because MCP hosts usually start commands without shell path expansion.

## Current boundaries

The first release:

- supports stdio only
- does not provide Streamable HTTP or legacy SSE
- does not expose episodic summaries
- does not expose Context KV
- does not invoke a Capture Agent
- does not provide MCP Resources or Prompts
- does not implement multi-project routing
- does not implement filesystem-level read-only SQLite
- does not implement TeamKbSource or vector-search controls

If multiple adapters share the same database, keep their `@aifcoding/memory-core` versions Schema-compatible. Pinning the MCP package version is recommended.

---

## 简体中文

`@aifcoding/memory-mcp` 将 `@aifcoding/memory-core` 的正式记忆能力通过标准 MCP 协议暴露给 Claude Code、Cursor、Hermes 等客户端。

首版特点：

- 官方 MCP SDK v2
- 仅支持本地 stdio
- 默认 readonly Profile
- Server 固定 project Scope
- 客户端不能传入或覆盖 Scope
- 同时返回 structuredContent 和带围栏的文本结果

最小配置：

```jsonc
{
  "dbPath": "/absolute/path/memory.db",
  "scope": {
    "scope": "project",
    "scopeKey": "/absolute/project"
  },
  "profile": "readonly",
  "transport": {
    "type": "stdio"
  }
}
```

启动：

```bash
memory-mcp --config "/absolute/path/memory-mcp.jsonc"
```

readonly 只提供：

```text
memory_search
memory_read
memory_list
```

full 额外提供写入、软删除、Pin 和候选读取工具。候选审批还必须显式设置：

```jsonc
{
  "allowCandidateReview": true
}
```

readonly 只表示 MCP 工具权限只读，不代表 SQLite 文件以只读模式打开。详细英文说明见上文。
