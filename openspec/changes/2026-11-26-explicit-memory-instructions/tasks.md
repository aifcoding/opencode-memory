# 任务：记忆指令执行器

## 1. 规则层

- [x] 1.1 `routeUnit` 只保留显式保存、完整行为指令、明确纠正
- [x] 1.2 显式保存整条消息作为一个单元（不切句、不多事实拆分）
- [x] 1.3 行为规则不再自动写入，需显式保存
- [x] 1.4 明确纠正：C1 保留唯一目标 + 旧值 + CAS；C2 失败改为丢弃
- [x] 1.5 删除 S1/D1/D2/E2/Q 隐式采集与候选分支
- [x] 1.6 删除 `BINDING_ENTITY` 与隐式实体形状限制

## 2. 测试

- [ ] 2.1 更新 `packages/core/tests/auto-memory.test.ts` 到新语义
- [ ] 2.2 删除隐式规则测试，新增验收矩阵（显式保存、多行粘贴、行为指令、指代、日志、automation）
- [ ] 2.3 core 全量通过

## 3. 文档

- [ ] 3.1 `admission-rules.md` 改为「显式指令」矩阵
- [ ] 3.2 README 中英「自动记忆」段落同步
- [ ] 3.3 旧变更 `2026-11-26-auto-capture-whitelist` 标记被取代
- [ ] 3.4 `docs/ARCHITECTURE.md` D16 同步

## 4. 真实链路

- [ ] 4.1 `记住：…` 立即写入并可检索
- [ ] 4.2 无指令的 `probe.port=…` / npm 日志 0 写入
- [ ] 4.3 automation 的 `记住：…` 不执行
- [ ] 4.4 明确纠正同 ID 更新、失败有反馈

## 5. 发布

- [ ] 5.1 版本号（core patch / plugin rc）与 changelog
- [ ] 5.2 commit + push（需用户确认）
- [ ] 5.3 npm 发布（需用户 2FA）
