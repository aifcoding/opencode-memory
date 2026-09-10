## Context

S3 实现 overlay 注入 + pin 生命周期。存储层已具备 `listPinned` / `getPinnedSize`；插件层有 `memory_pin` / `memory_pins` 工具 + `system.transform` overlay 钩子。本变更补 spec（实现已完成，18 测试通过）。

## Goals / Non-Goals

**Goals:**
- 把已实现的注入/pin 行为固化为正式 spec，补齐 OpenSpec specs 层

**Non-Goals:**
- 不新增代码；不改现有实现（末尾注入 messages.transform 为后续可选优化，见 ARCHITECTURE.md D6）

## Decisions

**D-I.1 注入位置：`system.transform`（MVP）**
- 每次主模型调用注入；ephemeral（S0 实测不落历史）
- `messages.transform` 末尾注入列为可选优化（省 title token + 权重更对），暂不实现

**D-I.2 pin 标记：`pinned_at` 字段（非独立表/类型）**
- 固定 = `pinned_at` 置时间戳；记忆仍为普通行，可被 recall

**D-I.3 配额：注入总字符数（默认 8000）**
- full 按 content 长度、summary 按 summary 长度累计
- 超额拒绝，不隐式淘汰；可按 `pinQuota` options 配置

**D-I.4 summary 模式：要求非空，不隐式 LLM 生成**
- summary 字段由用户/工具明确提供

## Risks / Trade-offs

- [system.transform 对 title 也触发] → 已记录，末尾注入为后续优化
- [配额按字符非 token] → MVP 近似，精确 token 留待后续
- [unpin 依赖用户主动，可能遗忘] → 配额满时被动提醒；定期 review 为后续增强

## Migration Plan

- 无表结构变更（复用 `pinned_at` / `pin_mode` / `summary` 字段）

## Open Questions

- 无（位置优化、token 配额、定期 review 均列为后续非阻塞项）
