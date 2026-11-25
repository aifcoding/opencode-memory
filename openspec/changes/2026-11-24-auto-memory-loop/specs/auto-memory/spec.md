## ADDED Requirements

### Requirement: 自动采集（v2）

系统 SHALL 把最后一条真实用户消息按准入矩阵逐单元路由（规则编号与判据见 `admission-rules.md`），不把整段信号继承到每句。满足完整绑定条件的单元写入正式记忆；有信息量但无法安全直写的单元写入待审批候选；其余丢弃。

#### Scenario: 明确保存直写

- **WHEN** 单元以「记住/记一下/保存下来」开头，正文非空、≤400 字、不是问句且不含凭据
- **THEN** 系统直写一条 `origin=agent`、`trust=low` 的记忆，tags 含 `auto:explicit` 与 `auto:rule:E1`

#### Scenario: 完整配置绑定直写

- **WHEN** 单元形如 `实体.字段=值` 或 `实体的字段是值`，实体为明确标识符，字段属白名单（地址/端口/版本/路径）且值通过类型校验
- **THEN** 系统直写该绑定；同一键已有不同值时 SHALL 只写入候选，不覆盖原记录

#### Scenario: 明确选型直写

- **WHEN** 单元形如「本项目决定采用 X」，X 为单个标识符且无额外分句
- **THEN** 系统直写 `type=decision` 的记忆

#### Scenario: 有信息量但无法安全直写

- **WHEN** 单元命中 E2 弱 explicit、S2 不完整结构化事实、D2 其他决策或 C2 无法定位目标的纠正
- **THEN** 系统写入 `memory_candidates`（`status=pending`），SHALL NOT 写入 `memories`

#### Scenario: 纠正更新

- **WHEN** 纠正单元给出实体、字段与新值，且唯一匹配一条 `agent/low` 记忆、旧值（若给出）与该记忆正文相符
- **THEN** 系统以 CAS 更新该条；零匹配、多匹配或旧值不符时 SHALL 只写入候选，不覆盖任何记录

#### Scenario: 问答对与无有效单元

- **WHEN** 单元只能靠「上一轮助手问过 + 本轮短回复」判断（如「深蓝色」），或未命中任何规则
- **THEN** 问答对落低价值候选（长度 <2、纯确认或填充语仍丢弃）；未命中规则则不写入

#### Scenario: 单条消息上限

- **WHEN** 单条消息命中超过 3 条直写
- **THEN** 前 3 条直写，其余转候选（每消息最多 6 条候选），超出部分记录到 `skipped`

### Requirement: 候选隔离

未审批候选 SHALL 不进入 `memories`，因此默认召回与 `memory_recall` 均不返回；候选审批沿用现有审核流程。

#### Scenario: 候选审批前

- **WHEN** 自动采集只产生了候选
- **THEN** `memories` 行数与召回结果均不变

#### Scenario: 审批后

- **WHEN** 审核通过某条自动候选
- **THEN** 生成正式记忆并可按原有召回规则检索，候选状态变为 `approved`

### Requirement: 凭据不落库

自动采集 SHALL 在写入前检查凭据形态；命中密码、token、私钥、验证码、含 userinfo 的连接串、签名 URL 或 Authorization/Bearer/JWT 时，SHALL 将命中片段脱敏为 `[REDACTED]` 后继续；仅当整条消息只包含凭据时 MUST 放弃。脱敏基于正则，不保证识别所有秘密。

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
