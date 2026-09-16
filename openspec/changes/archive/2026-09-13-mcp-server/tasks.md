## 0. 依赖与协议验证

- [x] 0.1 确认并锁定官方 `@modelcontextprotocol/server` v2 版本
- [x] 0.2 用最小 spike 验证 Bun 下 McpServer + StdioServerTransport
- [x] 0.3 验证目标 MCP Client 能完成 initialize、tools/list 和 tools/call（stdio 协议测试覆盖）
- [x] 0.4 验证 structuredContent 和文本 fallback 在目标客户端中的表现（stdio 协议测试覆盖）
- [ ] 0.5 验证 stdio 下 stderr 日志不会污染协议（Deferred to pre-release verification）
- [x] 0.6 确认 Candidate API 的 Core 最低版本和 merge 顺序

## 1. 包结构

- [x] 1.1 创建 `packages/mcp`
- [x] 1.2 配置 npm 包名 `@aifcoding/memory-mcp`
- [x] 1.3 配置 `memory-mcp` bin 入口
- [x] 1.4 增加 Core 和官方 MCP Server SDK 依赖
- [x] 1.5 将 MCP 包加入根 workspace 的 test/typecheck/build/format
- [ ] 1.6 增加依赖边界测试，验证 mcp→core 单向且 Core 不依赖 MCP（Deferred to pre-release verification）
- [x] 1.7 配置 `.d.ts`、exports、LICENSE、README 和 publishConfig

## 2. Server 与声明式注册

- [x] 2.1 实现 `MemoryMcpServerOptions`
- [x] 2.2 实现 `createMemoryMcpServer`
- [x] 2.3 定义六个 `MemoryMcpCapability`
- [x] 2.4 定义 `MemoryMcpToolDefinition`
- [x] 2.5 实现 Tool Registry
- [x] 2.6 实现 readonly/full Profile 到 capability 的映射
- [x] 2.7 未授权工具不得出现在 tools/list（registry 过滤 + stdio tools/list 覆盖）
- [x] 2.8 Candidate Review 增加显式 allowCandidateReview 门
- [ ] 2.9 为只读、破坏性和幂等工具设置 MCP annotations（当前仅有 readOnlyHint/destructiveHint，缺 idempotentHint/openWorldHint）

## 3. readonly 工具

- [x] 3.1 实现 `memory_search`
- [x] 3.2 实现 `memory_read`
- [x] 3.3 实现 `memory_list`
- [x] 3.4 所有 Manager 调用注入固定 Server Scope
- [x] 3.5 search 只返回正文预览，read 返回完整正文
- [x] 3.6 list 不返回完整正文（公开 DTO）
- [x] 3.7 实现 structuredContent 输出 Schema（统一 envelope union）
- [x] 3.8 实现带引用围栏的文本 fallback
- [x] 3.9 验证正文无法伪造围栏关闭标记或属性（server 测试覆盖转义）

## 4. full 工具

- [x] 4.1 实现 `memory_store`
- [x] 4.2 MCP 输入禁止传 scope/origin/trust
- [x] 4.3 写入固定为 Server Scope、origin=agent
- [x] 4.4 writeTrust 默认 low
- [x] 4.5 实现 `memory_forget`
- [x] 4.6 实现 `memory_pin`
- [x] 4.7 实现 `memory_unpin`
- [x] 4.8 实现 `memory_pins`
- [ ] 4.9 验证 low-trust 写入不能 Pin（Deferred to pre-release verification）
- [x] 4.10 验证删除与 Pin 均不能跨 Server Scope（server 测试覆盖）

## 5. Candidate 工具

- [x] 5.1 Candidate API 合入后实现 `memory_candidate_list`
- [x] 5.2 实现 `memory_candidate_read`
- [x] 5.3 实现 `memory_candidate_review`
- [x] 5.4 Candidate list/read 要求 `candidate:read`
- [x] 5.5 Candidate review 要求 `candidate:review`
- [x] 5.6 `allowCandidateReview=false` 时不注册审批工具
- [x] 5.7 Candidate 内容使用低信任引用围栏
- [x] 5.8 批准候选后不自动 Pin

## 6. 配置与 CLI

- [x] 6.1 定义严格 `MemoryMcpConfig` Schema
- [x] 6.2 实现默认 JSONC 配置路径
- [x] 6.3 实现 `--config` 参数
- [x] 6.4 配置文件不存在或解析失败时 stderr 报错
- [x] 6.5 dbPath 必须是绝对路径
- [x] 6.6 project scope 和 scopeKey 必须显式提供
- [x] 6.7 profile 默认 readonly
- [x] 6.8 transport 默认 stdio
- [x] 6.9 限制 defaultLimit、maxLimit 和 previewLength
- [x] 6.10 配置和错误日志不得输出数据库内容或完整配置

## 7. stdio 传输

- [x] 7.1 实现 StdioServerTransport 启动
- [x] 7.2 stdout 只写 MCP 协议
- [x] 7.3 日志统一写 stderr
- [x] 7.4 SIGINT/SIGTERM 时关闭 Server 与 MemoryManager
- [x] 7.5 多次关闭保持安全
- [x] 7.6 stdio 启动失败返回非零退出码

## 8. 测试

- [x] 8.1 readonly tools/list 只包含 search/read/list（stdio 协议 + registry 覆盖）
- [ ] 8.2 full tools/list 包含配置允许的写工具（目前仅 registry 级验证，未走真实 tools/list —— Deferred to pre-release verification）
- [x] 8.3 客户端输入不能覆盖 Scope（server strict schema 测试）
- [x] 8.4 不同 project scope 不能互相读取（server 测试）
- [ ] 8.5 readonly 工具没有数据库写副作用（未做显式前后对比 —— Deferred to pre-release verification）
- [x] 8.6 full 写入使用 origin=agent 和固定 writeTrust（server 测试）
- [x] 8.7 错误输出不包含 SQL、Stack 或完整 dbPath（error envelope 测试）
- [x] 8.8 搜索结果包含 score、origin、trust、scope 和 updatedAt（search DTO 测试）
- [x] 8.9 工具输入拒绝未知字段（server strict 测试）
- [ ] 8.10 stdout 污染测试（Deferred to pre-release verification）
- [ ] 8.11 使用官方 MCP Client 执行进程级 stdio 端到端测试（当前用手写 JSON-RPC client 覆盖协议层；官方 client 端到端 Deferred）
- [ ] 8.12 OpenCode Adapter 与 MCP Adapter 共享数据库兼容测试（Deferred to pre-release verification）
- [x] 8.13 运行 workspace test/typecheck/format/build
- [ ] 8.14 从 tarball 通过 bunx 启动并调用三个只读工具（Deferred to pre-release verification）

## 9. 文档与发布

- [x] 9.1 编写 `packages/mcp/README.md`
- [x] 9.2 提供 readonly stdio 配置示例
- [ ] 9.3 提供通用 MCP Host 配置示例（Deferred to pre-release verification）
- [x] 9.4 说明 Scope 固定和 global/default 风险
- [x] 9.5 说明 full Profile、writeTrust 和 Candidate Review 风险
- [x] 9.6 说明 stdout 日志限制
- [x] 9.7 说明首版不支持 HTTP/SSE
- [x] 9.8 更新根 README、ARCHITECTURE 和 ROADMAP
- [ ] 9.9 维护 Core/OpenCode/MCP 数据库兼容矩阵（Deferred to pre-release verification）
- [x] 9.10 验证 OpenSpec change
- [ ] 9.11 发布前检查 npm pack 内容、依赖和 bin 权限（Deferred to pre-release verification）

---

> 标注 `Deferred to pre-release verification` 的项不阻塞 apply，但阻塞 npm 发布，须在 release checklist 中完成。
