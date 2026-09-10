## 1. 存储层

- [x] 1.1 实现 `listPinned`（`WHERE pinned_at IS NOT NULL`）与 `getPinnedSize`（full 按 content、summary 按 summary），验证 18 测试全绿

## 2. 插件工具

- [x] 2.1 实现 `memory_pin`（pinned + pinMode + summary + 配额检查超额拒绝），验证 pin/unpin/配额分支
- [x] 2.2 实现 `memory_pins`（列出固定记忆）

## 3. Overlay 注入

- [x] 3.1 实现 `system.transform` 注入固定记忆（按 pinMode 渲染 full/summary），验证端到端（模型不调工具直接答出固定记忆）

## 4. 文档

- [x] 4.1 更新 `docs/ARCHITECTURE.md` D6/D8
- [x] 4.2 `openspec validate --changes` 通过并归档本变更
