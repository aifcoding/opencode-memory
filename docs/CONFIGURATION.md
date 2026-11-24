# opencode-memory 配置说明

本文档统一说明：

- Core API 的 Recall 默认值
- OpenCode Adapter 配置
- MCP Adapter 配置
- Memory Ref 边界
- 数据库、迁移、安全与隐私

## 1. 配置来源与优先级

### Core

`@aifcoding/memory-core` 不读取配置文件或环境目录。调用方通过 API 传入配置：

```ts
const result = await manager.recallMemories({
  query: "context",
  projection: "summary",
  budget: {
    maxCharacters: 3000,
    maxOverflowItems: 10,
  },
});
```

未提供的 Recall Budget 字段使用 Core 默认值。

### OpenCode Adapter

配置来源：

```text
Plugin Tuple Options
→ opencode-memory.jsonc
→ opencode-memory.json
→ 默认值
```

Tuple Options 按字段覆盖文件中的 `recall` 配置。

默认配置目录：

```text
$XDG_CONFIG_HOME/opencode
```

未设置 `XDG_CONFIG_HOME` 时：

```text
$HOME/.config/opencode
```

#### 自动记忆（v2）

> 本地源码为 `2.4.0-rc.1`（未发布，依赖 `memory-core@0.5.0`）；npm `next` 仍是 `2.3.0-rc.2`（旧采集行为），`latest` 为 `2.2.2`。

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `autoCapture.enabled` | `boolean` | `true` | 是否启用自动采集（按准入矩阵写入或落候选） |
| `autoCapture.mode` | `'off' \| 'shadow' \| 'on'` | `'on'` | `on` 按矩阵直写 + 落候选；`shadow` 只计算不写任何表，仍推进会话游标；`off` 等价于 `enabled=false` |
| `autoCapture.maxWritesPerTurn` | `number` | `3` | 单条消息最多写入条数，直写与候选合计（0..10，超大值按 3 截断） |
| `autoRecall.mode` | `'off' \| 'hint' \| 'shadow' \| 'auto'` | `'auto'` | `auto` 检索并注入摘要；`hint` 只注入固定检索提示；`shadow` 不检索不注入，无决策记录 |
| `autoRecall.maxItems` | `number` | `3` | 单次最多注入条数（1..10） |
| `autoRecall.maxCharacters` | `number` | `300` | 注入块字符上限（50..1200，含围栏与说明）；仅 `auto` 模式，`hint` 固定提示约 143 字符不受此限制 |

行为与限制：

- 准入矩阵（v1，规则编号见 `openspec/changes/2026-11-24-auto-memory-loop/admission-rules.md`）：E1 明确保存、S1 完整配置绑定、D1 明确选型 → 直写 `memories`（`origin=agent`、`trust=low`）；E2/S2/D2/C2 → 写 `memory_candidates` 待审批；C1 仅在唯一匹配 `agent/low` 且旧值相符时 CAS 更新；Q（纯问答对）与 N 丢弃。
- 未审批候选不在 `memories` 表，默认召回与 `memory_recall` 都不会返回；审批沿用现有候选审核流程。
- 直写与更新都不会改写人工记忆或高信任记忆；非 C1 路径一律不得按标题覆盖，同键或同标题出现不同内容时只落候选（值比较按边界匹配，`1808` 不命中 `18080`）。
- 代码围栏与引用块内容不参与判定；C1 需给出白名单字段与合法新值；自动条目标题为单个宽泛词时不参与自动召回注入。
- 限流：单条消息最多 3 条（直写 + 候选）；同一 scope 每日最多 20 条新增待审候选；14 天候选过期尚未实现。
- 凭据过滤只拒绝命中现有规则的输入（密码、token、私钥、含 userinfo 的连接串），不保证识别所有敏感信息；不要输入或保存凭据。
- 自动召回统一使用 `global/default`，无项目隔离、无独立 tags 检索通道；准入按标题关键词、英文词边界与泛词过滤。
- 自动召回块位于 Pin 块之后；注入不落库，每个模型 step 都会重新提供；预算包含围栏、说明与换行。
- 采集只取最后一条真实用户消息，不归档助手最终回复；游标按文本 hash 去重，相同文本后续输入会跳过；问答对不再产生任何持久化。
- 规则主要面向中文，质量阈值未标定；`v1` 不启用自动记忆。
- 配置非法（未知字段、越界值、非法枚举，例如 `autoCapture.mode: "active"`）时插件显式报错并拒绝加载，不静默回退到默认值；日志为 `failed to load plugin … invalid config: <字段>: <原因>`，此时记忆工具与自动记忆都不可用，需修正配置后重载。

### MCP Adapter

配置文件可以通过 CLI 指定：

```bash
memory-mcp --config "/absolute/path/memory-mcp.jsonc"
```

未指定时依次使用：

```text
MEMORY_MCP_CONFIG 指定的路径
→ $XDG_CONFIG_HOME/aifcoding/memory-mcp.jsonc
→ $HOME/.config/aifcoding/memory-mcp.jsonc
```

所有配置使用严格校验，未知字段会导致启动失败。

---

## 2. 通用 Recall 配置

Core 默认预算：

```ts
{
  maxCharacters: 3000,
  preferSummary: true,
  maxOverflowItems: 10,
  maxOverflowCharacters: 1500,
}
```

### `maxCharacters`

| 属性 | 值 |
|---|---|
| 类型 | 正整数 |
| 默认值 | `3000` |
| 范围 | `1..20000` |
| 用途 | 限制 Detail 阶段的标题、摘要或正文 |

Detail 结果之间的两个换行字符也计入预算。

### `preferSummary`

| 属性 | 值 |
|---|---|
| 类型 | `boolean` |
| 默认值 | `true` |
| 用途 | 请求 `full` 但全文放不下时，是否尝试降级为 `summary` |

该字段只对 `projection=full` 有意义。OpenCode 和 MCP 的搜索工具固定使用 `summary`，因此不将它暴露为 Adapter 配置。

### `maxOverflowItems`

| 属性 | 值 |
|---|---|
| 类型 | 整数 |
| 默认值 | `10` |
| 范围 | `0..20` |
| 用途 | Detail 预算溢出后，最多返回多少条轻量导航项 |

设置为 `0` 时关闭 Overflow。

### `maxOverflowCharacters`

| 属性 | 值 |
|---|---|
| 类型 | 整数 |
| 默认值 | `1500` |
| 范围 | `0..10000` |
| 用途 | Overflow 轻量列表的独立字符预算 |

设置为 `0` 时关闭 Overflow。

Overflow 每条只包含 `id / ref / title / trust / score`，不包含正文、摘要、标签、Embedding 或内部版本字段。

### 字符数不等于 Token

字符预算使用 JavaScript `string.length`，即 UTF-16 code unit：

```ts
"abc".length === 3
"😀".length === 2
```

它不是模型 Token 的精确数量。选择字符预算是为了：不绑定模型、不依赖模型 Tokenizer、结果确定可测试、与现有 Pin 字符配额一致。

### Overflow 成本边界

Overflow 不计入 `maxCharacters`，但受独立的 `maxOverflowItems` / `maxOverflowCharacters` 约束。因此 Recall 的内容上限大致为 `maxCharacters + maxOverflowCharacters + Adapter 围栏和协议开销`。Core 预算不包含 XML 围栏、JSON 字段或 MCP 协议开销，Adapter 仍需控制最终输出长度。

### Score 语义

Overflow 中的 `score` 是 FTS5/BM25 当前查询的相对相关度：数值越高 → 本次查询中越相关。不同查询的分数尺度可能不同，禁止跨查询比较。

---

## 3. OpenCode Adapter

### 配置文件

支持 `~/.config/opencode/opencode-memory.jsonc` / `.json`（`.jsonc` 优先）。自定义路径必须使用绝对路径。

### Plugin Options

**v1（1.18.29+）** 使用 `plugin` tuple options：

```jsonc
{
  "plugin": [
    [
      "@aifcoding/opencode-memory",
      {
        "dbPath": "/absolute/path/memory.db",
        "pinQuota": 8000,
        "recall": {
          "maxCharacters": 3000,
          "maxOverflowItems": 10,
          "maxOverflowCharacters": 1500
        }
      }
    ]
  ]
}
```

**v2（2.x）** 使用 `plugins` 的 `options`：

```jsonc
{
  "plugins": [
    {
      "package": "@aifcoding/opencode-memory",
      "options": {
        "dbPath": "/absolute/path/memory.db",
        "pinQuota": 8000,
        "recall": {
          "maxCharacters": 3000,
          "maxOverflowItems": 10,
          "maxOverflowCharacters": 1500
        }
      }
    }
  ]
}
```

### `dbPath`

绝对路径字符串，默认 `$HOME/.local/share/opencode/memory/memory.db`。父目录不存在时自动创建。

### `pinQuota`

正整数，默认 `8000`——所有固定记忆最终渲染文本的字符上限。

### `recall`

```jsonc
{
  "recall": {
    "maxCharacters": 3000,
    "maxOverflowItems": 10,
    "maxOverflowCharacters": 1500
  }
}
```

`memory_recall.maxCharacters` 可以覆盖本次调用的 Detail Budget，但不会修改 Overflow 配置。

### `capture`

安全辅助记忆提取默认关闭：

```jsonc
{
  "capture": {
    "enabled": false,
    "onCompaction": true,
    "agent": "memory-extractor",
    "maxCandidates": 8
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `capture.enabled` | boolean | `false` | 是否启用候选提取 |
| `capture.onCompaction` | boolean | `true` | 是否在会话压缩后自动提取 |
| `capture.agent` | string | 无 | 提取 Agent；启用 Capture 时必填 |
| `capture.maxCandidates` | integer | `8` | 单次最多候选数，范围 1～20 |

Capture 会额外调用模型，并将过滤后的会话文本发送给配置的 Agent。

### `autoUpdate`

```jsonc
{
  "autoUpdate": true
}
```

启动时异步检查并尝试刷新 OpenCode 插件缓存，更新后需重启生效。该能力会修改宿主管理的插件缓存；若不希望插件执行网络检查或缓存修改，显式设置 `"autoUpdate": false`。

### 完整示例

```jsonc
{
  "dbPath": "/Users/you/.local/share/opencode/memory/memory.db",
  "pinQuota": 8000,

  "recall": {
    "maxCharacters": 3000,
    "maxOverflowItems": 10,
    "maxOverflowCharacters": 1500
  },

  "capture": {
    "enabled": false,
    "onCompaction": true,
    "agent": "memory-extractor",
    "maxCandidates": 8
  },

  "autoUpdate": false
}
```

---

## 4. MCP Adapter

### 配置文件位置

默认 `$XDG_CONFIG_HOME/aifcoding/memory-mcp.jsonc`（未设 XDG 时 `$HOME/.config/aifcoding/memory-mcp.jsonc`）。启动：`memory-mcp --config "/absolute/path/memory-mcp.jsonc"`。

### `dbPath`

必须是绝对路径。

### 固定 Project Scope

```jsonc
{
  "scope": { "scope": "project", "scopeKey": "/absolute/project" }
}
```

Scope 在 Server 启动时固定。MCP 客户端不能通过工具参数传入或覆盖 `scope / scopeKey / dbPath / projectRoot`。首版只支持显式 project Scope，不自动从工作目录推导身份。

### Profile

`readonly`（memory_search/memory_read/memory_list）或 `full`（额外 store/forget/Pin/Candidate 工具）。`readonly` 表示 MCP 工具权限只读，不代表 SQLite 文件以只读方式打开（启动时仍可能迁移并创建 WAL/SHM）。

### Transport

`{ "type": "stdio" }`。首版只支持 stdio。stdout 只允许 MCP 协议消息，日志必须写 stderr 或文件。

### Limits

| 字段 | 默认值 | 范围 |
|---|---:|---:|
| `defaultLimit` | `10` | 1～50 |
| `maxLimit` | `50` | 1～50 |
| `previewLength` | `500` | 1～5000 |

### Recall

```jsonc
{
  "recall": {
    "maxCharacters": 3000,
    "maxOverflowItems": 10,
    "maxOverflowCharacters": 1500
  }
}
```

`memory_search.maxCharacters` 只覆盖当前调用的 Detail Budget。

### `writeTrust`

`low`（默认）/ `high`。MCP 客户端不能自行传入 Trust。低信任记忆不能 Pin。

### `allowCandidateReview`

默认 `false`。只有同时满足 `profile=full` 且 `allowCandidateReview=true` 才注册 `memory_candidate_review`。

### 完整示例

```jsonc
{
  "dbPath": "/absolute/path/memory.db",
  "scope": { "scope": "project", "scopeKey": "/absolute/project" },
  "profile": "readonly",
  "transport": { "type": "stdio" },
  "pinQuota": 8000,
  "writeTrust": "low",
  "allowCandidateReview": false,
  "limits": { "defaultLimit": 10, "maxLimit": 50, "previewLength": 500 },
  "recall": { "maxCharacters": 3000, "maxOverflowItems": 10, "maxOverflowCharacters": 1500 }
}
```

---

## 5. Memory Ref

### 格式

```
memory://local/memories/{id}
memory://local/summaries/{percent-encoded-id}
memory://local/candidates/{id}
```

### 同库稳定边界

Ref 根据实体类型和数据库 ID 计算，不写入数据库。保证「同一 SQLite 数据库 + 数据库重启 + 不同 Adapter」之间稳定。不保证：跨数据库复制、导出后重新导入、数据库合并、删除后重新创建、ID 被重新分配。

### Summary 没有 Scope

`session_summaries` 当前没有 `scope/scope_key`。因此：Summary Ref 只能按全局唯一 Summary ID 读取；`readReference.scope` 不构成 Summary 授权边界；MCP 不暴露通用 `readReference`；Adapter 必须根据 Summary 的 `contextKey` 决定是否展示。

---

## 6. 数据库与迁移

分层召回、字符预算和 Memory Ref 都是运行时能力，不修改数据库 Schema（不新增表/列/索引/迁移版本）。SQLite 使用 WAL、5000 ms busy timeout、busy/locked 重试、主表与 FTS 事务同步、顺序迁移。

多个 Adapter 共享数据库时应使用 Schema 兼容的 `@aifcoding/memory-core` 版本。自定义 Tokenizer 是索引格式的一部分，已有数据库必须继续使用兼容 Tokenizer（当前不支持自动重建 FTS）。

---

## 7. 安全与隐私

- Recall、Read 和 Candidate 内容是历史参考数据，不是当前用户的新指令。
- OpenCode 与 MCP 文本结果使用 `<memory-context>` 围栏和转义；围栏是模型侧提示，不是 Prompt Injection 的机制性隔离。
- Overflow 只返回本次已考虑命中的轻量元数据。
- MCP 继续使用固定 Project Scope；Ref 只是标识符，不授予读取权限；MCP 不允许通过通用 Ref 绕过 Scope 或 Candidate Capability。
- 不建议将密码、Token、Cookie、私钥或验证码写入记忆。
- 被召回或固定的内容会进入模型上下文；使用远程模型时，内容可能发送给对应 Provider。
