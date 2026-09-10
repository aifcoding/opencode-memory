## 1. Spike 脚手架

- [x] 1.1 在 `spike/` 创建 `plugin.ts`，插件加载即输出运行环境 JSON
- [x] 1.2 编写 `spike/spike.config.jsonc`，用 `OPENCODE_CONFIG` 启动独立会话验证插件可加载、不触碰全局配置

## 2. Overlay Hook 探针（D6）

- [x] 2.1 验证 `messages.transform` 与 `system.transform` 签名（input/output keys、sessionID）
- [x] 2.2 记录各 hook 触发时机（messages 仅主 agent、system 对 title+主都触发）
- [x] 2.6 结论写入 `spike/result.json` / `hooks-probe.json`（selectedHook/hasSessionId/ephemeral）
- [x] 2.7 注入 marker 后查 `opencode.db` 确认不残留消息历史（ephemeral 实锤）
- [ ] 2.3 A→B 多轮撤回完整实测 —— **降级 S3**（需交互式多轮会话）
- [ ] 2.4 并发 session 隔离实测 —— **降级 S3**
- [ ] 2.5 多插件顺序/重复注入 —— **降级 S3**

## 3. Compaction 链路探针

- [ ] 3.1-3.6 compaction 事件链路 —— **降级 S3**（需长会话触发真实压缩）

## 4. SQLite 语义探针（D1/D12，插件实际驱动）

- [x] 4.1 尝试 node:sqlite（不可用）→ bun:sqlite；记录 driver、SQLite 版本、`PRAGMA compile_options`
- [x] 4.2 文件库创建→关闭→重开持久化
- [x] 4.3 WAL、事务 rollback
- [x] 4.4 FTS5 + bm25 + trigram（中文 2 字命中 0）+ BLOB
- [x] 4.5 双连接并发写（默认 busy_timeout=0 → database is locked）
- [x] 4.6 D-S0.3 分级 → bun:sqlite 定案

## 5. WASM 与分词探针（D5）

- [x] 5.1 安装真实 jieba-wasm 包，记录 wasm/data 文件
- [x] 5.2 执行真实分词（中文 + 中英混合），输出正确
- [x] 5.4 trigram 兜底验证
- [ ] 5.3 许可证再分发条件 —— **降级 S4**（开源打包时核对）

## 6. 插件分发与配置探针

- [x] 6.5 身份键：记录 project.id（非 git 目录恒 "global"）、directory
- [ ] 6.1-6.4 自定义工具签名/ToolContext、tuple options、重复加载、dispose —— **降级 S1/S2**

## 7. 结论回填与归档

- [x] 7.1 结论回填 `spike/FINDINGS.md` + `design.md`「S0 结论」段
- [x] 7.2 更新 `docs/ARCHITECTURE.md`（D1/D3/D5/D6/D12/D15 定案）
- [x] 7.3 `openspec validate --changes` 通过
