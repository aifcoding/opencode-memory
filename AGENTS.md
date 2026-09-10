# AGENTS.md

opencode-memory：给 opencode 用的本地持久记忆插件。三层记忆（长期知识 / 情景摘要 / 会话工作记忆），纯本地（SQLite + jieba-wasm）。

## 技术栈约束

- 运行时是 opencode 内嵌 Bun（非系统 Node）：只能用 `bun:sqlite` 与纯 JS/WASM 依赖
- 中文检索用 jieba-wasm + SQLite FTS5
- 数据默认存 `~/.local/share/opencode/memory/memory.db`（与 opencode 会话库同根）
- 配置读 `~/.config/opencode/opencode-memory.jsonc`（或 `.json`）

## 文档纪律（重要）

- 三层文档：`docs/ARCHITECTURE.md`（设计决策）、`openspec/specs/`（需求+场景）、`README.md` + `README.en.md`（使用说明，中英同步）
- **只写已实现的**：架构文档必须区分「已实现」和「规划中」；未实现的能力（向量检索、多源、信任分级、secret 检测等）不得写成现状
- **不过度承诺安全**：当前是单用户本地环境；召回/固定内容会进模型上下文（用远程 provider 会上传），如实说明
- **不写内部开发背景**：不出现评审记录、踩坑过程、评分、对比竞品等
- 改行为同时更新 spec 与 README，工具参数以 `plugin.ts` 的 zod 定义为准

## 代码纪律

- `bun test` 必须全绿；改代码补测试
- 错误要处理，不要空 catch 吞错（配置文件存在但解析失败必须显式报错）
- 元数据更新不清 embedding；内容更新走 CAS；主表 + FTS 同事务；写入走 busy 重试
- 数据库构造失败要关闭已打开的连接

## 提交纪律

- 提交身份 aifcoding，不暴露个人身份
- commit message 精简、通俗、用功能描述

## 协作纪律

- 修 bug 拿不准时，先问架构师或 fixer 子 agent，不要自行猜测，避免 review 返工
- 行为变更走 OpenSpec（propose → review → apply → archive）
