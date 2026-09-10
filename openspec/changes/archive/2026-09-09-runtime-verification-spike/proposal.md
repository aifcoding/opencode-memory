## Why

opencode 插件运行在 opencode 自带的单文件二进制内（Homebrew 安装，138M，内嵌 Bun），而非系统 Node。我们为 opencode-memory 选定的存储方案（`node:sqlite`）与中文分词（jieba WASM）都依赖运行时的具体能力，但**尚未实测验证**。若地基假设错误（如内嵌 Bun 不支持 `node:sqlite`、WASM 加载受限），后续 S1-S5 全部返工。必须先做一次最小验证 spike，用事实钉死存储驱动与 hook 接入方式。

## What Changes

- 在 `~/Documents/opencode-memory` 创建一个最小 opencode 插件（spike 专用，非最终代码）
- 通过临时配置加载插件，实测并记录（详见 tasks.md，覆盖）：
  - 内嵌运行时版本（`process.versions`）与 opencode/plugin 版本
  - `node:sqlite` / `bun:sqlite` 的文件库/WAL/事务/FTS5/并发语义（非仅内存 CRUD）
  - Overlay hook 的 ephemeral 撤回语义与 session 隔离
  - Compaction 事件链路能否取得压缩产物
  - 真实 jieba 包加载与分词；自定义工具签名；身份键稳定性
- 结论写入本变更的 `design.md` 结论段与 `spike/result.json`（机器可读），作为 S1 存储层与 S3 注入/归档的硬性依据
- 本变更**不产生**任何 spec 行为变更（纯验证/调查），故 `skip_specs: true`

## Capabilities

### New Capabilities

（无 —— 纯运行时验证，无行为变更）

### Modified Capabilities

（无）

## Impact

- **代码**：仅 spike 目录内临时插件 + 临时测试配置，不触碰真实 `~/.config/opencode` 配置
- **依赖**：不新增运行时依赖；验证结果决定 S1 采用 `node:sqlite` 还是 `bun:sqlite`
- **决策影响**：直接产出 ARCHITECTURE.md「待验证项」及 D1/D5/D6/D15 的定案结论
- **风险**：若 `node:sqlite` 与 `bun:sqlite` 均不可用，需回退评估（纯 JS/WASM 存储或 JSON 文件方案），本变更的任务项将暴露此风险而非掩盖
