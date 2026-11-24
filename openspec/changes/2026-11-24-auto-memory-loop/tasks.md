## 0. 基线

- [x] 0.1 记录当前 v2 `context hook` 注入点与 Pin 块渲染位置（`packages/opencode/src/plugin-v2.ts:154-171`）
- [x] 0.2 确认 `memories` / `memories_fts` / `session_kv` 无需迁移
- [x] 0.3 确认 v1 分支不注册新逻辑，仅做加载回归
- [x] 0.4 记录现有 `recallMemories` 默认投影与预算行为，作为召回层基线

## 1. 类型与配置

- [x] 1.1 新增 `core/domain/auto-memory.ts`：信号类型、候选、决策、预算类型
- [x] 1.2 定义 `AutoCaptureConfig`（enabled / mode: off|shadow|on / maxWritesPerTurn）
- [x] 1.3 定义 `AutoRecallConfig`（enabled / mode / maxItems / maxCharacters）
- [x] 1.4 默认 `autoCapture.enabled=true`、`autoRecall.mode=hint`；配置非法时拒绝启动并给出字段名
- [x] 1.5 更新 OpenCode 配置 schema 与 `docs/CONFIGURATION.md`

## 2. AutoCaptureService

- [x] 2.1 实现准入矩阵路由：E1 明确保存、E2 弱 explicit、S1 完整配置绑定、S2 不完整结构化、D1 明确选型、D2 其他决策、C1 可验证纠正、C2 无法安全纠正、Q 纯问答对、N 无有效单元
- [x] 2.2 实现 title 归一化与同 scope 查找
- [x] 2.3 命中走 `updateMemory` CAS；失败放弃本次写入，不新建重复条目
- [x] 2.4 未命中走 `storeMemory`，显式 `origin=agent`、`trust=low`
- [x] 2.5 正文格式：结论 / 依据 / 状态 / 时间；单轮上限 3 条
- [x] 2.6 凭据拒绝规则：密码、token、私钥、验证码、含 userinfo 连接串、签名 URL
- [x] 2.7 不设置 `pinned_at`，不修改 `trust`
- [x] 2.8 单元测试：逐格正例 + 规格负例、同键异值不覆盖、C1 唯一目标、候选不进召回、凭据拒绝、上限丢弃、CAS 失败回退

## 3. AutoRecallService

- [x] 3.1 scope 过滤：global + 当前项目，排除 session scope
- [ ] 3.2 tags 精确命中优先，FTS 兜底
- [x] 3.3 准入：实体/环境覆盖检查，泛词与歧义返回空
- [x] 3.4 去重：排除 pinned id 与本会话已注入 id
- [x] 3.5 预算裁剪：≤3 条、≤300 字符（可配上限 1200），最小行动摘要
- [x] 3.6 不把 BM25 分数当概率或置信度阈值
- [x] 3.7 单元测试：命中/未命中/跨项目排除/去重/预算截断
- [x] 3.8 分层准入：高相关注入最小行动摘要；弱相关（仅泛词、无实体/环境覆盖）零注入，不降级为只给标题

## 4. v2 编排

- [x] 4.1 新增 `opencode/src/context/orchestrator.ts`：分区 try/catch（采集 / 召回 / 渲染 / 游标）
- [x] 4.2 从 `messages` 取最后一条真实 user 消息，排除 synthetic 与注入块
- [x] 4.3 用 `session_kv` 游标去重（`auto:capture:cursor:<sessionID>`）
- [x] 4.4 渲染 `<mem_block source="auto-recall">`，位于 Pin 块之后
- [x] 4.5 按 `(sessionID, messageID, memoryRevision)` 缓存召回结果
- [x] 4.6 子会话参与，排除 capture 提取会话
- [x] 4.7 影子模式：只记录元数据，不写库、不注入
- [x] 4.8 接线 `plugin-v2.ts`；v1 分支不新增
- [x] 4.9 同轮决策缓存：按 `(sessionID, messageID, memoryRevision)` 复用渲染结果，记忆变更/压缩/换任务时失效

## 5. 测试与验证

- [x] 5.1 `bun test` 全绿，新增测试覆盖 2.8 / 3.7
- [ ] 5.2 v2 真宿主：提供一条安全事实 → 新会话相关提问被实际注入
- [ ] 5.3 v2 真宿主：无关提问零注入
- [ ] 5.4 v2 真宿主：注入块不进入历史、不触发递归采集
- [ ] 5.5 故障注入：DB busy / 检索异常 / 渲染异常时主请求继续
- [ ] 5.6 v1 加载回归：工具、Pin、capture 行为不变
- [x] 5.7 性能：新增钩子延迟 p95 记录（目标 ≤20ms）
- [x] 5.8 注入位置验证：确认注入追加在 messages 末尾、位于宿主 4 个 ephemeral 缓存断点之后，未插入 system 或消息前部

## 6. 文档

- [x] 6.1 `docs/ARCHITECTURE.md`：新增自动记忆章节，标注「已实现 / 未实现」
- [x] 6.2 `docs/CONFIGURATION.md`：autoCapture / autoRecall 配置与默认档位
- [x] 6.3 中英 README：能力、限制（最终轮延迟、low trust 标注、不替代文档落盘）
- [x] 6.4 写明「PRD 原文等长依据仍必须写入仓库文档」

## 7. 发布前检查

- [x] 7.1 确认零数据库迁移（对比 schema）
- [x] 7.2 确认 Pin 块内容与位置未变（快照对比）
- [x] 7.3 确认 capture 审批边界未变
- [ ] 7.4 记录影子期指标基线，供开启前评估

## 8. 准入矩阵改造（2026-11-24 追加）

- [x] 8.1 规格落盘：`admission-rules.md`（判据、负例、限流、验收断言）
- [x] 8.2 core：`AutoCaptureService` 改为逐单元路由；qa 不再持久化；同键异值降候选
- [x] 8.3 core：候选写入复用 `beginCapture/completeCapture`；迁移 v4 允许 `trigger=auto`
- [x] 8.4 测试：core 119 例、opencode 46 例全绿（含矩阵逐格覆盖）
- [ ] 8.5 候选 14 天过期与按规则统计纠错比例（未实现）
- [ ] 8.6 发布 2.4.0-rc.1 / core 0.5.0 并做 tarball 安装验证
