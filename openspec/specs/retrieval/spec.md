# retrieval Specification

## Purpose

定义长期记忆与情景摘要的分词、全文检索、相关度排序、无匹配语义和作用域过滤行为。

## Requirements

### Requirement: 中文分词检索

系统 SHALL 用默认 jieba-wasm 对写入内容预分词后写入 FTS body，查询时用同一分词管线，使中文 2 字词可被召回。

#### Scenario: 中文 2 字词可召回

- **WHEN** 存入内容「微信头像加载失败」，以「头像」检索
- **THEN** 命中该条目

#### Scenario: 英文与标识符保留

- **WHEN** 内容含 `foo_bar`、`CamelCase` 等标识符
- **THEN** 分词后保留可检索的标识符词元

### Requirement: recall 语义

`MemoryManager.recallMemories` SHALL 返回 `{ memories: [{ memory, score }] }` 并按 score 降序；有 query 无匹配时返回空，绝不回退最近条目。OpenCode Adapter 仅负责格式化。

#### Scenario: 无匹配返空

- **WHEN** 检索词与库中无任何匹配
- **THEN** 返回空列表，不返回无关条目

#### Scenario: 结果带 id 与 score

- **WHEN** 检索命中多条
- **THEN** 每条含完整 memory 与 score，并按 score 降序

### Requirement: scope 过滤

`search` SHALL 支持按 `(scope, scope_key)` 过滤并排除软删条目；不提供过滤时执行跨作用域搜索。

#### Scenario: 按 scope 过滤

- **WHEN** 以 scope=project + scope_key=/x 检索
- **THEN** 仅返回该 scope 下未删除条目

### Requirement: 可插件化分词器

Core SHALL 提供单方法 `Tokenizer` 接口，默认实现为 jieba-wasm。SQLite Store 和工厂 SHALL 支持注入自定义 Tokenizer，长期知识与情景摘要的写入和查询必须使用同一实例。Tokenizer 返回空词元时查询 SHALL 安全返回空结果；更换 Tokenizer 不自动重建旧索引，已有数据库必须继续使用兼容的 Tokenizer。

#### Scenario: 自定义 Tokenizer

- **WHEN** 调用 SQLite Store 或工厂时提供 tokenizer
- **THEN** 写入和查询均使用该 Tokenizer 实例

#### Scenario: 默认 jieba Tokenizer

- **WHEN** 未提供 tokenizer 选项
- **THEN** 写入和查询使用默认 jieba-wasm 实现

#### Scenario: 长期知识和情景摘要保持一致

- **WHEN** 写入并查询长期知识或情景摘要
- **THEN** 两条路径均调用同一个 Tokenizer 实例

#### Scenario: 空词元

- **WHEN** Tokenizer 返回空字符串
- **THEN** 查询不报错并返回空结果

#### Scenario: 更换 Tokenizer 不自动重建

- **WHEN** 为已有数据库直接更换 Tokenizer
- **THEN** Core 不自动重建旧索引，调用者需使用兼容 Tokenizer 或导出后重新导入新数据库

#### Scenario: 已有数据库使用兼容 Tokenizer

- **WHEN** 打开已有数据库
- **THEN** 使用与其索引格式兼容的 Tokenizer，避免漏召回
