## ADDED Requirements

### Requirement: 准入优先于排序

自动召回的候选选择 SHALL 先按 scope 与 tags 收敛，再使用 FTS 关键词；MUST NOT 用 BM25 分数单独决定是否注入。

#### Scenario: scope 优先

- **WHEN** 相同关键词在两个项目下都有命中
- **THEN** 只返回当前项目与 global 作用域的候选，另一项目的记忆不得进入结果

#### Scenario: 分数语义

- **WHEN** 使用 FTS 结果排序
- **THEN** score 只表示本次查询的相对相关度，不得解释为概率、置信度或跨查询可比指标

#### Scenario: 泛词不注入

- **WHEN** 命中仅来自「那个」「这个」「配置」等泛词，且无实体或环境覆盖
- **THEN** 返回空候选，不注入

### Requirement: 摘要级返回

自动召回 SHALL 只使用摘要级内容（title + summary，或正文前 200 字符预览），完整正文由 `memory_read` 获取。

#### Scenario: 摘要为空

- **WHEN** 命中记忆没有 summary
- **THEN** 使用正文前 200 个 UTF-16 code unit 作为预览，不修改数据库

#### Scenario: 不返回全文

- **WHEN** 自动召回组装注入内容
- **THEN** 不得包含完整 content
