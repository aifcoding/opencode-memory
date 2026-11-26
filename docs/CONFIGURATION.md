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

> 本地源码为 `2.4.0-rc.2`（未发布，依赖 `memory-core@0.5.1`）；npm `next` 仍是 `2.3.0-rc.2`（旧采集行为），`latest` 为 `2.2.2`。

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `autoCapture.enabled` | `boolean` | `true` | 是否启用自动采集（按准入矩阵写入或落候选） |
| `autoCapture.mode` | `'off' \| 'shadow' \| 'on'` | `'on'` | `on` 按矩阵直写 + 落候选；`shadow` 只计算不写任何表，仍推进会话游标；`off` 等价于 `enabled=false` |
| `autoCapture.maxWritesPerTurn` | `number` | `3` | 单条消息最多写入条数，直写与候选合计（0..10，超大值按 3 截断） |
| `capture.enabled` | `boolean` | `false` | 是否启用 LLM 辅助提取（压缩后 / 手动 `memory_capture`） |
| `capture.onCompaction` | `boolean` | `true` | 压缩后自动触发提取 |
| `capture.target` | `object` | 未配置 | 提取目标三选一：`{kind:"agent",name}` / `{kind:"host-default"}` / `{kind:"model",provider,model}`；`model` 目标在 OpenCode 适配器尚未支持（启动时拒绝） |
| `capture.agent` | `string` | 未配置 | 旧字段，等价 `{kind:"agent",name}`；与 `capture.target` 同时出现视为冲突 |
| `capture.trustRoleAsOrigin` | `boolean` | `false` | 仅 v1 宿主：默认拒绝提取（fail closed）；置 `true` 才按协议角色映射 human/model（显式风险开关） |
| `capture.maxCandidates` | `number` | `8` | 单次最多候选（1..20） |
| `autoRecall.mode` | `'off' \| 'hint' \| 'shadow' \| 'auto'` | `'auto'` | `auto` 检索并注入摘要；`hint` 只注入固定检索提示；`shadow` 不检索不注入，无决策记录 |
| `autoRecall.maxItems` | `number` | `3` | 单次最多注入条数（1..10） |
| `autoRecall.maxCharacters` | `number` | `300` | 注入块字符上限（50..1200，含围栏与说明）；仅 `auto` 模式，`hint` 固定提示约 143 字符不受此限制 |

行为与限制：

- 准入矩阵（v1，规则编号见 `openspec/changes/2026-11-24-auto-memory-loop/admission-rules.md`）：E1 明确保存、S1 完整配置绑定、D1 明确选型 → 直写 `memories`（`origin=agent`、`trust=low`）；E2/S2/D2/C2 → 写 `memory_candidates` 待审批；C1 仅在唯一匹配 `agent/low` 且旧值相符时 CAS 更新；Q 落低价值候选，N 丢弃。
- 未审批候选不在 `memories` 表，默认召回与 `memory_recall` 都不会返回；审批沿用现有候选审核流程。
- 直写与更新都不会改写人工记忆或高信任记忆；非 C1 路径一律不得按标题覆盖，同键或同标题出现不同内容时只落候选（值比较按边界匹配，`1808` 不命中 `18080`）。
- 代码围栏与引用块内容不参与判定；C1 需给出白名单字段与合法新值；自动条目标题为单个宽泛词时不参与自动召回注入。
- 限流：单条消息最多 3 条直写，超出转候选；同一 scope 每日最多 20 条**新增**候选（按当天创建数计，批准不恢复额度）；14 天候选过期尚未实现。
- 凭据：命中片段脱敏为 `[REDACTED]` 后继续；整条仅凭据时放弃；`password=环境变量` 等占位符不脱敏。
- 问答对（qa）不再直接丢弃，改为落低价值候选（长度 <2 字符仍丢弃）。
- 凭据过滤只拒绝命中现有规则的输入（密码、token、私钥、含 userinfo 的连接串），不保证识别所有敏感信息；不要输入或保存凭据。
- 自动召回统一使用 `global/default`，无项目隔离、无独立 tags 检索通道；准入按标题关键词、英文词边界与泛词过滤。
- 自动召回块位于 Pin 块之后；注入不落库，每个模型 step 都会重新提供；预算包含围栏、说明与换行。
- 采集只取最后一条真实用户消息，不归档助手最终回复；游标按文本 hash 去重，相同文本后续输入会跳过；问答对落低价值候选（纯确认/填充语仍丢弃）。
- 规则主要面向中文，质量阈值未标定；`v1` 不启用自动记忆。
- **辅助提取默认关闭**；启用后会把经本地脱敏的会话材料发送给所选模型，可能产生费用；脱敏基于正则，**不保证识别所有秘密**。
- 配置非法（未知字段、越界值、非法枚举，例如 `autoCapture.mode: "active"`）时插件显式报错并拒绝加载，不静默回退到默认值；日志为 `failed to load plugin … invalid config: <字段>: <原因>`，此时记忆工具与自动记忆都不可用，需修正配置后重载。


#### 通用提取目标（capture.target）

`capture.target` 是提取目标的互斥三选一；OpenCode 适配层已接线读取并做启动期校验。

```jsonc
{
  "capture": {
    "enabled": true,
    "onCompaction": true,
    "target": { "kind": "agent", "name": "memory-extractor" },
    "maxCandidates": 8
  }
}
```

| 字段 | 取值 | 说明 |
|---|---|---|
| `capture.target.kind` | `model` \| `agent` \| `host-default` | 互斥；`enabled=true` 时必须提供且可解析 |
| `model` 目标 | `provider` + `model` | `provider` 是配置里的 provider 键名，不接受 URL/内嵌凭据；**OpenCode 适配器尚未支持，启动时拒绝** |
| `agent` 目标 | `name` | 宿主自己的 agent 名，仅宿主有 agent 概念时使用 |
| `host-default` | 无附加字段 | 使用宿主默认生成能力（OpenCode：未配 target/agent 时自动注入） |
| 旧 `capture.agent` | string | 映射为 agent target；与 `target` 同现视为冲突 |

解析规则（`parseCaptureTarget` / `validateCaptureConfig`，core 内实现）：

- `enabled=false` 允许无 target；`enabled=true` 无 target 或 target 无法解析 → 拒绝启动。
- 生成失败不切换到其它目标；运行期不换目标。
- OpenCode 适配层：`enabled=true` 且既无 `target` 也无旧 `agent` 时自动注入 `{ kind: "host-default" }`；`target.kind='model'` 被适配器显式拒绝。
- 旧 `capture.agent` 映射为 agent target；与 `capture.target` 同现视为冲突，不静默取值。

`capture.trustRoleAsOrigin`（boolean，默认 `false`）：

- v1 宿主没有结构化来源，无法证明 user 消息来自人工，默认拒绝提取（fail closed），返回「当前宿主不支持来源校验，已跳过提取（v1 可显式开启 capture.trustRoleAsOrigin）」。
- 置 `true` 才按协议角色映射 human/model。这是**显式风险开关**；v2 有结构化来源（`typedContext` → origin）时不使用它。

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
| `capture.target` | object | 无 | 提取目标三选一：`{kind:"agent",name}` / `{kind:"host-default"}` / `{kind:"model",provider,model}`；`model` 目标在 OpenCode 适配器尚未支持 |
| `capture.agent` | string | 无 | 旧字段，等价 `{kind:"agent",name}`；与 `capture.target` 同时出现视为冲突 |
| `capture.trustRoleAsOrigin` | boolean | `false` | 仅 v1 宿主：默认拒绝提取（fail closed）；置 `true` 才按协议角色映射 human/model |
| `capture.maxCandidates` | integer | `8` | 单次最多候选数，范围 1～20 |

Capture 会额外调用模型，并将脱敏、裁剪后的会话文本发送给提取目标（agent 或宿主默认模型）。提取提示词与候选校验在 core（`CAPTURE_PROMPT` / `validateCaptureCandidates`），适配器只提供材料与生成器，详见 [`docs/ADAPTER-CONTRACT.md`](ADAPTER-CONTRACT.md)。

提取管线（core `ExtractionService`）的安全与幂等行为：

- **最终载荷复扫**：逐消息脱敏后对拼接后的 `material` 再扫描凭据，命中即 `credential_residual` 拒绝生成（防跨消息重组凭据）。
- **预算硬上限**：先按整条淘汰旧消息；单条超长时确定性保留尾部（最新内容）并截断到 `maxInputChars`，最终材料长度不超过上限。
- **幂等键 = 内容 hash**：`sha256(sourceKind \0 targetFingerprint \0 提取版本 \0 最终材料)` 前 16 位，不再用长度；同长度不同正文不碰撞。
- **错误码白名单**：只把 `invalid_json` / `invalid_output` / `extractor_no_text` / `session_create_failed` / `missing_api_key` / `generator_empty` / `generator_response_too_large` / `generator_http_<3位>` 写入 run 并回传；其他异常一律折叠为 `generator_failed`，禁止把任意异常文本写入或回传（可能含材料片段）。

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

### `extraction`（LLM 提取）

默认关闭。启用后 MCP 提供 `memory_extract` 工具：调用方传入文本，服务本地脱敏后交给配置的 openai-compatible 模型，产出待审批候选（只写 `pending`，不直接落正式记忆）。

```jsonc
{
  "extraction": {
    "enabled": true,
    "allowMcpExtract": true,
    "provider": {
      "baseUrl": "https://api.example.com/v1",
      "model": "your-model",
      "apiKeyEnv": "YOUR_API_KEY_ENV"
    },
    "maxCandidates": 8,
    "maxInputChars": 60000,
    "maxOutputTokens": 1024,
    "timeoutMs": 30000
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `extraction.enabled` | boolean | `false` | 是否启用提取（`memory_extract` 需要它） |
| `extraction.allowMcpExtract` | boolean | `false` | 是否注册 `memory_extract` 工具 |
| `extraction.provider.baseUrl` | string | 无 | openai-compatible 接口地址 |
| `extraction.provider.model` | string | 无 | 模型名 |
| `extraction.provider.apiKeyEnv` | string | 无 | 存放 API Key 的环境变量名（值只从环境读取，不写配置/日志） |
| `extraction.maxCandidates` | integer | `8` | 单次最多候选数（1..20） |
| `extraction.maxInputChars` | integer | `60000` | 材料字符上限（1000..200000） |
| `extraction.maxOutputTokens` | integer | `1024` | 生成 token 上限（128..8000） |
| `extraction.timeoutMs` | integer | `30000` | 生成请求超时（1000..120000） |

`memory_extract` 将输入文本作为 `origin='model-report'` 的不可信材料，经 core 的相同安全管线（来源准入 → 脱敏 → 预算裁剪 → 复扫 → 幂等 → 生成 → 校验）后写候选。工具的 prompt 与校验复用 core（`CAPTURE_PROMPT` / `validateCaptureCandidates`），不在 MCP 侧重复实现。**MCP 真实模型端到端尚未验证**（目前只覆盖单测与工具层测试）。

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
