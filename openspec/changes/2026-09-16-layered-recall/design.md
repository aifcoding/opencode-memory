## Context

现有长期记忆已经包含 `title` / `summary` / `content`，本变更将其定义为 `L0 = title`、`L1 = title + summary`、`L2 = title + content`。

当前 Recall 的条数限制不能控制实际上下文长度。新的读路径使用两个相互独立的预算：

1. Detail Budget：控制 L1/L2。
2. Overflow Budget：控制预算外 L0 导航列表。

稳定 Ref 用于在 Core、OpenCode 和 MCP 之间统一表示实体，但首版仅保证同一数据库内稳定。

## Goals / Non-Goals

**Goals:** Recall 默认返回 Summary 而非全文；提供可预测、与模型无关的字符预算；详细结果保持 BM25 score 连续前缀；预算外候选仍可通过轻量 L0 发现；提供同库稳定的 Memory Ref；OpenCode 和 MCP 使用相同的 Core 读路径；保持零数据库迁移。

**Non-Goals:** 不保留旧 Recall 结果；不自动生成 Summary；不计算模型 Token；不做跨库 UUID；不做 D15、向量检索或 Recall 评测；不在 MCP 中暴露通用 Ref Resolver。

## Decisions

### D-READ.1 Recall 只有一条返回路径

`recallMemories` 始终返回投影结果、Overflow 和预算元数据。未提供 Projection 时默认 `summary`；完整正文只能通过 `projection=full` / `readMemory` / `readReference` 获取。不实现泛型返回类型、重载或旧结果分支。

### D-READ.2 Projection

`MemoryProjection = "title" | "summary" | "full"`；`SummarySource = "stored" | "content_preview"`。title→L0（标题+元数据）；summary→L1（标题+摘要+元数据）；full→L2（标题+摘要+正文+元数据）。

### D-READ.3 Summary 回退

`DEFAULT_SUMMARY_FALLBACK_CHARACTERS = 200`。summary 非空 → `stored`；为空 → 正文前 200 字符 `content_preview`。回退不写数据库、不修改 MemoryEntry、不调模型。

### D-READ.4 Recall Budget

```ts
interface RecallBudget {
  maxCharacters: number;       // 1..20000
  preferSummary: boolean;      // 默认 true
  maxOverflowItems: number;    // 0..20，默认 10
  maxOverflowCharacters: number; // 0..10000，默认 1500
}
type RecallBudgetInput = Partial<RecallBudget>;
const DEFAULT_RECALL_BUDGET = { maxCharacters: 3000, preferSummary: true, maxOverflowItems: 10, maxOverflowCharacters: 1500 };
```

字符数按 JS `string.length`（UTF-16 code unit），不代表模型 Token。

### D-READ.5 ProjectedMemory

`RecallMemoryBase`（id/ref/title/type/tags/origin/trust/scope/createdAt/updatedAt）+ `TitleMemoryProjection` / `SummaryMemoryProjection`（+summary/summarySource）/ `FullMemoryProjection`（+summary/content）+ `ProjectedMemoryRecallItem`（memory/score/characterCount）。投影不暴露 embedding/embedModel/embedDim/contentHash/revision/deletedAt/pinnedAt/pinMode。

### D-READ.6 Overflow

`RecallOverflowItem = { projection: "title"; id; ref; title; trust; score }`。score 仅表示当前 BM25 查询相对相关度，不得跨查询比较。不含正文/摘要/tags/embedding/内部字段。

### D-READ.7 Recall API

`RecallMemoriesInput { query; scope?; limit?; projection?; budget? }`；`RecallMemoriesResult { memories; overflow; requestedProjection; consideredCount; usedCharacters; overflowUsedCharacters; truncated; degradedCount; omittedCount }`。恒等关系 `consideredCount === memories.length + overflow.length + omittedCount`；降级项仍属 memories。

### D-READ.8 Detail Budget Text

`detailText`: title→title；summary→`title\nsummary`；full→`title\ncontent`。相邻 Detail 条目间计 `\n\n`（2 字符）；单条 characterCount = text.length。

### D-READ.9 Overflow Budget Text

`overflowText(item) = "[id=..] ref title trust=.. score=.."`。相邻 Overflow 条目间计 `\n`（1 字符）。Core Budget 不含 Adapter 的 XML/JSON/协议开销。

### D-READ.10 两阶段算法

**阶段一（Detail Prefix）**：按 score 降序逐条——投影 → 计算加入后总长 → ≤ 预算加入；超额且 full+preferSummary=true → 降级 summary 重试；仍超额 → truncated=true、记录 overflowStartIndex、break。规则：连续前缀不跳过；等于预算允许、大于才停；full 可降 summary、summary 不降 title；首条放不下 → overflowStartIndex=0。

**阶段二（Overflow）**：从 overflowStartIndex 起逐条转 `RecallOverflowItem`（含 score），受 `maxOverflowItems` 和 `maxOverflowCharacters` 双预算，保持连续前缀不跳过。

最终：`omittedCount = hits.length - memories.length - overflow.length`。

### D-READ.11 边界语义

- 首条放不下 → `memories=[]`、overflow 收首条及后续、`truncated=true`
- `truncated=true` = 至少一个 considered hit 因 Detail Budget 未按详细路径返回；即使全部剩余进 overflow 仍为 true
- `omittedCount` = Detail 和 Overflow 都没进的
- limit 只决定 Store 取回数，不触发 truncated、不增 omittedCount
- 空结果：全空/全 0/truncated=false

### D-READ.12~13 Memory Ref 与解析

格式 `memory://local/memories/{正整数}` / `summaries/{percent-encoded}` / `candidates/{正整数}`。`memoryRef(id)` / `summaryRef(id)`（encodeURIComponent）/ `candidateRef(id)` / `parseMemoryReference(ref)`。校验：scheme=`memory:`、host=`local`、无 username/password/port/query/fragment、路径严格两段、kind 合法、ID 正整数/非空、无前后空白。`InvalidMemoryReferenceError extends MemoryValidationError`（code=`INVALID_MEMORY_REFERENCE`），错误不回显完整 Ref。Ref 为计算值，不写库。

### D-READ.14 readReference

`{ ref; scope? }` → `found{reference,value} | not_found | deleted | unsupported`。Memory/Candidate 走 Scope 校验；Summary 按全局唯一 ID 读；Store 不支持 → unsupported；非法 Ref 抛错。

### D-READ.15 Storage 端口

`MemoryStore.getSummary?(id: string): SummaryEntry | null`。SQLite 按 `session_summaries.id` 主键，不新增索引。

### D-READ.16 Summary Ref Scope 限制

session_summaries 无 scope/scope_key：`scope` 不用于 Summary 授权；返回 contextKey 由 Adapter 决定展示；MCP 不暴露通用 readReference；Summary Scope 留独立 change。

### D-READ.17 OpenCode Recall 配置

`opencode-memory.jsonc` 加 `recall: { maxCharacters(默认3000,1..20000), maxOverflowItems(默认10,0..20), maxOverflowCharacters(默认1500,0..10000) }`。不暴露 preferSummary（memory_recall 固定 summary）。优先级：Plugin Tuple Options → opencode-memory.jsonc → Core 默认值。

### D-READ.18 OpenCode Adapter

`memory_recall` 参数 `{ query; maxCharacters? }`（1..20000，覆盖单次 Detail Budget）。固定 projection=summary + preferSummary=true。输出：Detail（Ref/ID/标题/摘要或预览）+ Overflow（id/ref/title/trust/score）+ truncated/omitted 提示 + Score 说明（仅当前查询相对排序）。`memory_read({id})` 不变返回全文。

### D-READ.19 MCP Recall 配置

`memory-mcp.jsonc` 加相同 recall 配置节。`memory_search.maxCharacters` 只覆盖本次 Detail Budget，Overflow 预算由 Server 配置控制。

### D-READ.20 MCP Adapter

`memory_search` 输入 `{ query; limit?; maxCharacters? }`，固定 summary。Search Item 保留 preview，新增 `ref` + `previewSource`。structuredContent 保持 data 为 Detail 数组，新增可选 `meta: { consideredCount, usedCharacters, overflowUsedCharacters, truncated, degradedCount, omittedCount, overflow }`。MCP output Schema 必须允许 meta。`memory_read` 不变。不注册 `memory_reference_read`。

### D-READ.21 配置文档

新增 `docs/CONFIGURATION.md`：配置来源与优先级、Core Recall 默认值、OpenCode/MCP 全字段、字符预算与 Token 区别、Overflow 双预算、Ref 同库稳定边界、Summary 无 Scope 限制、数据库/Tokenizer/版本兼容。

### D-READ.22 零迁移

不修改 memories/session_summaries/session_kv/memory_capture_runs/memory_candidates/FTS/db_migrations。数据库重开后相同实体 ID 生成相同 Ref。

### D-READ.23 跨库 Ref 延后

首版只保证同库稳定。跨库需 database identity + entity UUID，未来格式 `memory://{database-id}/memories/{uid}`，本版不预留。

## Risks / Trade-offs

- 默认 Summary 破坏旧调用方，但当前无需兼容，换单一 API + 更低复杂度
- 字符预算 ≠ Token 预算，但稳定、无模型依赖
- Detail 连续前缀可能因一条高分长记忆提前停止，但 Overflow 仍提供后续 L0 导航
- Overflow 增加少量上下文成本 → 独立条数+字符硬上限
- Score 仅当前查询有意义，工具文档禁止跨查询比较
- Summary Preview 可能截断语义，全文仍可按需读
- Summary Ref 无 Scope → 不通过 MCP 通用暴露
- 计算型 Ref 不跨库稳定，但避免 UUID + 迁移成本

## Migration Plan

1. 原子更新 Core、OpenCode、MCP 和全部测试
2. 删除旧 Recall 返回类型及调用方式
3. 实现 Projection、Budget 和 Overflow
4. 实现 Ref、Parser、getSummary 和 readReference
5. 增加两个 Adapter 的 recall 配置
6. 更新 OpenCode 和 MCP 读路径
7. 新增 docs/CONFIGURATION.md
8. 完成 Core、真实 OpenCode、真实 MCP 和 tarball 验证
9. 按 Core → OpenCode → MCP 顺序发布
10. 数据库无需迁移或回滚

## Open Questions

无待拍板产品决策。实施前需验证：① 当前 score 保持"越高越相关" ② MCP output Schema 支持可选 meta ③ Summary ID 可无损 encode/decode ④ Adapter 围栏开销不计入 Core Budget 但仍需最终输出保护。
