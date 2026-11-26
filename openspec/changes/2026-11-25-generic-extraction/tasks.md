# 任务

## 1. 契约与配置
- [x] 1.1 `core/domain/extraction.ts`：target 联合类型、来源类型、解析与校验
- [x] 1.2 `validateCaptureConfig` 接入宿主配置（OpenCode 先行，旧 agent 字段兼容）

## 2. 通用提取 core
- [x] 2.1a `ports/TextGenerator.ts`（纯接口，已由 core 导出）
- [ ] 2.1b `ports/ConversationSource.ts`（未做；宿主材料读取保留在适配层）
- [x] 2.2 安全管线（落点与计划不同）：提示词/校验在 `extraction/{prompt,validate}.ts`，凭据扫描复用 `AutoCaptureService.redactCredentialText`，预算裁剪内联在 `ExtractionService`；无独立 `safety/budget/schema.ts`
- [x] 2.3 `application/ExtractionService.ts`（固定顺序 + beginCapture/completeCapture）
- [x] 2.4 提示词约束 + 本地后置校验（已迁至 `extraction/{prompt,validate}.ts`）
- [x] 2.5 假 generator 单测：凭据不外发、预算裁剪、非法输出不落候选

## 3. 来源与幂等
- [ ] 3.1 候选来源字段（host-transcript / model-report）与迁移（`SourceKind` 类型已存在，候选表无来源列、无迁移）
- [ ] 3.2 召回块标注来源（未做；候选批准后以 `origin=agent` 落正式记忆，无 model-report 标注）
- [ ] 3.3 并发/重启/租约接管幂等测试（未做）

## 4. 生成器与宿主
- [x] 4.1 openai-compatible 生成器（实现在 `packages/mcp/src/extraction/generator.ts`，未建独立 `packages/generators` 包）
- [x] 4.2 OpenCode adapter 迁移（仅 agent / host-default；`target.kind='model'` 启动时仍被拒绝）
- [x] 4.3 MCP `memory_extract` 工具 + `extraction.allowMcpExtract` 权限
- [ ] 4.4 Claude Code hook adapter（Stop 事件 + transcript 读取）

## 5. 质量基准
- [ ] 5.1 标注集（仓库/配置/调研正例；示例/假设/临时/重复/凭据负例）
- [ ] 5.2 precision / recall / 覆盖率报告
