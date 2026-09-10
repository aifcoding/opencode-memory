# retrieval Specification

## Purpose
定义长期记忆的中文分词、全文检索、相关度排序、无匹配语义和作用域过滤行为。

## Requirements

### Requirement: 中文分词检索

系统 SHALL 用 jieba 对写入内容预分词后写入 FTS body，查询时用同一分词管线，使中文 2 字词（如「头像」）可被召回。

#### Scenario: 中文 2 字词可召回
- **WHEN** 存入内容「微信头像加载失败」，以「头像」检索
- **THEN** 命中该条目（jieba 切出「头像」独立词元）

#### Scenario: 英文与标识符保留
- **WHEN** 内容含 `foo_bar`、`CamelCase` 等标识符
- **THEN** 分词后保留可检索的标识符词元（不因中文分词丢失）

### Requirement: recall 语义

`search` SHALL 返回 `{id, score}` 列表，按相关度降序；**有 query 无匹配时返回空**，绝不回退返回最新条目。

#### Scenario: 无匹配返空
- **WHEN** 检索词与库中无任何匹配
- **THEN** 返回空列表，不返回无关条目

#### Scenario: 结果带 id 与 score
- **WHEN** 检索命中多条
- **THEN** 每条含 id 与 score（score 高=更相关），按 score 降序

### Requirement: scope 过滤

`search` SHALL 支持按 `(scope, scope_key)` 过滤并排除软删条目。当提供 `(scope, scope_key)` 时仅返回该作用域内条目；不提供时执行跨作用域搜索。

#### Scenario: 按 scope 过滤
- **WHEN** 以 scope=project + scope_key=/x 检索
- **THEN** 仅返回该 scope 下未删除条目
