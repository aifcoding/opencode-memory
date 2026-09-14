## ADDED Requirements

### Requirement: 安全辅助记忆提取

系统 SHALL 从经过过滤的会话内容中生成候选记忆，而不是直接创建正式记忆。模型输出必须通过严格 Schema、确定性安全扫描和候选审批流程。

#### Scenario: Agent 只创建候选

- **WHEN** 提取 Agent 返回合法候选
- **THEN** 候选以 `origin=agent`、`trust=low`、`status=pending` 保存，不直接写入正式 memories

#### Scenario: 不自动批准或固定

- **WHEN** 候选提取完成
- **THEN** 系统不自动批准、不自动 Pin，也不自动注入该候选

### Requirement: 默认关闭

模型提取 SHALL 默认关闭。未显式启用时，系统不得因 compaction 自动调用提取模型。

#### Scenario: 默认配置

- **WHEN** 用户未配置 capture 或 `capture.enabled=false`
- **THEN** compaction 摘要正常归档，但不调用提取 Agent，不创建 capture run 或 candidate

#### Scenario: 显式工具在未启用时调用

- **WHEN** 用户调用 `memory_capture` 但 capture 未启用
- **THEN** 工具返回配置提示，不调用模型

### Requirement: 两种提取触发方式

系统 SHALL 支持 compaction 后提取和用户显式触发提取，不支持每 N 轮后台提取。

#### Scenario: Compaction 后提取

- **WHEN** capture 已启用、`onCompaction=true` 且新 compaction 摘要归档成功
- **THEN** Adapter 使用 compaction ID 作为 sourceId 启动候选提取

#### Scenario: 用户显式提取

- **WHEN** 用户调用 `memory_capture`
- **THEN** Adapter 对当前会话执行一次候选提取

### Requirement: 防递归污染

提取输入 SHALL 排除历史记忆注入、记忆工具结果、候选结果、工具调用与工具输出。过滤必须优先依赖结构化消息元数据。

#### Scenario: 排除 Pin overlay

- **WHEN** 会话消息包含插件合成的 Pin overlay
- **THEN** overlay 不进入提取输入

#### Scenario: 排除 Recall 与 Read 结果

- **WHEN** 会话包含 memory_recall、memory_read 或 recall_summaries 的工具结果
- **THEN** 工具结果不进入提取输入

#### Scenario: 排除已有参考块

- **WHEN** 消息包含插件生成的 memory-context、mem_block 或 candidate reference
- **THEN** 该参考数据不被再次提取为候选

#### Scenario: 无法识别来源

- **WHEN** Adapter 无法确认某条消息是用户或助手自然语言
- **THEN** 该消息默认不进入提取输入

### Requirement: 严格提取范围

提取 Agent SHALL 只提出稳定偏好、项目约定、已确认决策、可复用根因和重复工作流程，并遵守 Do NOT Capture 清单。

#### Scenario: 稳定项目约定

- **WHEN** 会话明确确认一条未来仍适用的工程约定
- **THEN** 提取 Agent 可以生成对应候选

#### Scenario: 一次性任务状态

- **WHEN** 内容只描述当前任务进度或临时限制
- **THEN** 不生成长期记忆候选

#### Scenario: 未验证猜测

- **WHEN** 会话只提出尚未确认的根因或方案
- **THEN** 不生成候选

#### Scenario: 凭据内容

- **WHEN** 内容包含密码、Token、API Key、验证码、Cookie 或私钥
- **THEN** 不生成可持久化候选

### Requirement: 严格输出 Schema

提取 Agent 输出 SHALL 通过严格 Schema；系统不得通过猜测或宽松修复接受不完整输出。

#### Scenario: 合法 JSON

- **WHEN** 输出符合 `ExtractCandidatesOutput`
- **THEN** 系统逐条执行领域校验和安全扫描

#### Scenario: 非法输出

- **WHEN** 输出不是合法 JSON、包含未知字段、非法枚举或超出限制
- **THEN** 本次 capture 标记失败，不保存部分候选

### Requirement: suggestedDomain

每个候选 SHALL 带有 `code|user|business|uncertain` 分类建议。该字段只用于审批提示，不构成权限边界。

#### Scenario: Code 候选

- **WHEN** suggestedDomain 为 code
- **THEN** 工具提示该候选适合在 OpenCode 记忆中审批

#### Scenario: 用户或业务候选

- **WHEN** suggestedDomain 为 user 或 business
- **THEN** 工具提示该内容更适合交由个人或业务协调 Agent 管理

#### Scenario: 不确定候选

- **WHEN** suggestedDomain 为 uncertain
- **THEN** 工具要求用户判断归属

### Requirement: 基础安全扫描

Core SHALL 在候选写入前和批准前检查高置信凭据、bidi 控制字符及高风险不可见 Unicode。

#### Scenario: 风险候选被过滤

- **WHEN** 候选命中任一高风险规则
- **THEN** 候选不持久化，仅增加 filteredCount 并记录风险代码

#### Scenario: 日志不泄漏

- **WHEN** 候选因安全扫描被过滤
- **THEN** 日志和错误结果不包含命中原文、凭据片段或完整候选内容

### Requirement: 提取运行幂等

自动提取 SHALL 使用 contextKey、sourceId 和 extractorVersion 生成稳定幂等键。

#### Scenario: 重复 compaction 事件

- **WHEN** 同一个 compaction 事件重复到达且已有 completed run
- **THEN** 不重复调用模型、不重复创建候选

#### Scenario: 并发运行

- **WHEN** 相同 captureKey 已有未过期 running lease
- **THEN** 返回 in_progress，不启动第二次提取

#### Scenario: 过期 Lease

- **WHEN** running lease 已过期
- **THEN** 新调用者可以获取新 lease 并重试

### Requirement: 用户审批状态机

候选 SHALL 仅由用户显式 approve 或 reject。

#### Scenario: 批准候选

- **WHEN** 用户批准 pending 候选
- **THEN** 系统创建 `origin=agent`、`trust=high` 的正式 memory，将候选标为 approved，返回正式 memory ID

#### Scenario: 拒绝候选

- **WHEN** 用户拒绝 pending 候选
- **THEN** 候选标为 rejected，不创建正式 memory

#### Scenario: 重复审批

- **WHEN** 用户再次审批 approved 或 rejected 候选
- **THEN** 返回 already_reviewed，不修改已有结果

#### Scenario: 已有相同正式记忆

- **WHEN** 批准候选时同作用域已存在相同 content_hash 的正式记忆
- **THEN** 不创建重复 memory，候选关联已有 memory 并返回 already_exists

### Requirement: 审批原子性

批准候选时，正式 memory、FTS 和 candidate 状态 SHALL 在同一事务中更新。

#### Scenario: 审批写入失败

- **WHEN** memory、FTS 或 candidate 任一步更新失败
- **THEN** 整个审批事务回滚，候选保持 pending

### Requirement: 候选隔离

pending 和 rejected 候选 SHALL 不参与正式记忆检索、列表、Pin、注入或情景摘要检索。

#### Scenario: Pending 候选不可召回

- **WHEN** 候选仍为 pending
- **THEN** memory_recall 和 recallMemories 不返回该候选

#### Scenario: Pending 候选不可固定

- **WHEN** 调用者尝试通过正式 Pin API 固定候选 ID
- **THEN** 系统不将候选加入固定记忆

### Requirement: 提取质量评测

项目 SHALL 维护可复现的候选提取金标集，并优先报告 Precision。

#### Scenario: 运行评测

- **WHEN** 执行 capture benchmark
- **THEN** 输出 Precision、Recall、False Positive Rate、Duplicate Rate 和 Domain Classification Accuracy

#### Scenario: 发布记录

- **WHEN** 发布 0.2.0
- **THEN** 记录基线结果和典型误判，不宣称未经数据支持的准确率
