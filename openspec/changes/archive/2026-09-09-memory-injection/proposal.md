## Why

S3 的 overlay 注入 + pin 生命周期（full/summary 模式、配额、list_pins）已作为 MVP 直接实现并通过端到端实测，但没有走 OpenSpec 的 propose→apply→archive 流程，导致 `openspec/specs/` 缺失这一整块能力。本变更回填正式 spec，让 OpenSpec 重新成为完整事实源（对齐 ARCHITECTURE.md 的 D6/D8）。

## What Changes

- 新增能力 spec `memory-injection`，覆盖：
  - 固定记忆每轮注入（overlay，ephemeral 不落历史）
  - Pin 生命周期（仅显式 pin/unpin）
  - full/summary 双模式
  - 配额（超额拒绝，不隐式淘汰）
  - list_pins
- 无新代码（实现已在 `plugin.ts` + `SqliteMemoryStore.ts`，18 测试通过）

## Capabilities

### New Capabilities
- `memory-injection`: 记忆注入——overlay 每轮注入固定记忆、pin 生命周期、full/summary 模式、配额、list_pins

### Modified Capabilities
（无）

## Impact

- **文档**：`openspec/specs/memory-injection/spec.md` 新增，补齐 specs 层缺口
- **代码**：无（回填既有实现）
- **对齐**：与 `docs/ARCHITECTURE.md` D6/D8 决策一致
