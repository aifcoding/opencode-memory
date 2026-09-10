## Context

参见 proposal.md 的 Why。关键约束（已探明的事实）：

- opencode 1.18.30 为 Homebrew 单文件二进制（138M Mach-O arm64），内含 Bun 运行时符号，插件 `.ts` 在该内嵌运行时内执行
- 系统 Node 为 v26.6.0，**与插件运行时无关**
- `~/.config/opencode/node_modules/` 存在（zod 等纯 JS 依赖），说明纯 JS 依赖可被加载
- 选定的存储候选为 `node:sqlite`（D1）；分词候选为 jieba WASM（D5）——两者都需实测
- 禁止破坏性触碰用户真实全局配置；验证必须可回退

## Goals / Non-Goals

**Goals:**
- 用最小代码证明或证伪关键地基假设：① SQLite 驱动（node:sqlite/bun:sqlite）具备文件库/WAL/事务/FTS5/并发语义 ② Overlay hook 真正 ephemeral 且 session 隔离 ③ compaction 事件链路可取得压缩产物 ④ 真实 jieba 包可加载 ⑤ 自定义工具与身份键可用
- 产出机器可读 `spike/result.json`，直接决定 S1 存储驱动与 S3 注入/归档方案
- 全程不改用户真实 `~/.config/opencode` 全局配置

**Non-Goals:**
- 不实现任何最终功能代码（无存储、无检索、无注入逻辑）
- 不做性能基准（量级未到）
- 不解决内嵌 Bun 版本升级问题（记录即可）

## Decisions

**D-S0.1 验证载体：spike 目录内独立插件 + `OPENCODE_CONFIG` 临时配置**
- 在 `~/Documents/opencode-memory/spike/` 建 `plugin.ts`，通过环境变量注入临时配置加载，**不写**用户全局 `opencode.jsonc`
- 备选：直接改全局配置 → 否决（污染真实环境、需重启用户会话）

**D-S0.2 插件职责单一：启动即自检并输出 JSON 报告**
- 插件加载时执行探针序列，把结果写入 `spike/result.json` 和 stderr 日志：
  1. `process.versions`（识别内嵌 Bun/Node 版本）+ opencode/plugin 版本
  2. 依次 `import('node:sqlite')`，不行则 `bun:sqlite`；对文件库执行 建表/写读/WAL/事务/并发/FTS5/BLOB 语义验证
  3. 挂实验性 transform hook 做 overlay 撤回/隔离实测，并捕获最终 provider payload
  4. 触发 compaction，验证 compacting/compacted 事件链路能否取得摘要
  5. 安装并加载真实 jieba 包执行分词；注册自定义工具验证签名；记录身份键（project.id/directory/worktree）
- 通过插件日志级别控制输出，避免污染会话

**D-S0.3 成功标准分级（驱动 S1 决策）**
| 结果 | S1 决策 |
|---|---|
| `node:sqlite` 可用 | 采用 `node:sqlite`，存储层按其 API 编写 |
| 仅 `bun:sqlite` 可用 | 采用 `bun:sqlite`，API 差异封在 `SqliteMemoryStore` 单文件适配层 |
| 两者都不可用 | 回退评估：纯 JS 文件存储 / WASM sqlite / JSON 方案，变更中记录并升级为阻塞项 |
| WASM 不可加载 | Tokenizer 回退 trigram（内建 FTS5），jieba 降级为后续可选项 |

**D-S0.4 与 hooks 签名核对以 schema + 本机类型定义为准**
- 实验性 hook 签名以 `https://opencode.ai/config.json` 及本机 opencode 安装内类型声明为准，不凭记忆写死
- spike 中对每个拟用 hook 打印实际入参结构样例，留档供 S3 使用

## Risks / Trade-offs

- [内嵌 Bun 版本过旧导致 `node:sqlite` 不可用] → 探针先打 `process.versions`；备选 `bun:sqlite` 已设计在内，适配层隔离差异
- [spike 加载影响用户当前 opencode 会话] → 仅通过 `OPENCODE_CONFIG` 指向 spike 配置启动**独立测试会话**，测试完毕即退出；不注册到全局
- [WASM 加载受限（Bun 安全策略/路径）] → 探针记录具体报错；分词走 trigram 兜底，不阻塞主链路
- [实验性 hook API 与文档不符] → 以本机类型定义为唯一事实源，结果写入 design 结论，S3 实现时以同一标准核对

## Migration Plan

- spike 产物留在 `spike/` 目录（含 `result.json`），作为 S1 的依据存档，不部署、不发布
- 验证完成即把结论回填本变更 `design.md` 末尾「S0 结论」，随后归档该 change

## Open Questions

- 无（本 spike 的目标就是消除这些未知；无法消除的将升级为阻塞项并在 tasks 中显式标注）

## S0 结论（实测，2026-09-09）

全量记录见 `spike/FINDINGS.md`，要点：

- **D1 驱动 = `bun:sqlite`**（`node:sqlite` 在内嵌 Bun 1.3.14 不可用；bun:sqlite 文件库/WAL/FTS5/bm25/事务全通）
- **SQLite 3.43.2，含 `OMIT_LOAD_EXTENSION`** → sqlite-vec 不可行，D3 定为 BLOB + 内联余弦
- **D5 分词 = jieba-wasm**（分词正确）；trigram 对 2 字中文词命中 0
- **D6 注入 = transform 层**，ephemeral 实测确认（marker 残留 0）；首选 `messages.transform`（仅主 agent 触发，带 agent/sessionID）
- **D12** = 显式 `busy_timeout` + 写重试（默认 0 并发写报 `database is locked`）
- **D15** = `realpath(directory)` / 安装 UUID（opencode `project.id` 非 git 目录恒 "global"）
- 剩余 3 项探针（compaction 事件 / 自定义工具 / A→B 多轮撤回）降级到 S1/S2/S3
