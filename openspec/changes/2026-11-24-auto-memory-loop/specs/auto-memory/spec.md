## ADDED Requirements

### Requirement: 自动采集（v2）

系统 SHALL 在 v2 会话中按信号自动识别值得长期保存的信息，并写入现有 `memories`；SHALL NOT 新增表、列或结构化事实模型。

#### Scenario: 显式指示

- **WHEN** 用户消息包含「记住」「以后都用」「配置是」等显式指示，且内容不含凭据
- **THEN** 系统写入一条 `origin=agent`、`trust=low` 的记忆，正文包含结论、依据、状态与时间

#### Scenario: 纠正覆盖

- **WHEN** 用户消息包含纠正信号（「不是…是…」「改成」「应该是」）且归一化 title 命中已有记忆
- **THEN** 系统以 CAS 更新该记忆的 `content` 与 `summary`，不新增重复条目

#### Scenario: 信号不足不写

- **WHEN** 消息仅含泛词、礼貌回复、无来源推测，或环境/对象无法确定
- **THEN** 系统不写入任何记忆

#### Scenario: 单轮上限

- **WHEN** 同一轮命中超过 `maxWritesPerTurn` 条候选
- **THEN** 系统按信号优先级保留高优先级条目，其余丢弃并记录计数

### Requirement: 凭据不落库

自动采集 SHALL 在写入前检查凭据形态；命中密码、token、私钥、验证码、含 userinfo 的连接串或签名 URL 时，MUST 整条拒绝本次自动写入，不得尝试部分保存或「脱敏后保存」。

#### Scenario: 含密码的配置

- **WHEN** 用户提供的连接信息包含密码或完整连接串
- **THEN** 系统放弃该条自动写入，不保存密码值，也不保存该条的其他字段

#### Scenario: 无法判定

- **WHEN** 文本无法判定是否含凭据
- **THEN** 系统放弃自动写入，不降级为「脱敏后保存」

### Requirement: 自动召回（v2）

系统 SHALL 在每个模型请求前，按当前用户任务检索少量高相关记忆并以摘要级参考块注入；SHALL NOT 依赖模型主动调用工具。

#### Scenario: 命中注入

- **WHEN** 当前任务与某记忆的 tags 或关键词强相关，且未被 Pin
- **THEN** 系统注入不超过预算的摘要块，并标注 id、状态与「需全文用 memory_read」

#### Scenario: 无关零注入

- **WHEN** 当前任务无匹配，或仅命中泛词，或环境/项目冲突
- **THEN** 系统不注入任何自动记忆，Pin 块不受影响

#### Scenario: 注入不落历史

- **WHEN** 自动召回块被注入
- **THEN** 该块不持久化到消息历史，也不成为下一轮采集的证据

### Requirement: 预算与顺序

自动召回块 SHALL 位于 Pin 块之后，SHALL 与 Pin 共用「本次请求最终渲染」的可见性但不合并内容；自动召回 SHALL 受独立预算限制。

#### Scenario: 默认预算

- **WHEN** 未显式配置预算
- **THEN** 自动召回最多 3 条、总计不超过 300 字符（可配上限 1200，含来源与包裹标记）

#### Scenario: 去重

- **WHEN** 某记忆已 Pin，或本会话已注入过
- **THEN** 自动召回不再重复注入该 id

### Requirement: 失败隔离

采集、召回、渲染与游标推进 SHALL 各自隔离失败；任何失败 MUST NOT 打断主模型请求，MUST NOT 影响 Pin 注入。

#### Scenario: 采集失败

- **WHEN** 写入数据库失败或 CAS 冲突
- **THEN** 本轮放弃采集，召回与 Pin 仍正常执行

#### Scenario: 检索失败

- **WHEN** 检索抛错或超时
- **THEN** 不注入自动召回块，主请求继续

### Requirement: 默认档位与影子模式

自动采集 SHALL 默认启用（只收高置信信号、`trust=low`、单轮 ≤3 条）；自动召回 SHALL 默认 `auto`（检索并按准入注入 ≤300 字符摘要），`hint` 仅作为可选档。影子模式 SHALL 不写库、不注入；当前实现不产生决策记录。

#### Scenario: 默认配置

- **WHEN** 用户未配置 autoCapture / autoRecall
- **THEN** 自动采集启用、自动召回为 `auto`；无关问题仍零注入

#### Scenario: 影子记录

- **WHEN** `mode=shadow`
- **THEN** 系统记录信号类型、候选数量、是否命中、预算与耗时，不写入记忆、不注入内容

### Requirement: 子会话

子会话 SHALL 参与自动采集与召回；系统 MUST 排除 capture 提取会话以避免递归。

#### Scenario: 子会话采集

- **WHEN** 子会话中产生有价值结论
- **THEN** 系统按该会话的项目归属写入，scope 不得默认 global

#### Scenario: 递归排除

- **WHEN** 当前会话是 capture 提取会话
- **THEN** 系统不执行自动采集，也不注入自动召回
