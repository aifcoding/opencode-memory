## 0. Runtime Spike

- [x] 0.1 验证 OpenCode 是否支持从当前 session fork 隔离的提取 Agent，记录实际 SDK 签名
- [x] 0.2 验证 fork Agent 可指定 agent/model，失败不影响主会话
- [x] 0.3 验证工具调用上下文能否取得稳定 message ID；不能则记录 manual UUID 方案
- [x] 0.4 验证 compaction 事件中 compaction message ID 的稳定性
- [x] 0.5 验证读取的消息结构可可靠区分 user/assistant/tool/tool-result/合成 overlay

## 1. 数据模型与迁移

- [x] 1.1 新增 capture run 与 candidate 领域类型
- [x] 1.2 新增迁移创建 `memory_capture_runs`
- [x] 1.3 新增迁移创建 `memory_candidates`
- [x] 1.4 增加候选状态、domain、固定 origin/trust 的 CHECK 约束
- [x] 1.5 增加 capture 幂等键和 candidate 去重索引
- [x] 1.6 用 0.1.x 数据库验证无损升级
- [ ] 1.7 Deferred to pre-release verification：真实多进程迁移并发与重复启动验证

## 2. Core Capture API

- [x] 2.1 实现 captureKey 稳定 SHA-256 计算
- [x] 2.2 实现 `beginCapture` 与 lease 获取/过期重试
- [x] 2.3 实现 `completeCapture`，单事务写 run 与 candidates
- [x] 2.4 实现 `failCapture`，只存非敏感 errorCode
- [x] 2.5 实现候选列表与读取 API
- [x] 2.6 实现 approve/reject 状态机
- [x] 2.7 实现批准候选时 memories + FTS + candidate 原子事务
- [x] 2.8 实现正式 memory 已存在时的 `already_exists`
- [x] 2.9 从 Core 根入口导出全部公共类型和方法
- [x] 2.10 验证 pending/rejected 不进入正式读取、检索或 Pin 链路

## 3. 安全扫描

- [x] 3.1 定义 `CandidateRiskCode`
- [x] 3.2 实现高置信凭据格式检测，禁止输出/记录命中原文
- [x] 3.3 实现 bidi 控制字符检测
- [x] 3.4 实现高风险不可见 Unicode 检测
- [x] 3.5 `completeCapture` 写入前扫描并过滤风险候选
- [x] 3.6 `approve` 前再次扫描
- [x] 3.7 增加凭据、Unicode、日志不泄漏测试

## 4. 防递归消息过滤

- [x] 4.1 定义内部 `CaptureMessage`
- [x] 4.2 只保留 user/assistant 自然语言 text part
- [x] 4.3 排除 tool call、tool result 和工具角色消息
- [x] 4.4 排除 Pin overlay 合成消息和 marker
- [x] 4.5 排除 memory-context、mem_block 和候选围栏来源
- [x] 4.6 排除提取 Agent 自身输出
- [x] 4.7 增加「记忆→注入→再次提取」负向测试
- [x] 4.8 验证无法识别来源的消息默认不进入提取输入

## 5. 提取 Prompt 与解析

- [x] 5.1 编写 `capture-v1` Prompt
- [x] 5.2 明确 Capture 和 Do NOT Capture 清单
- [x] 5.3 定义严格 Zod 输出 Schema
- [x] 5.4 限制候选数量、字段长度、tags 数量和枚举
- [x] 5.5 非法 JSON 或未知字段时整体失败
- [x] 5.6 实现 suggestedDomain 提示语义
- [x] 5.7 Prompt 或 Schema 变化时使用新 extractorVersion

## 6. OpenCode Adapter

- [x] 6.1 扩展严格配置 Schema，capture 默认关闭
- [x] 6.2 enabled=true 时校验提取 Agent 配置
- [x] 6.3 实现内部 fork Agent 提取函数
- [x] 6.4 实现 `memory_capture`
- [x] 6.5 实现 `memory_candidates`
- [x] 6.6 实现 `memory_candidate_read`
- [x] 6.7 实现 `memory_candidate_review`
- [x] 6.8 为候选输出增加 low-trust reference 围栏和转义
- [x] 6.9 在 compaction 摘要归档成功后可选触发 capture
- [x] 6.10 capture 失败只记非敏感日志，不中断 compaction
- [x] 6.11 保持现有工具参数和输出兼容

## 7. 测试与评测

- [x] 7.1 状态机测试：pending→approved/rejected
- [x] 7.2 重复 approve/reject 测试
- [x] 7.3 capture run 幂等与 lease 测试
- [x] 7.4 compaction 重复事件不重复提取
- [x] 7.5 正式 memory、FTS 与 candidate 审批事务回滚测试
- [x] 7.6 candidate 与正式 recall/Pin 隔离测试
- [x] 7.7 code/user/business/uncertain 分类测试
- [x] 7.8 建立提取金标数据集
- [x] 7.9 输出 Precision、Recall、误提取率和重复率基线
- [x] 7.10 记录典型误判，不设未经验证的发布阈值
- [x] 7.11 运行全部测试、typecheck、format check 和 build
- [ ] 7.12 Deferred to pre-release verification：从 tarball 安装并验证旧数据库升级

## 8. 文档与发布

- [x] 8.1 更新根 README：自动提取默认关闭、成本隐私边界
- [x] 8.2 更新 Core README：Candidate API 和状态机
- [x] 8.3 更新 OpenCode README：配置和新增工具
- [x] 8.4 更新 ARCHITECTURE：capture 数据流、表结构、安全边界
- [x] 8.5 更新 ROADMAP：安全辅助提取移入已实现
- [x] 8.6 验证 OpenSpec change
- [ ] 8.7 Deferred to pre-release verification：完成真实 OpenCode 提取链路验证
- [ ] 8.8 Deferred to pre-release verification：发布前核对凭据不进入日志、测试夹具和 tarball
