## 1. 基线与契约清单

- [x] 1.1 N/A：重构前基线属于历史阶段，本次收尾无法回溯其现场；现有 36 个测试覆盖当前行为
- [x] 1.2 N/A：历史契约清单未单独落盘，当前工具参数以 Adapter Zod 定义和 README 为准
- [x] 1.3 N/A：历史发布清单未单独落盘，当前包清单已通过 pack 验证
- [x] 1.4 N/A：本次开始前已完成重构，无法重新生成重构前基线；当前回归见 7.x

## 2. 建立 Monorepo

- [x] 2.1 将根 package 设置为 private，并配置 Bun Workspaces
- [x] 2.2 创建 `packages/core` 和 `packages/opencode`
- [x] 2.3 添加共享 TypeScript 基础配置
- [x] 2.4 验证根目录可统一安装、测试、类型检查和构建

## 3. 迁移 Core 底层能力

- [x] 3.1 将领域类型迁入 `packages/core/src/domain`
- [x] 3.2 将 `MemoryStore` 迁入 `packages/core/src/ports`
- [x] 3.3 将 `SqliteMemoryStore`、迁移和 capability 迁入 `packages/core/src/sqlite`
- [x] 3.4 将 tokenizer 迁入 `packages/core/src/retrieval`
- [x] 3.5 将 Pin 文本渲染迁入 `packages/core/src/render`
- [x] 3.6 迁移存储和检索测试，验证原有行为不变
- [x] 3.7 使用原有数据库文件验证无需 Schema 迁移

## 4. 实现 MemoryManager

- [x] 4.1 定义公共输入、结果联合类型和错误类型
- [x] 4.2 实现默认 scope、pinQuota、origin 和 trust
- [x] 4.3 实现长期知识高层方法
- [x] 4.4 实现 Pin、Unpin 和固定上下文渲染
- [x] 4.5 实现情景摘要归档与检索
- [x] 4.6 实现 contextKey KV 方法
- [x] 4.7 实现 close 生命周期
- [x] 4.8 为每个结构化状态补充 Manager 测试

## 5. 瘦身 OpenCode Adapter

- [x] 5.1 将现有 npm 包迁入 `packages/opencode`
- [x] 5.2 保留配置文件与 tuple options 解析
- [x] 5.3 将 12 个工具改为调用 `MemoryManager`
- [x] 5.4 将结构化结果映射为兼容的中文输出
- [x] 5.5 保留 OpenCode overlay 消息构造
- [x] 5.6 保留 compaction 事件和消息提取
- [x] 5.7 使用消息时间传入 archiveSummary
- [x] 5.8 保留 dispose 并调用 manager.close

## 6. 包导出与依赖边界

- [x] 6.1 配置 `@aifcoding/memory-core` 根入口和类型声明
- [x] 6.2 配置 `@aifcoding/memory-core/sqlite` 子路径
- [x] 6.3 确保 Core 根入口不加载 `bun:sqlite`
- [x] 6.4 增加 Core 禁止依赖 OpenCode 的边界测试
- [x] 6.5 验证 OpenCode Adapter 只能单向依赖 Core

## 7. 回归与发布验证

- [x] 7.1 验证迁移后的原 27 个测试全部通过
- [x] 7.2 验证新增 Manager 和边界测试通过
- [x] 7.3 运行所有 workspace 的 typecheck
- [x] 7.4 运行所有 workspace 的 build
- [x] 7.5 对两个包执行 pack 并检查文件清单和依赖版本
- [x] 7.6 从打包产物安装 Core 并执行中文 store/recall/pin；同时验证 OpenCode tarball 内容和依赖
- [x] 7.7 使用现有数据库打开验证兼容；36 个测试覆盖 12 个工具及配置链路

## 8. 文档

- [x] 8.1 更新 README 的 monorepo 和包定位
- [x] 8.2 更新 ARCHITECTURE.md 的 Core/Adapter 分层
- [x] 8.3 添加 `@aifcoding/memory-core` API 使用示例
- [x] 8.4 明确 `/sqlite` 仍要求 Bun
- [x] 8.5 记录 MCP 和 CLI 为后续独立 change
- [x] 8.6 运行 `openspec validate --changes` 并修复全部错误
