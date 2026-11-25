# 任务

## 1. 契约与配置
- [x] 1.1 `core/domain/extraction.ts`：target 联合类型、来源类型、解析与校验
- [ ] 1.2 `validateCaptureConfig` 接入宿主配置（OpenCode 先行，旧 agent 字段兼容）

## 2. 通用提取 core
- [ ] 2.1 `ports/TextGenerator.ts`、`ports/ConversationSource.ts`
- [ ] 2.2 `extraction/{safety,budget,prompt,schema}.ts`
- [ ] 2.3 `application/ExtractionService.ts`（固定顺序 + beginCapture/completeCapture）
- [x] 2.4 提示词约束 + 本地后置校验（`capture/prompt.ts`、`capture/validate.ts`）
- [ ] 2.5 假 generator 单测：凭据不外发、预算裁剪、非法输出不落候选

## 3. 来源与幂等
- [ ] 3.1 候选来源字段（host-transcript / model-report）与迁移
- [ ] 3.2 召回块标注来源
- [ ] 3.3 并发/重启/租约接管幂等测试

## 4. 生成器与宿主
- [ ] 4.1 `packages/generators`：openai-compatible 一种协议
- [ ] 4.2 OpenCode adapter 迁移（agent/model/host-default）
- [ ] 4.3 MCP `memory_extract` 工具 + `allowExtraction` 权限
- [ ] 4.4 Claude Code hook adapter（Stop 事件 + transcript 读取）

## 5. 质量基准
- [ ] 5.1 标注集（仓库/配置/调研正例；示例/假设/临时/重复/凭据负例）
- [ ] 5.2 precision / recall / 覆盖率报告
