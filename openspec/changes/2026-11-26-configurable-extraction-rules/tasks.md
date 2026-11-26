# 任务：可配置提取规则与模型

> 全部未完成。完成一项打勾，并在 PR/提交说明里附验证命令与结果。

## 1. core：指令组合与规则文件

- [x] 1.1 新增 `extraction/instructions.ts`：`composeInstructions(userRules)` 生成「用户提取偏好 + 程序附加约束」两段文本，常量与模板集中管理
- [x] 1.2 新增默认规则源 `extraction/default-rules.md`，纳入构建产物（验证发布包内含该文件）
- [x] 1.3 规则文件契约：绝对路径、UTF-8、大小上限、空文件拒绝、不支持 URL/include；错误码 `instructions_unreadable` / `instructions_too_large`
- [x] 1.4 规则文件内容在发送前做凭据扫描，命中即拒绝且不回显
- [ ] 1.5 材料与指令分离：`TextGenerator` 输入保持 `instructions` + `data` 两段；单文本宿主由适配器负责边界标记与碰撞检测

## 2. core：校验瘦身与幂等

- [x] 2.1 `validateCaptureCandidates` 移除质量规则：标题/正文长度、短问句、`evidenceQuote` 必填与原文存在、同批标题去重
- [x] 2.2 保留结构规则：合法 JSON、字段类型（不做 `String()` 强转）、类型/领域枚举、字段白名单、候选数上限、输出总大小
- [x] 2.3 `ExtractionService` 任务身份加入「最终有效 instructions 的内容 hash」与风控契约版本、实际模型指纹
- [ ] 2.4 失败码新增：`model_selection_unsupported`、`tool_isolation_unsupported`、`instructions_unreadable`、`instructions_too_large`、`session_cleanup_failed`
- [x] 2.5 单元测试：指令顺序与冲突声明、规则文件失败、结构校验保留项、幂等身份变化/稳定

## 3. opencode：配置、执行链与迁移

- [x] 3.1 新增 `capture.model {provider, model, variant?}`；未配置走宿主默认；配置不可用 → 失败不回退
- [x] 3.2 新增 `capture.instructionsFile`；未配置用内置默认规则
- [x] 3.3 执行链：`create → update(permission 全 deny) → switchModel(仅配置时) → generate → remove`
- [ ] 3.4 超时先于租约；取消生成、确认终止、再删除；清理失败记 `session_cleanup_failed`
- [x] 3.5 迁移：`target.model` → `capture.model`；`host-default` → 不配；`agent`/`target.agent` 报弃用错误；新旧同现拒绝
- [ ] 3.6 配置上限校验：`maxCandidates` / `maxInputChars` / `maxOutputTokens` / `timeoutMs < 租约`
- [x] 3.7 单元测试：配置解析与迁移、执行顺序、失败不回退

## 4. mcp

- [x] 4.1 `extraction.instructionsFile` 复用同一组合契约；未配置用内置默认
- [ ] 4.2 失败码与 core 对齐；工具结果不回显规则或材料原文
- [ ] 4.3 端到端：真实 provider 跑一次 `memory_extract`（需环境变量名，不含具体值）

## 5. 文档

- [x] 5.1 README 中英：`capture.model` / `instructionsFile` / 迁移说明 / 「提示词优先不是安全边界」
- [x] 5.2 `docs/CONFIGURATION.md`：新配置表、默认规则、失败语义
- [x] 5.3 `docs/ADAPTER-CONTRACT.md`：指令组合与材料分离、最小风控集、执行链、幂等身份
- [ ] 5.4 `docs/ARCHITECTURE.md`：更新提取管线为「配置模型 + 可编辑规则 + 基础风控」

## 6. 验收（确定性）

- [x] 6.1 md 与附加约束冲突 → 组合顺序正确，附加约束在后
- [ ] 6.2 材料伪造「程序附加约束」标题/角色声明 → 不改变 tools/scope/审批
- [ ] 6.3 幻觉/重复/无引用候选 → 只能是 pending；正式库与召回无新增
- [ ] 6.4 模型返回 `status=approved`、外部 scope、未知字段 → 被忽略或拒绝
- [ ] 6.5 md/材料/边界含凭据样本 → 外发前拒绝，错误不含内容
- [ ] 6.6 超大响应/大量候选/无限等待 → 预算内中止
- [ ] 6.7 同任务并发、失败重试 → 不重复提交，旧租约不能完成写入
- [ ] 6.8 修改 md 或附加约束段 → 任务身份变化；都不变 → 身份稳定
- [ ] 6.9 reject 永不进入正式记忆；approve 后才可召回

## 7. 验收（真实链路，必须真机）

- [ ] 7.1 临时子会话工具确实不可执行（含 MCP 工具）
- [ ] 7.2 超时后生成确实终止，会话被清理
- [ ] 7.3 请求顺序与角色正确：instructions 在后置约束段，材料作为数据
- [ ] 7.4 未配 model 时实际使用宿主默认模型；配了 model 时实际使用配置模型
- [ ] 7.5 pending 候选不进入实际召回链路
