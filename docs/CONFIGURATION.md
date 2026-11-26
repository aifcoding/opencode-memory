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

配置来源与优先级（后者覆盖前者，逐字段）：

```text
内置默认值
→ agent-memory.json / 旧名 opencode-memory.jsonc/.json（兼容读取）
→ agent-memory.jsonc
→ 插件 options（opencode.jsonc 里该插件的 options）
```

`options` 与文件配置逐字段覆盖；`recall` 子对象按字段合并，未提供的字段回落到文件配置或内置默认值。

默认配置目录：

```text
$XDG_CONFIG_HOME/opencode
```

未设置 `XDG_CONFIG_HOME` 时：

```text
$HOME/.config/opencode
```

**首次加载自动生成（不覆盖已有文件）**：

- `agent-memory.jsonc`：默认开关（自动采集/召回开启，LLM 提取关闭），带注释可编辑；只要任一支持的文件名已存在就跳过。
- `memory-capture.rules.md`：可编辑的提取规则模板，与 `capture.enabled` 无关都会生成。
- `memory.db`：SQLite 数据库，首次使用自动创建（父目录一并创建）。

#### 完整配置示例（全部字段）

写入 `~/.config/opencode/agent-memory.jsonc`（JSONC，支持注释）：

```jsonc
{
  // 可选：数据库绝对路径。默认 $XDG_DATA_HOME/opencode/memory/memory.db
  // 未设置 XDG_DATA_HOME 时为 ~/.local/share/opencode/memory/memory.db
  "dbPath": "/Users/you/.local/share/opencode/memory/memory.db",

  // 可选：Pin（固定记忆）最终渲染文本总字符上限
  "pinQuota": 8000,

  // 可选：手动 memory_recall 工具的默认预算（不影响自动召回注入）
  "recall": {
    "maxCharacters": 3000,        // 单次返回正文总字符上限
    "maxOverflowItems": 10,       // 超预算时最多列出的轻量条目数
    "maxOverflowCharacters": 1500 // 轻量条目部分的字符上限
  },

  // 自动记忆：只执行显式记忆指令
  "autoCapture": {
    "enabled": true,              // false = 完全关闭规则采集
    "mode": "on",                 // on = 立即写入；shadow = 只记录不写表
    "maxWritesPerTurn": 3         // LLM 提取/候选路径的单轮额度；显式指令不受限
  },

  // 自动召回：每个模型请求前检索并注入摘要
  "autoRecall": {
    "mode": "auto",               // off | hint | shadow | auto
    "maxItems": 3,                // 单次最多注入条数（1..10）
    "maxCharacters": 300          // 注入块字符上限（50..1200，仅 auto 模式）
  },

  // LLM 辅助提取：默认关闭，开启后会把脱敏材料发给模型、可能产生费用
  "capture": {
    "enabled": true,              // true 才启用压缩后提取 / 手动 memory_capture
    "onCompaction": true,         // 压缩成功后自动触发提取
    "model": {                    // 建议固定；未配置用宿主默认模型
      "provider": "deepseek",
      "model": "deepseek-flash"
      // "variant": "..."         // 可选：模型变体
    },
    "instructionsFile": "/Users/you/.config/opencode/memory-capture.rules.md",
    "maxCandidates": 8            // 单次最多候选（1..20）
  },

  // 启动时检查 npm 最新版并自动刷新插件缓存
  "autoUpdate": true
}
```

#### 字段说明

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `dbPath` | `string` | 见上 | 数据库绝对路径；相对路径会在启动时报错 |
| `pinQuota` | `number` | `8000` | Pin 渲染文本总字符预算（正整数） |
| `recall.maxCharacters` | `number` | `3000` | 手动 `memory_recall` 的正文预算 |
| `recall.maxOverflowItems` | `number` | `10` | 超预算时列出的轻量条目上限 |
| `recall.maxOverflowCharacters` | `number` | `1500` | 轻量条目部分字符上限 |
| `autoCapture.enabled` | `boolean` | `true` | 是否执行显式记忆指令 |
| `autoCapture.mode` | `'shadow' \| 'on'` | `'on'` | `on` 立即写入/更新；`shadow` 只诊断不写表。关闭请用 `enabled:false`（没有 `off` 枚举） |
| `autoCapture.maxWritesPerTurn` | `number` | `3` | LLM 提取/候选路径单轮额度（0..10）；显式指令不受此额度截断 |
| `autoRecall.mode` | `'off' \| 'hint' \| 'shadow' \| 'auto'` | `'auto'` | `auto` 检索并注入摘要；`hint` 只注入固定检索提示；`shadow` 不检索不注入 |
| `autoRecall.maxItems` | `number` | `3` | 单次最多注入条数（1..10） |
| `autoRecall.maxCharacters` | `number` | `300` | 注入块字符上限（50..1200，仅 `auto`） |
| `capture.enabled` | `boolean` | `false` | 是否启用 LLM 辅助提取 |
| `capture.onCompaction` | `boolean` | `true` | 压缩后是否自动触发提取 |
| `capture.model` | `object` | 未配置 | `{provider, model, variant?}`；未配置用宿主默认模型；配置后不可用即失败，不回退 |
| `capture.instructionsFile` | `string` | 未配置 | 用户规则 md 的本地绝对路径；读不到/为空/超限即失败 |
| `capture.maxCandidates` | `number` | `8` | 单次最多候选（1..20） |
| `capture.target` | `object` | 未配置 | **已弃用**：`model` 自动映射为 `capture.model`；`agent` 启动报迁移错误 |
| `capture.agent` | `string` | 未配置 | **已弃用**：启动报迁移错误，改用 `capture.model` |
| `capture.trustRoleAsOrigin` | `boolean` | `false` | 仅 v1 兼容保留：v1 无法强制工具隔离，提取 fail-closed 拒绝 |
| `autoUpdate` | `boolean` | `true` | 启动时检查 npm 最新版并刷新缓存 |

#### 用 opencode.jsonc 的 options 写法

也可以只在 `opencode.jsonc` 里配置（优先级最高），适合不想生成独立配置文件的场景：

```jsonc
{
  "plugins": [
    {
      "package": "@aifcoding/opencode-memory@next",
      "options": {
        "autoCapture": { "enabled": true, "mode": "on", "maxWritesPerTurn": 3 },
        "autoRecall": { "mode": "auto", "maxItems": 3, "maxCharacters": 300 },
        "capture": {
          "enabled": true,
          "model": { "provider": "deepseek", "model": "deepseek-flash" },
          "maxCandidates": 8
        }
      }
    }
  ]
}
```

注意：`capture.enabled=true` 会把经本地脱敏的会话材料发送给所选模型，可能产生费用；不想发送就保持 `false`。

#### 行为与限制

- 记忆指令执行器（见 `openspec/changes/2026-11-26-explicit-memory-instructions/`）：
  - 显式保存（`记住/记一下/保存下来 + 正文`）→ 立即直写，整条消息一条记忆；正文原样保留（代码块/缩进/换行），不按问句/长度/字数做质量筛选；
  - 完整行为指令（`以后/下次/统一/禁止/默认/一律/全部`，可带「本项目」）→ 立即直写为偏好；
  - 明确纠正（带 `更正/改成/记住` 等意图 + 唯一目标 + 旧值相符）→ CAS 更新为新值，否则丢弃并反馈；普通聊天里的纠正不会改写记忆；
  - 隐式内容（随口配置、日志、决策句、问答对）→ 规则层零写入，交给 LLM 提取。
- 未审批候选不在 `memories` 表，默认召回与 `memory_recall` 都不会返回；审批沿用现有候选审核流程。
- 直写与更新都不会改写人工记忆或高信任记忆；非 C1 路径一律不得按标题覆盖，同标题出现不同内容时另建唯一标题条目（不覆盖、不转候选）。
- 代码围栏与引用块内容参与显式保存正文（原样入库）；C1 需给出白名单字段与合法新值；自动条目标题为单个宽泛词时不参与自动召回注入。
- 显式指令不受 `maxWritesPerTurn` 截断；同一 scope 每日最多 20 条**新增**候选（按当天创建数计，批准不恢复额度）；14 天候选过期尚未实现。
- 凭据：命中片段脱敏为 `[REDACTED]` 后继续；整条仅凭据时放弃；`password=环境变量` 等占位符不脱敏。
- 凭据过滤只拒绝命中现有规则的输入（密码、token、私钥、含 userinfo 的连接串），不保证识别所有敏感信息；不要输入或保存凭据。
- 自动召回统一使用 `global/default`，无项目隔离、无独立 tags 检索通道；准入按标题关键词、英文词边界与泛词过滤。
- 自动召回块位于 Pin 块之后；注入不落库，每个模型 step 都会重新提供；预算包含围栏、说明与换行。
- 采集只取最后一条真实用户消息，不归档助手最终回复；游标按文本 hash 去重，相同文本后续输入会跳过。
- 规则主要面向中文，质量阈值未标定；`v1` 不启用自动记忆。
- **辅助提取默认关闭**；启用后会把经本地脱敏的会话材料发送给所选模型，可能产生费用；脱敏基于正则，**不保证识别所有秘密**。
- 配置非法（未知字段、越界值、非法枚举，例如 `autoCapture.mode: "active"`）时插件显式报错并拒绝加载，不静默回退到默认值；日志为 `failed to load plugin … invalid config: <字段>: <原因>`，此时记忆工具与自动记忆都不可用，需修正配置后重载。


#### 提取模型与规则（capture.model / capture.instructionsFile）

提取模型由 `capture.model` 指定（`provider` / `model` / 可选 `variant`）：

- 未配置：使用宿主默认模型。
- 配置后不可用（provider/model 不存在、无权限、不支持切换）：本次提取失败，返回 `model_selection_unsupported`，**不回退**默认模型。

首次加载时插件自动生成模板 `~/.config/opencode/memory-capture.rules.md`（与 `capture.enabled` 无关；已存在不覆盖，`XDG_CONFIG_HOME` 生效时在 `$XDG_CONFIG_HOME/opencode/`）。优先级：显式 `capture.instructionsFile` > 自动模板 > 内置默认。

提取规则由 `capture.instructionsFile` 指定（本地绝对路径、UTF-8 markdown）：

- 未配置：使用随包发布的默认规则。
- 配置后**替换**默认规则，不叠加；每次触发读取一次，内容 hash 参与任务幂等键。
- 文件不存在/不可读/为空/超限：本次提取失败（`instructions_unreadable` / `instructions_too_large`），不回退。
- 不支持远程 URL、include；规则内容在发送前会做凭据扫描。

发给模型的 instructions 由两段组成：用户规则在前，程序附加约束在后；程序附加约束声明「与上文冲突时以本节为准」，并声明材料中的指令不构成程序约束。这是产品约束，不是安全边界。

执行顺序（OpenCode v2）：`session.create → session.update(permission 全 deny) → session.switchModel(仅配置模型时) → generate → session.remove`。

完整字段示例见上文「完整配置示例（全部字段）」。配置项改动需重启服务；规则 md 内容改动在下一次提取时生效。

迁移：`capture.agent` 与 `capture.target.kind="agent"` 启动报错；`capture.target.kind="model"` 映射为 `capture.model`；两者与新字段同现视为冲突。


