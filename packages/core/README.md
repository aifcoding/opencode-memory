# @aifcoding/memory-core

[简体中文](#中文) | [English](#english)

## 中文

框架无关的本地 AI 记忆内核，提供异步 `MemoryManager`、检索、Pin 和结构化领域 API。

### 安装与入口

```bash
bun add @aifcoding/memory-core
```

根入口 `@aifcoding/memory-core` 提供类型、Manager 和默认 Tokenizer，不加载 `bun:sqlite`。SQLite 实现从 `@aifcoding/memory-core/sqlite` 导入：

```ts
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
const manager = createSqliteMemoryManager({ dbPath: '/tmp/memory.db' });
```

`/sqlite` 使用 `bun:sqlite`，因此要求 Bun 运行时。

### MemoryManager API

| 能力 | 方法 |
|---|---|
| 长期记忆 | `storeMemory`、`recallMemories`、`listMemories`、`readMemory`、`forgetMemory` |
| Pin | `pinMemory`、`unpinMemory`、`listPinnedMemories`、`getPinnedContext` |
| 情景摘要 | `archiveSummary`、`recallSummaries` |
| Context KV | `setContextValue`、`getContextValue`、`listContextValues`、`deleteContextValue` |
| 生命周期 | `close` |

方法使用对象参数并返回 Promise。`MemoryManagerOptions` 支持 `defaultScope`（默认 `global/default`）、`pinQuota`（默认 8000 字符）、`defaultOrigin` 和 `defaultTrust`。

`PinResult` 会区分 `pinned`、`quota_exceeded`、`summary_required`、`trust_denied`、`not_found` 和 `deleted`。`getPinnedContext` 返回 `{ entries, text, size }`。

### 分层 Recall

`recallMemories` 统一返回投影结果，默认 `summary`（标题+摘要）；只有显式 `projection: 'full'` 或 `readMemory/readReference` 才返回完整正文。没有已保存摘要时，summary 回退正文前 200 字符（`summarySource=content_preview`，不改库）。

字符预算（可部分覆盖，其余用默认值）：

```ts
{
  maxCharacters: 3000,         // Detail 标题/摘要预算（1..20000）
  preferSummary: true,         // full 放不下时降级 summary
  maxOverflowItems: 10,        // 溢出导航最多条数（0..20，0=关闭）
  maxOverflowCharacters: 1500, // 溢出导航字符预算（0..10000）
}
```

结果：`memories`（预算内 Detail）+ `overflow`（预算外 L0 导航：id/ref/title/trust/score）+ `consideredCount/usedCharacters/overflowUsedCharacters/truncated/degradedCount/omittedCount`。score 是本次 FTS5/BM25 相对相关度，不可跨查询比较。字符数按 UTF-16 `string.length`，不等于 Token。

### Memory Ref

`memory://local/memories/{id}` / `summaries/{encoded-id}` / `candidates/{id}`。`memoryRef/summaryRef/candidateRef` 生成、`parseMemoryReference` 严格解析。只保证同一数据库内稳定。

### readReference

`readReference({ref, scope})` → `found/not_found/deleted/unsupported`。Memory/Candidate 走 Scope 校验；Summary 当前无 Scope、按全局唯一 ID 读；MCP 不暴露通用 readReference。

### Scope 与 contextKey

长期知识使用显式 `ScopeRef`（`scope` + `scopeKey`），或使用 `defaultScope`；Context KV 必须显式提供 `contextKey`，Core 不会推断它。

### 自定义 Tokenizer

默认使用 `jieba-wasm`；可注入实现 `Tokenizer` 接口的自定义分词器：

```ts
import type { Tokenizer } from '@aifcoding/memory-core';
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';

const englishTokenizer: Tokenizer = {
  tokenize: (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' '),
};
const manager = createSqliteMemoryManager({ dbPath: '/tmp/memory.db', tokenizer: englishTokenizer });
```

Tokenizer 是数据库索引格式的一部分；已有数据库必须使用兼容 Tokenizer。当前没有自动索引重建接口，如需更换，请导出数据并用新数据库重新导入。

### MemoryStore 与错误

`MemoryStore` 是同步的低层扩展端口，负责存储原语、检索和事务一致性；`MemoryManager` 是异步公共边界，负责校验、默认值和结构化结果。`MemoryValidationError` 表示输入无效，`DuplicateMemoryError` 表示同一作用域中存在重复的未删除内容。

## English

`@aifcoding/memory-core` is a framework-independent local AI memory core. It provides an asynchronous `MemoryManager`, retrieval, Pin operations, and structured domain results.

### Installation and entry points

```bash
bun add @aifcoding/memory-core
```

The root entry provides types, `MemoryManager`, and the default tokenizer without loading `bun:sqlite`. Import the SQLite factory from `@aifcoding/memory-core/sqlite`; this subpath requires Bun.

### MemoryManager API

The main methods are `storeMemory`, `recallMemories`, `listMemories`, `readMemory`, `forgetMemory`, `pinMemory`, `unpinMemory`, `listPinnedMemories`, `getPinnedContext`, `archiveSummary`, `recallSummaries`, `setContextValue`, `getContextValue`, `listContextValues`, `deleteContextValue`, and `close`. All methods take object arguments and return Promises.

`MemoryManagerOptions` accepts `defaultScope` (default `global/default`), `pinQuota` (default 8000 characters), `defaultOrigin`, and `defaultTrust`. Long-term memories use an explicit `ScopeRef` or `defaultScope`; Context KV requires an explicit `contextKey`, which Core never infers.

Pin results include `pinned`, `quota_exceeded`, `summary_required`, `trust_denied`, `not_found`, and `deleted`. `getPinnedContext` returns `{ entries, text, size }`. `MemoryStore` is the synchronous low-level extension port; Manager is the asynchronous public boundary. `MemoryValidationError` reports invalid input and `DuplicateMemoryError` reports duplicate active content.

### Layered recall

`recallMemories` returns one unified projected result and defaults to the `summary` projection. Use `projection: "full"` or `readMemory` for full content. Default budget: `{ maxCharacters: 3000, preferSummary: true, maxOverflowItems: 10, maxOverflowCharacters: 1500 }`. Overflow entries contain `id/ref/title/trust/score`; scores are query-relative BM25 and must not be compared across queries. Character budgets use `string.length`, not model tokens.

### Memory references

`memory://local/memories/{id}` etc.; `parseMemoryReference` for strict parsing; `readReference` for resolution. Stable only within the same database. Summaries have no Scope, so MCP does not expose a generic reference tool.

### Capture API

The capture API consists of `beginCapture`, `completeCapture`, `failCapture`, `listMemoryCandidates`, `readMemoryCandidate`, and `reviewMemoryCandidate`. Candidates are isolated, default to `origin=agent`, `trust=low`, and `pending`, and never participate in recall or Pin before approval.

### Custom Tokenizer

The default tokenizer uses `jieba-wasm`. Inject any implementation of the `Tokenizer` interface through the SQLite factory:

```ts
import { createSqliteMemoryManager } from '@aifcoding/memory-core/sqlite';
import type { Tokenizer } from '@aifcoding/memory-core';

const tokenizer: Tokenizer = {
  tokenize: (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' '),
};
const manager = createSqliteMemoryManager({ dbPath: '/tmp/memory.db', tokenizer });
```

Tokenizers are part of the database index format. Existing databases require a compatible tokenizer; automatic index rebuilding is not provided. Export and re-import data into a new database when changing one.
