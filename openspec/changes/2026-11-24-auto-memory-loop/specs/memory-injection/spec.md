## ADDED Requirements

### Requirement: 自动召回块与 Pin 块共存

自动召回 SHALL 以独立参考块注入，SHALL NOT 修改、合并或重排现有 Pin 块的文本与位置。

#### Scenario: 顺序固定

- **WHEN** 同一请求同时存在 Pin 与自动召回结果
- **THEN** Pin 块在原位置先出现，自动召回块紧随其后

#### Scenario: 无召回不影响 Pin

- **WHEN** 自动召回无命中或失败
- **THEN** Pin 块内容、位置与行为完全不变

#### Scenario: 去重

- **WHEN** 某条记忆已被 Pin
- **THEN** 自动召回不得重复注入该记忆

### Requirement: 自动召回块预算

自动召回块 SHALL 受独立预算约束，默认不超过 3 条与 300 字符（可配上限 1200，含来源标记与包裹标签）。

#### Scenario: 超预算裁剪

- **WHEN** 候选总长度超过预算
- **THEN** 系统按相关度保留前缀，截断后仍保留 id、状态与读取提示

#### Scenario: 未命中零成本

- **WHEN** 无候选命中
- **THEN** 不产生任何注入文本
