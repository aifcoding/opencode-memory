## 1. 基线与契约清单

- [ ] 1.1 记录现有 27 个测试名称、覆盖行为和归属模块
- [ ] 1.2 逐项记录 12 个工具的名称、参数、默认值和返回语义
- [ ] 1.3 记录现有配置优先级、默认数据库路径和 npm 打包内容
- [ ] 1.4 运行 `bun test`、typecheck、build，保存重构前基线

## 2. 建立 Monorepo

- [ ] 2.1 将根 package 设置为 private，并配置 Bun Workspaces
- [ ] 2.2 创建 `packages/core` 和 `packages/opencode`
- [ ] 2.3 添加共享 TypeScript 基础配置
- [ ] 2.4 验证根目录可统一安装、测试、类型检查和构建

## 3. 迁移 Core 底层能力

- [ ] 3.1 将领域类型迁入 `packages/core/src/domain`
- [ ] 3.2 将 `MemoryStore` 迁入 `packages/core/src/ports`
- [ ] 3.3 将 `SqliteMemoryStore`、迁移和 capability 迁入 `packages/core/src/sqlite`
- [ ] 3.4 将 tokenizer 迁入 `packages/core/src/retrieval`
- [ ] 3.5 将 Pin 文本渲染迁入 `packages/core/src/render`
- [ ] 3.6 迁移存储和检索测试，验证原有行为不变
- [ ] 3.7 使用原有数据库文件验证无需 Schema 迁移

## 4. 实现 MemoryManager

- [ ] 4.1 定义公共输入、结果联合类型和错误类型
- [ ] 4.2 实现默认 scope、pinQuota、origin 和 trust
- [ ] 4.3 实现长期知识高层方法
- [ ] 4.4 实现 Pin、Unpin 和固定上下文渲染
- [ ] 4.5 实现情景摘要归档与检索
- [ ] 4.6 实现 contextKey KV 方法
- [ ] 4.7 实现 close 生命周期
- [ ] 4.8 为每个结构化状态补充 Manager 测试

## 5. 瘦身 OpenCode Adapter

- [ ] 5.1 将现有 npm 包迁入 `packages/opencode`
- [ ] 5.2 保留配置文件与 tuple options 解析
- [ ] 5.3 将 12 个工具改为调用 `MemoryManager`
- [ ] 5.4 将结构化结果映射为兼容的中文输出
- [ ] 5.5 保留 OpenCode overlay 消息构造
- [ ] 5.6 保留 compaction 事件和消息提取
- [ ] 5.7 使用消息时间传入 archiveSummary
- [ ] 5.8 保留 dispose 并调用 manager.close

## 6. 包导出与依赖边界

- [ ] 6.1 配置 `@aifcoding/memory-core` 根入口和类型声明
- [ ] 6.2 配置 `@aifcoding/memory-core/sqlite` 子路径
- [ ] 6.3 确保 Core 根入口不加载 `bun:sqlite`
- [ ] 6.4 增加 Core 禁止依赖 OpenCode 的边界测试
- [ ] 6.5 验证 OpenCode Adapter 只能单向依赖 Core

## 7. 回归与发布验证

- [ ] 7.1 验证迁移后的原 27 个测试全部通过
- [ ] 7.2 验证新增 Manager 和边界测试通过
- [ ] 7.3 运行所有 workspace 的 typecheck
- [ ] 7.4 运行所有 workspace 的 build
- [ ] 7.5 对两个包执行 pack 并检查文件清单和依赖版本
- [ ] 7.6 从打包产物安装并验证 OpenCode 插件加载
- [ ] 7.7 验证现有数据库、配置和 12 个工具无回归

## 8. 文档

- [ ] 8.1 更新 README 的 monorepo 和包定位
- [ ] 8.2 更新 ARCHITECTURE.md 的 Core/Adapter 分层
- [ ] 8.3 添加 `@aifcoding/memory-core` API 使用示例
- [ ] 8.4 明确 `/sqlite` 仍要求 Bun
- [ ] 8.5 记录 MCP 和 CLI 为后续独立 change
- [ ] 8.6 运行 OpenSpec 校验并修复全部错误
