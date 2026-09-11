## Why

默认 jieba-wasm 对非中文场景的分词控制不够，Core 需要允许应用按自身检索需求注入分词逻辑。

## What Changes

- 增加框架无关的 `Tokenizer` 接口和默认 jieba-wasm 实现。
- SQLite Store 和 `createSqliteMemoryManager` 接受 `tokenizer` 选项。
- 写入 FTS 与查询统一使用同一个 Tokenizer。

## Impact

修改 retrieval spec；现有默认行为、数据库 Schema 和公共 Manager 方法保持不变。
