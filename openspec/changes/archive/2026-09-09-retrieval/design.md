## Context

S0 实测：jieba-wasm 在 Bun 1.3.14 加载分词正确；trigram 对 2 字中文词命中 0；FTS5/bm25 可用。S1 已实现存储层，`tokenizer.ts` 目前是桩（按空白/标点切分，不能分中文词）。本变更接入真实分词并实现文本检索。

## Goals / Non-Goals

**Goals:**
- jieba 预分词替换桩，索引/查询走同一分词管线
- FTS5 + BM25 文本检索，返回 id + score，scope 过滤，无匹配返空

**Non-Goals:**
- 不做向量检索 / RRF 多通道合并（S5，嵌入默认关）
- 不做 recall 工具注册到 opencode（S3/S4）
- 不做 rerank / MMR / 相关性评测体系（仅基线测试）

## Decisions

**D-S2.1 tokenizer = jieba-wasm**
- `import { cut } from "jieba-wasm"`，同步调用；对含 ascii 的词元再按非 `[a-zA-Z0-9_]` 细分，保留标识符；jieba 异常时回退简单切分

**D-S2.2 检索 = FTS5 OR MATCH + bm25 排序**
- 查询侧 jieba 分词 → 词元 `OR` MATCH → `ORDER BY bm25`；score = `-bm25`（高=更相关）
- 索引 body = `tokenize(title + summary + content)`（S1 已建 `memories_fts`）

**D-S2.3 recall 语义**
- 无 query 或无匹配 → 返回空（绝不回退最新）
- 结果带 `{id, score}`；join `memories` 过滤 `deleted_at IS NULL` + scope

**D-S2.4 scope 过滤在 SQL 内完成**（join memories 表），不事后过滤

**D-S2.5 测试**：中文 2 字词召回、英文标识符保留、无匹配返空、scope 过滤、软删排除、排序

## Risks / Trade-offs

- [jieba-wasm 冷启动/内存] → 已在 S0 验证可用；量级小，无性能顾虑
- [jieba 对代码/标识符切分可能不理想] → D-S2.1 的 ascii 细分兜底
- [bm25 对短查询 vs 长文档] → 单通道 FTS，S5 引入向量后再做混合，当前够用

## Migration Plan

- 无表结构变更（复用 S1 的 `memories_fts`），仅改 tokenizer 与新增 search 方法
- 已有数据需重建 FTS body（S1 用桩分词的旧 body 与 jieba 不一致）；本变更提供一次性重建说明（迁移或工具），个人数据量小可删库重建

## Open Questions

- 无（向量/RRF 明确留 S5）
