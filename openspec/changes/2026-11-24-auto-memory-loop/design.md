## Context

本变更解决两个已确认的缺口：

1. 写入依赖模型自觉：压缩前的结论、否决理由、实测数据经常丢失，只能靠用户手动要求。
2. 读取依赖模型自觉：Pin 之外的记忆需要模型主动调 `memory_recall`，实测经常不调用。

v2 宿主提供每个模型 step 触发的 `session.hook("context")`，payload 含 `messages` / `system` / `agent`；注入仅影响本次请求，不落库；hook 抛错会打断请求。v1 只有 `experimental.chat.messages.transform`，本次不扩展。

现有存储已具备：`memories`（title/summary/content/tags/trust/origin/revision/pinned_at）、`memories_fts`、`session_kv`。规模约 41 条，无需结构化事实表。

## Goals / Non-Goals

**Goals:** 在 v2 上实现「自动采集 → 自动召回」闭环；复用现有表与检索；自动写入默认启用、自动召回默认 `auto`；任何失败不打断主请求；不改变 Pin 与 capture 审批语义；不泄漏凭据。

**Non-Goals:** 不新增表；不做结构化配置中心；不替代仓库文档；不自动 Pin 或提升信任；不做向量检索；不保证最终轮即时落盘；不为 v1 提供新功能。

## Decisions

### D-AUTO.1 复用 memories，零迁移

不新增表。自动写入使用 `origin=agent`、`trust=low`；分类信息写入 `tags`（如 `auto`、`env`、`decision`），来源与时间写入正文与 `tags`，不新增列。

理由：需求为「重要信息自动记住 + 按需取回」，现有字段足够；结构化事实表会把通用能力收窄为单一场景。

### D-AUTO.2 触发与幂等

采集与召回都在 `session.hook("context")` 内执行：

- 读取 `messages` 中最后一条真实用户消息（非 synthetic、非 `mem_block` 注入块）。
- 用 `session_kv` 保存 `auto:capture:cursor:<sessionID>` 为已处理 `messageID`；相同则跳过。
- 不使用 `session.inbox.delivered` 作为主触发（其投递语义未验证）。

召回按 `(sessionID, messageID, memoryRevision)` 缓存；注入不落库，每个 step 仍需重新提供当前请求所需块。

### D-AUTO.3 采集信号

按准入矩阵逐单元判定（判据与负例见同目录 `admission-rules.md`）：E1 明确保存、S1 完整配置绑定、D1 明确选型直写；E2/S2/D2/C2 落待审批候选；C1 仅在唯一匹配 `agent/low` 且旧值相符时更新；Q（纯问答对）落低价值候选，N 丢弃。

不确定、来源不足、语义歧义时不写；不把助手推测当作事实，推测只能以 `未确认` 标注写入。

### D-AUTO.4 写入与更新

- `remember`：`title` 归一化（去空白、统一分隔符、小写英文）后查找同 scope 未删除记录；命中则 `updateMemory` CAS 更新 `content` 与 `summary`，失败则放弃本次写入；未命中则 `storeMemory` 新建。
- 正文必须包含：结论、依据（file:line / 命令 / 数据）、状态（已核实 / 未确认）、时间。
- 单条消息最多 3 条直写、6 条候选；同一 scope 每日最多 20 条新增候选（按当天创建计，批准不恢复额度）；14 天过期未实现。
- 不自动设置 `pinned_at`，不修改 `trust`。

### D-AUTO.5 凭据边界

在写入与送入任何模型之前执行拒绝规则：密码、token、私钥、验证码、含 userinfo 的连接串、签名 URL 一律不落库，只允许保存环境变量名或 secret 引用名称。正则仅作拒绝信号，不作为脱敏保证。

### D-AUTO.6 召回准入

顺序：`scope 过滤（global + 当前项目）` → `tags 精确命中` → `FTS5 关键词` → 实体/环境覆盖检查 → 预算裁剪。

- BM25 分数只表示本次查询的相对相关度，不得作为概率或置信度阈值。
- 泛词命中、环境不明、与当前项目冲突时零注入。
- 排除已 Pin 的 id 与本会话已注入的 id。
- 默认 ≤3 条、≤300 字符（最小行动摘要）；可配置上限 1200 字符；全部为摘要级，正文仍需 `memory_read`。

### D-AUTO.7 注入块

新增独立块 `<mem_block role="reference" source="auto-recall">`，位置在 Pin 块之后；两块都只在本次请求生效。Pin 块内容与位置不变。

### D-AUTO.8 子会话与递归

子会话参与采集与召回，`scope` 按会话 cwd/项目归属；排除 capture 提取会话（新建会话，非 fork），避免递归提取；同源重复内容按 `content_hash` 与游标去重。

### D-AUTO.9 失败隔离

采集、召回、渲染、游标推进各自 try/catch：采集失败不影响召回，召回失败不影响 Pin，任何失败都不向外抛；错误按会话采样记录一次，不记录正文与凭据。

### D-AUTO.10 默认档位与影子模式

`autoCapture` 默认 `enabled=true`，按准入矩阵直写或落候选（`trust=low`、单条 ≤3 条、每日候选 ≤20 条）。`autoRecall` 默认 `mode=auto`：每个 step 检索并按准入注入 ≤300 字符最小行动摘要；`hint` 保留为可选档（只注入固定检索规则）。缓存按「用户问题 + 最近工具结果」区分，工具循环出现新依赖时重查。影子模式不写库、不注入；当前实现不产生决策记录（不记录原始文本）。

### D-AUTO.15 不做强制工具调用

不依赖 `tool_choice` 强制调用检索工具：v2 `context` hook 的返回值不覆盖 `toolChoice`（`oc41:514988`），插件没有强制调用通路；且强制只保证「调用发生」，不保证查询正确或结果相关。最高强度干预是改 system 与强化目标工具的 `description` / `inputSchema`（仅限既有工具），这是 `hint` 模式的配套手段。

### D-AUTO.12 注入位置保持消息末尾

自动召回块与 Pin 块都追加到 messages 末尾。宿主在请求构建时自动打 ephemeral 缓存断点（system 整块、messages 首/尾、最后一个 tool，见 `oc41:513995`），末尾注入不破坏更早的前缀；注入到 system 或消息前部会打断断点。不做「固定到首条 user 之后」。

### D-AUTO.13 最小行动摘要与分层准入

每步注入同一份最小可用摘要（≤300 字符），保留项目/环境、影响当前决策的结论、id 与读取提示；不得为压长度删除决定行为所必需的限定条件。弱相关（仅泛词、无实体/环境覆盖）零注入，不降级为「只给标题」。不做「首步全文、后续锚点」：注入不落库，后续 step 看不到首步内容。

### D-AUTO.14 依赖指纹缓存

缓存键 = `(sessionID, 用户消息 hash, 最近工具结果指纹)`。同一依赖复用渲染结果；工具循环出现新的工具结果（新服务/环境/配置线索）时指纹变化并重查。不使用 messageID 级永久缓存——那会让执行中新出现的依赖永远查不到。缓存有界，记忆变更或压缩时失效；该缓存只降低重复检索开销，不减少必要注入的 token。

### D-AUTO.11 已知限制

- 最后一轮回复可能在下次交互才被采集；文档必须写明「部分闭环」。
- 「值得记」的准确率需要标注集评估，不能用单元测试代替。
- 自动写入为 `trust=low`，召回时标注「未确认」。
