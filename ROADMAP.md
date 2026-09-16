# Roadmap

本文档记录 opencode-memory 的发布状态与未来规划方向。

- 具体功能通过 OpenSpec change 提案（`openspec/changes/`）推进。
- 设计取舍见 `docs/ARCHITECTURE.md` 的 D 系列决策记录。

## 已发布

- **v0.1.x**：三层记忆（长期知识 / 情景摘要 / 会话 KV）、中文检索（jieba-wasm + FTS5 + BM25）、显式 Pin 注入、压缩自动归档、软删除和事务一致性。

## 已实现待发布

- **Headless Core**：`@aifcoding/memory-core` 与 `@aifcoding/opencode-memory` monorepo、MemoryManager 和 SQLite 子路径。
- **可插件化分词器**：单方法 `Tokenizer` 接口、默认 jieba-wasm 和 SQLite 注入选项。
- **安全辅助记忆提取**：候选隔离、确定性安全扫描和人工审批流程。
- **MCP Server**：`@aifcoding/memory-mcp`——官方 MCP SDK v2、stdio transport、固定 project Scope、readonly/full Profile、声明式 Tool Registry 和六个 capability、structuredContent 与文本参考围栏、Candidate list/read/review。
- **插件自更新**：检查 npm 新版本 + 刷新自身缓存 + 提示重启。
- **v2.1.0 记忆读路径升级**：L0/L1/L2 分层 Recall、默认 Summary Projection、Detail 字符预算、Overflow 条数/字符双预算（ID/Ref/Title/Trust/Score）、同库稳定 Memory Ref、Core `readReference`、OpenCode/MCP 分层读路径、零数据库迁移。

## 近期规划

- [ ] **跨数据库稳定 Ref**——仅在导入导出出现真实需求后，增加数据库身份和实体 UUID。
- [ ] **Summary Scope**——为情景摘要增加明确 Scope 后，再评估是否向 MCP 暴露通用 Ref Resolver。
- [ ] **召回评测基准**（Recall@K / MRR）——建立可复现数据集，量化现有 FTS 检索效果。
- [ ] **真实提取 Agent 评测基线**——在人工金标集上运行真实模型，记录 Precision/Recall。
- [ ] **MCP Streamable HTTP**——在有真实远程使用需求后增加认证、Host/Origin 校验、请求限制和 HTTPS 部署说明；Legacy SSE 仅在兼容性需求明确时考虑。
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
