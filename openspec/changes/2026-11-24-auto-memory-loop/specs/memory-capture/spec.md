## ADDED Requirements

### Requirement: 自动写入与候选提取的边界

自动记忆写入 SHALL NOT 替代或绕过现有候选审批流程；两者是并列路径，适用于不同置信度与来源的内容。

#### Scenario: 高确定性内容直接写入

- **WHEN** 内容来自用户明确陈述、明确纠正或结构化环境信息，且不含凭据
- **THEN** 自动采集可直接写入正式 `memories`（`origin=agent`、`trust=low`），不经过候选表

#### Scenario: 低确定性内容仍需候选

- **WHEN** 内容是模型推断、跨多轮归纳、语义含糊，或无法给出明确来源
- **THEN** 只能走现有 capture 候选流程，不得自动写入正式记忆

#### Scenario: 不自动批准候选

- **WHEN** 自动采集产生任何结果
- **THEN** 系统 MUST NOT 调用候选审批路径，MUST NOT 将候选转为 `trust=high`

### Requirement: 压缩前后均不重复采集

系统 SHALL 保证同一来源消息不会被重复采集；压缩触发的 capture 与自动采集 MUST NOT 对同一内容产生两份正式记忆。

#### Scenario: 同源去重

- **WHEN** 某条消息已被自动采集处理
- **THEN** 压缩时的 capture 提取不得再次生成该内容的正式记忆

#### Scenario: 注入内容不作为来源

- **WHEN** 会话中存在 `mem_block` 注入块（Pin 或自动召回）
- **THEN** capture 与自动采集都不得把这些注入块当作来源内容
