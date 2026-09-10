## 1. 存储层

- [x] 1.1 迁移 v2 建 `session_summaries` + FTS，验证 bun test 全绿

- [x] 1.2 实现 `archiveSummary`（幂等）+ `searchSummaries`（jieba + BM25），验证归档与检索用例

## 2. 插件

- [x] 2.1 实现 `event` 钩子（session.compacted → 读 messages → 抽 compaction 摘要 → 归档），验证端到端

- [x] 2.2 实现 `recall_summaries` 工具

## 3. 文档

- [x] 3.1 `openspec validate --changes` 通过并归档
