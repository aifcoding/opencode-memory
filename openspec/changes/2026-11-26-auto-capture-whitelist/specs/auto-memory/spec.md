## ADDED Requirements

### Requirement: 只有完整记忆形态可以准入

系统 SHALL 在规则采集入口解析输入是否构成完整记忆形态（显式保存、配置绑定、决策、约定/偏好、纠正、根因/方案）；解析不完整、语义不确定或未匹配时 SHALL 丢弃，SHALL NOT 生成兜底候选。

#### Scenario: 不完整输入

- **WHEN** 输入只含有价值的关键词但无法解析出完整形态（如 `以后都这样`）
- **THEN** 不写正式记忆、不写候选

#### Scenario: 多义或未消费输入

- **WHEN** 输入包含多个候选形态或存在无法解析的残留
- **THEN** 丢弃，不按规则顺序猜测

### Requirement: 弱信号兜底入口必须删除

系统 SHALL 删除 Q 规则的采集分支，SHALL 删除 E2 弱关键词兜底与 S2「不完整就候选」；历史枚举可保留用于读取，SHALL NOT 产生新的写入。

#### Scenario: 上轮助手问句后的短回复

- **WHEN** 上一条助手消息含问句、用户回复 `深蓝色`
- **THEN** 正式记忆与候选均无新增

#### Scenario: 文档矛盾修复

- **WHEN** 准入文档声明 `qa` 不持久化
- **THEN** 代码行为与文档一致，不生成 Q 候选

### Requirement: 陈述状态闸门对所有形态生效

系统 SHALL 对问句、提议、假设、待确认事实与临时安排拒绝自动持久化，SHALL NOT 允许纠正或配置解析绕过该闸门。

#### Scenario: 问句中的配置片段

- **WHEN** 输入为 `如果 probe.port=18093，会怎样？`
- **THEN** 丢弃，不拆分后命中配置绑定

#### Scenario: 临时安排

- **WHEN** 输入为 `本次发布先跳过全量测试`
- **THEN** 不写正式记忆、不写候选

### Requirement: 直写出口限定

系统 SHALL 只允许以下情形直写正式记忆：新增配置绑定（S1）、完整纠正更新（C1，含旧值核对与唯一目标）、显式保存且完整解析为配置绑定/决策/约定。其余完整形态 SHALL 只写候选。

#### Scenario: 显式保存 + 配置

- **WHEN** 输入为 `记住：probe.port=18093`
- **THEN** 按配置绑定直写，返回记忆 id

#### Scenario: 显式保存 + 决策

- **WHEN** 输入为 `记住：本项目已决定采用 SQLite，原因是离线部署`
- **THEN** 完整解析后直写；若缺少选择或原因则转候选或丢弃

#### Scenario: 非显式决策

- **WHEN** 输入为 `本项目已决定采用 SQLite，原因是离线部署`
- **THEN** 只写候选

### Requirement: 直写不得覆盖与必须可撤回

系统 SHALL 在标题或键冲突时降级为候选；直写结果 SHALL 返回记忆 id 并保留原文作用域措辞。

#### Scenario: 同键异值

- **WHEN** 已存在 `probe.port=18093`，输入 `记住：probe.port=18094` 且无纠正依据
- **THEN** 不覆盖旧记忆，生成候选

#### Scenario: 撤回

- **WHEN** 用户对直写结果执行 `memory_forget`
- **THEN** 该记忆软删，不再参与检索与召回

### Requirement: 新规则必须先 shadow 再启用

系统 SHALL 支持新旧规则并行 shadow（只记录差异、不写库），对比通过后再启用；SHALL NOT 自动重放历史会话或批量回滚旧规则产生的正式记忆。

#### Scenario: shadow 模式

- **WHEN** 启用 shadow
- **THEN** 正式记忆与候选均无写入，差异可审计

#### Scenario: 噪声候选清理

- **WHEN** 确认历史候选为噪声
- **THEN** 逐条 reject 保留审计，不直接删除记录
