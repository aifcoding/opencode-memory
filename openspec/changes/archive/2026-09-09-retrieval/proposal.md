## Why

S1 已落地存储层（memories + session_kv + 事务 FTS + 软删去重 + 乐观锁），但还没有检索能力——记忆存进去召不回。S0 已实测定案：中文检索用 jieba-wasm 预分词写 FTS body（trigram 对 2 字中文词命中 0，不能用）；嵌入默认关闭，故 S2 仅做 FTS5 + BM25 文本检索，向量/RRF 留待 S5。

## What Changes

- 接入 **jieba-wasm**（替换 `tokenizer.ts` 的分词桩），英文/标识符兜底切分
- 实现 **`search`** 方法：jieba 分词查询 → FTS5 OR MATCH + BM25 排序 → 返回 `{id, score}`
- **recall 语义**：有 query 无匹配返回空（绝不回退最新）；结果带 id + score（高=更相关）；按 scope/scopeKey 过滤
- 中文召回基线测试（`bun test`）

## Capabilities

### New Capabilities
- `retrieval`: 记忆检索——jieba 中文分词、FTS5 BM25 排序、recall 语义（id+score、无匹配返空）、scope 过滤

### Modified Capabilities
（无）

## Impact

- **依赖**：新增 `jieba-wasm`（纯 WASM，无原生，S0 已验证 Bun 可加载）
- **代码**：`src/storage/tokenizer.ts` 替换实现；`src/storage/SqliteMemoryStore.ts` 增 `search` 方法 + 接口；新增 `tests/retrieval.test.ts`
- **不涉及**：插件 tool 注册（S3/S4）、向量通道/RRF（S5）、overlay 注入（S3）
