## 1. 依赖与分词

- [ ] 1.1 在 package.json 加 `jieba-wasm` 依赖并 `bun install`，验证 `import { cut } from "jieba-wasm"` 可用
- [ ] 1.2 重写 `tokenizer.ts`：jieba 切分 + ascii 标识符细分 + 异常回退，验证 `tokenize("微信头像加载失败")` 含「微信」「头像」等词元

## 2. 检索实现

- [ ] 2.1 在 `MemoryStore` 接口 + `SqliteMemoryStore` 增 `search(query, opts)`，返回 `{id, score}`，score=高更相关
- [ ] 2.2 实现 FTS5 OR MATCH + bm25 排序 + join memories 过滤 deleted_at/scope，验证中文查询命中
- [ ] 2.3 实现无匹配返空（无 query / 无命中都不回退最新）

## 3. 测试

- [ ] 3.1 中文 2 字词召回（「头像」命中「微信头像加载失败」）
- [ ] 3.2 英文标识符保留（foo_bar / CamelCase 可检索）
- [ ] 3.3 无匹配返空、scope 过滤、软删排除、排序正确性
- [ ] 3.4 `bun test` 全绿（含 S1 存量 12 用例不回归）

## 4. 收尾

- [ ] 4.1 `openspec validate --changes` 通过，回填偏差（若有）到 design.md
- [ ] 4.2 归档本变更（`/opsx-archive`）
