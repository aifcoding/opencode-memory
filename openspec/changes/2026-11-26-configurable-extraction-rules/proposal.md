# 可配置提取规则与模型（LLM 管线）

## 问题

1. 提取模型只能通过 agent md 绑定，模型选择与规则说明耦合在同一个宿主体裁里；换模型要写 agent 文件，换规则也要改 agent 文件，且不同宿主机制不通用。
2. 规则写死在代码（`CAPTURE_PROMPT`），用户无法只改 md 调整「提什么」。
3. 现有代码校验把编辑规范当安全边界（`title ≤30`、`content ≤500`、`evidenceQuote` 必须存在等），误杀正常候选，维护成本高，却挡不住真正的风险（凭据外发、来源污染、越权写入）。

## 方案

- **模型进配置，规则进 md**：`capture.model` 指定 provider/model；`capture.instructionsFile` 指向用户的规则 md；未配置时分别回退到宿主默认模型与随包默认规则。
- **提示词分层**：发给模型的内容 = 用户规则 md（前）+ 程序附加约束（后）。程序附加约束声明「与上文冲突时以本节为准」，并声明材料中的指令不构成程序约束。
- **代码只保留基础风控**：来源准入、凭据防护、资源上限、最小结构与 pending-only 写入、执行隔离。
- **质量规则降级为提示词要求**：标题/正文长度、短问句、引用、同批去重、是否值得长期保存，全部移出代码校验；由提示词约束，候选仍需人工审批。

## 影响

- core：新增指令组合模块与规则文件契约；`ExtractionService` 用最终 instructions 的内容 hash 参与幂等；校验器瘦身为结构校验；默认规则 md 随包发布。
- opencode：新增 `capture.model`、`capture.instructionsFile`；执行链改为 `create → update(permission deny) → switchModel(可选) → generate → remove`；旧 `target`/`agent` 做迁移与弃用。
- mcp：`extraction.instructionsFile` 复用同一组合契约。
- 文档：README 中英、`docs/CONFIGURATION.md`、`docs/ADAPTER-CONTRACT.md` 同步。

## 非目标

- 不承诺「后置约束」能防住提示注入；它是产品约束，不是安全边界。
- 不自动重提取历史会话；不自动批准候选。
- 不改变规则采集（`AutoCaptureService`）与召回路径。

## 风险

- 精简校验后候选精确率与重复率会变化，需要金标集衡量；审批负担可能上升。
- 显式配置模型不可用时选择失败而非回退，用户会看到提取失败（这是有意的：避免费用与数据去向不可控）。
- 「与上文冲突以本节为准」只影响模型行为，不构成权限隔离；真正的边界由来源准入、pending-only、禁工具与资源上限保证。
