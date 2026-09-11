## MODIFIED Requirements

### Requirement: 可插件化分词器

Core SHALL 提供单方法 `Tokenizer { tokenize(text): string }`。默认 Tokenizer 为 jieba-wasm；SQLite Store 和工厂 SHALL 支持注入自定义 Tokenizer，且长期知识与情景摘要的写入和查询必须使用同一实例。Tokenizer 输出为空词元时查询 SHALL 安全返回空结果，不自动重建已有索引；已有数据库必须继续使用兼容的 Tokenizer。

#### Scenario: 默认 jieba Tokenizer

- **WHEN** 未提供 tokenizer 选项
- **THEN** 写入和查询使用默认 jieba-wasm 实现

#### Scenario: 自定义 Tokenizer

- **WHEN** 调用 SQLite Store 或工厂时提供 tokenizer
- **THEN** Core 使用该实例处理索引写入和查询

#### Scenario: 长期知识和情景摘要保持一致

- **WHEN** 写入并查询长期知识或情景摘要
- **THEN** 两条路径均调用同一个 Tokenizer 实例

#### Scenario: 空词元

- **WHEN** Tokenizer 返回空字符串
- **THEN** 查询不报错并返回空结果

#### Scenario: 更换 Tokenizer 不自动重建

- **WHEN** 为已有数据库直接更换 Tokenizer
- **THEN** Core 不自动重建旧索引，调用者需使用兼容 Tokenizer 或导出后重新导入新数据库
