# Roadmap

本文档记录 opencode-memory 的发布状态与未来规划方向。

- 具体功能通过 OpenSpec change 提案（`openspec/changes/`）推进。
- 设计取舍见 `docs/ARCHITECTURE.md` 的 D 系列决策记录。

## 已发布

- **v0.1.x**：三层记忆（长期知识 / 情景摘要 / 会话 KV）、中文检索（jieba-wasm + FTS5 + BM25）、显式 Pin 注入、压缩自动归档、软删除和事务一致性。

## 已实现待发布

- **Headless Core**：`@aifcoding/memory-core` 与 `@aifcoding/opencode-memory` monorepo、MemoryManager 和 SQLite 子路径。
- **可插件化分词器**：单方法 `Tokenizer` 接口、默认 jieba-wasm 和 SQLite 注入选项。

## 近期规划

- [ ] **召回评测基准**（Recall@K / MRR）——建立可复现数据集，量化现有 FTS 检索效果。
- [ ] **MCP Server**（`@aifcoding/memory-mcp`）——把记忆工具暴露为 MCP。
- [ ] **会话收尾自动提取 + origin=agent 信任分级**——低信任内容不自动注入。
- [ ] **Tokenizer 索引兼容管理**——持久化 tokenizer id/version，检测不兼容；自动索引重建尚未决定。
- [ ] **向量检索 + RRF**——仅当评测证明 FTS 对同义改写召回不足时实施。
- [ ] **项目级身份隔离**（D15）——用规范化 realpath 或安装 UUID 做稳定身份键。
- [ ] **TeamKbSource 多源检索**（D14）——接入团队知识源。
- [ ] **CLI**——查看、检索、导入导出和诊断数据库。
- [ ] **英文工具输出国际化**。

明确不做：云服务/远程数据库、多租户权限体系、依赖注入容器、事件总线和多层 Repository。

---

> 说明：本文档是方向性规划，不是承诺。功能真正实施时，会通过 OpenSpec change 和 GitHub Issue 细化跟踪。
