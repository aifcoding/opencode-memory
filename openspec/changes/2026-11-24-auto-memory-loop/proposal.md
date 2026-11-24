## Why

当前记忆插件的「写」和「读」都依赖模型自觉：

- 写：只有用户显式要求或模型主动调用 `memory_store` 才会落库；压缩前的中间结论、被否决方案、实测数据经常丢失。
- 读：只有被 Pin 的记忆每轮注入；普通记忆要模型主动调 `memory_recall`，实测经常不调用。
- 现有 capture 只在压缩后由模型提取候选，需人工审批，无法覆盖「联调当下给出的重要信息」，且不满足「自动写入即可召回」的闭环。

v2 宿主已有每个模型 step 触发的 `session.hook("context")`，且注入不落库，可以承载「请求前自动注入」；v1 暂停迭代。本变更只针对 v2 实现自动记忆闭环，v1 加载路径与现有行为保持不变。

## What Changes

- 新增 `AutoCaptureService`：按准入矩阵逐单元路由。E1/S1/D1 直写现有 `memories`（`origin=agent`、`trust=low`）；E2/S2/D2/C2 写入现有 `memory_candidates` 待审批；C1 仅在唯一匹配 `agent/low` 且旧值相符时以 CAS 更新；Q/N 丢弃。不新增表。
- 新增 `AutoRecallService`：按 `scope → tags 精确 → FTS` 检索，经准入与预算后返回摘要级候选。
- 新增 v2 编排层：在 `session.hook("context")` 内分区执行采集与召回，注入不超过预算的独立参考块；任何失败不影响 Pin 与主请求。
- 用 `session_kv` 保存已处理 `messageID` 游标，避免每 step 重复处理。
- 子会话参与采集与召回；排除 capture 提取会话，避免递归。
- 新增配置 `autoCapture`（默认启用）与 `autoRecall`（默认 `auto`），支持影子模式（不写库、不注入）。
- 不新增表、不新增列、不修改 Pin 现有逻辑、不修改 capture 的审批边界。

## Capabilities

### New Capabilities

- `auto-memory`：v2 自动采集与自动召回的闭环定义，含信任、去重、预算、准入、失败隔离与默认档位语义。

### Modified Capabilities

- `memory-capture`：明确「自动写入正式记忆」与「提取候选待审批」是两条路径，互不替代。
- `memory-injection`：新增自动召回块与 Pin 块共存的顺序、去重与预算总账规则。
- `retrieval`：新增 scope/tags 优先的准入约定，并明确 BM25 分数不得作为概率或置信度。

## Dependencies

- 依赖已上线能力：`memories` / `memories_fts` / `session_kv`、`MemoryManager.storeMemory` / `recallMemories` / `updateMemory`。
- 依赖 v2 宿主 `session.hook("context")`（每 step 触发、注入不落库、异常会打断请求）。
- 不依赖 `session.inbox.delivered`：该事件的投递语义（是否包含插件注入消息、是否重放、messageID 唯一范围）尚未验证，本变更不以其作为主触发。

## Impact

- **Core**：新增 `AutoCaptureService`、`AutoRecallService` 与相关类型；现有公开 API 只增不改。
- **OpenCode Adapter**：v2 新增编排与注入块；v1 分支不注册新逻辑。
- **数据库**：零迁移，不新增表、列或索引。
- **上下文成本**：新增注入受独立预算约束（默认 ≤3 条、≤300 字符，可配上限 1200），未命中为 0。
- **Pin**：行为不变；自动召回块只复用 pinned id 做去重。
- **Capture**：审批边界不变；自动写入不经过候选。
- **文档**：更新 `docs/ARCHITECTURE.md`、`docs/CONFIGURATION.md` 与中英 README，说明适用范围与限制。

## Non-Goals

- 不新增事实表、配置中心或结构化实体模型。
- 不自动 Pin、不自动提升 `trust`、不自动批准候选。
- 不保存密码、token、含凭据的连接串或签名 URL。
- 不替代仓库文档：PRD 原文、spec 全文仍必须落盘，记忆只存结论与指针。
- 不引入向量检索、embedding 或重排模型。
- 不在每个 step 调用提取模型。
- 不承诺「最后一轮回复立即落盘」；v2 未验证可靠的轮次完成事件。
- 不保证跨设备同步或严格一次语义。
- 不为 v1 提供新功能。
