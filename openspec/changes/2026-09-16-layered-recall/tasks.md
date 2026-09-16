## 0. 基线

- [x] 0.1 记录当前 Recall 调用点和返回字段
- [x] 0.2 确认 MCP Server change 已归档
- [x] 0.3 确认本变更零数据库迁移
- [x] 0.4 确认三个包的目标版本和发布顺序

## 1. Core Projection 类型

- [x] 1.1 定义并导出 `MemoryProjection`
- [x] 1.2 定义并导出 `SummarySource`
- [x] 1.3 定义并导出 `RecallMemoryBase`
- [x] 1.4 定义 title/summary/full 投影类型
- [x] 1.5 定义并导出 `ProjectedMemory`
- [x] 1.6 定义 `ProjectedMemoryRecallItem`
- [x] 1.7 定义 `RecallOverflowItem`，包含 id/ref/title/trust/score
- [x] 1.8 投影 DTO 排除内部存储字段
- [x] 1.9 实现 Summary 空值 200 字符预览
- [x] 1.10 验证投影不修改数据库

## 2. Recall API

- [x] 2.1 删除旧 Recall 结果类型和分支
- [x] 2.2 定义统一 `RecallMemoriesInput`
- [x] 2.3 定义统一 `RecallMemoriesResult`
- [x] 2.4 默认 projection=summary
- [x] 2.5 只有 projection=full 返回 content
- [x] 2.6 导出 DEFAULT_SUMMARY_FALLBACK_CHARACTERS
- [x] 2.7 更新所有 Core/OpenCode/MCP 调用方
- [x] 2.8 更新 `.d.ts` 并验证无残留旧类型

## 3. Recall Budget

- [x] 3.1 定义 `RecallBudget`
- [x] 3.2 定义 `RecallBudgetInput`
- [x] 3.3 导出 `DEFAULT_RECALL_BUDGET`
- [x] 3.4 校验 maxCharacters 1..20000
- [x] 3.5 校验 preferSummary
- [x] 3.6 校验 maxOverflowItems 0..20
- [x] 3.7 校验 maxOverflowCharacters 0..10000
- [x] 3.8 实现 Detail canonical text
- [x] 3.9 多条 Detail 计入 `\n\n`
- [x] 3.10 按 score 降序生成连续 Detail 前缀
- [x] 3.11 实现等于预算允许加入
- [x] 3.12 实现大于预算停止
- [x] 3.13 实现 full→summary 降级
- [x] 3.14 preferSummary=false 时不降级
- [x] 3.15 summary/title 不继续降级
- [x] 3.16 计算 usedCharacters/degradedCount/truncated

## 4. Overflow

- [x] 4.1 实现 Overflow canonical text，包含 score
- [x] 4.2 多条 Overflow 计入 `\n`
- [x] 4.3 首条 Detail 放不下时进入 Overflow
- [x] 4.4 Overflow 保持 score 连续前缀
- [x] 4.5 Overflow 不跳过放不下的高分项
- [x] 4.6 实现 maxOverflowItems
- [x] 4.7 实现 maxOverflowCharacters
- [x] 4.8 任一 Overflow 预算为 0 时关闭
- [x] 4.9 计算 overflowUsedCharacters
- [x] 4.10 计算 consideredCount/omittedCount
- [x] 4.11 验证结果计数恒等关系
- [x] 4.12 Overflow 不返回正文、摘要或内部字段

## 5. Memory Ref

- [x] 5.1 定义 MemoryRef/MemoryReference/MemoryReferenceKind
- [x] 5.2 实现 memoryRef
- [x] 5.3 实现 summaryRef 和 percent encoding
- [x] 5.4 实现 candidateRef
- [x] 5.5 实现 parseMemoryReference
- [x] 5.6 实现 InvalidMemoryReferenceError
- [x] 5.7 拒绝非法 scheme/host/port/query/fragment
- [x] 5.8 拒绝非法路径和数字 ID
- [x] 5.9 拒绝非法 percent encoding
- [x] 5.10 错误不回显完整 Ref
- [x] 5.11 ProjectedMemory 包含 Ref

## 6. readReference 与 Storage

- [x] 6.1 MemoryStore 增加可选 getSummary
- [x] 6.2 SQLite 按主键实现 getSummary
- [x] 6.3 定义 ReadReferenceInput
- [x] 6.4 定义 ReferenceValue/ReadReferenceResult
- [x] 6.5 实现 Memory Ref 读取和 Scope 校验
- [x] 6.6 实现 Candidate Ref 读取和 Scope 校验
- [x] 6.7 实现 Summary Ref 读取
- [x] 6.8 Store 不支持对应能力时返回 unsupported
- [x] 6.9 软删除 Memory 返回 deleted
- [x] 6.10 验证零数据库迁移

## 7. OpenCode 配置与 Adapter

- [x] 7.1 配置 Schema 增加 recall 节
- [x] 7.2 文件配置和 Tuple Options 支持 recall
- [x] 7.3 memory_recall 增加 maxCharacters
- [x] 7.4 Adapter 固定 projection=summary
- [x] 7.5 Adapter 应用 Detail 和 Overflow 配置
- [x] 7.6 输出 Detail Ref、标题和 Summary/Preview
- [x] 7.7 输出 Overflow id/ref/title/trust/score
- [x] 7.8 工具描述说明 score 仅能在当前查询比较
- [x] 7.9 truncated 时输出详细预算提示
- [x] 7.10 omittedCount>0 时输出完全省略数量
- [x] 7.11 memory_read 参数和全文行为不变
- [x] 7.12 围栏与转义不回归

## 8. MCP 配置与 Adapter

- [x] 8.1 MCP 配置 Schema 增加 recall 节
- [x] 8.2 memory_search 增加 maxCharacters
- [x] 8.3 MCP 固定 projection=summary
- [x] 8.4 保留 preview 字段
- [x] 8.5 增加 ref
- [x] 8.6 增加 previewSource
- [x] 8.7 envelope 增加可选 meta
- [x] 8.8 meta 包含预算统计和 Overflow
- [x] 8.9 更新 MCP output Schema
- [x] 8.10 memory_read 保持全文
- [x] 8.11 tools/list 不出现 readReference
- [x] 8.12 fixed project Scope 不变
- [x] 8.13 文本 fallback 包含 Detail/Overflow 并安全转义

## 9. Core 测试

- [x] 9.1 默认 projection=summary
- [x] 9.2 title 不包含 summary/content
- [x] 9.3 summary 使用已存摘要
- [x] 9.4 空 summary 回退 200 字符
- [x] 9.5 full 返回完整正文
- [x] 9.6 回退不修改数据库
- [x] 9.7 Detail DTO 无内部字段
- [x] 9.8 Detail 精确预算边界
- [x] 9.9 首条放不下进入 Overflow
- [x] 9.10 多条 Detail 分隔符计数
- [x] 9.11 full→summary 降级
- [x] 9.12 preferSummary=false
- [x] 9.13 limit 不触发 truncated
- [x] 9.14 空结果元数据
- [x] 9.15 Overflow 条数边界
- [x] 9.16 Overflow 字符边界
- [x] 9.17 Overflow 关闭
- [x] 9.18 Overflow Score 顺序与说明
- [x] 9.19 omittedCount 与计数恒等关系
- [x] 9.20 非法预算拒绝
- [x] 9.21 三种 Ref round-trip
- [x] 9.22 Summary percent encoding
- [x] 9.23 非法 Ref 参数化测试
- [x] 9.24 Ref Scope 隔离
- [x] 9.25 deleted/unsupported Ref
- [x] 9.26 数据库重开后 Ref 稳定

## 10. Adapter 与真实链路测试

- [x] 10.1 OpenCode Recall 默认输出 Summary
- [x] 10.2 OpenCode Preview 回退
- [x] 10.3 OpenCode Overflow 输出
- [x] 10.4 OpenCode Score 说明
- [x] 10.5 OpenCode 截断/省略提示
- [x] 10.6 OpenCode read 保持全文
- [ ] 10.7 OpenCode legacy loader 真实加载（真实宿主，发布前验证）
- [x] 10.8 MCP preview/ref/previewSource
- [x] 10.9 MCP budget meta 通过 outputSchema
- [x] 10.10 MCP Overflow meta
- [x] 10.11 MCP read 保持全文
- [x] 10.12 MCP 不暴露 readReference
- [x] 10.13 真实 stdio tools/list/tools/call
- [x] 10.14 tarball 安装验证三个包

## 11. 文档与发布

- [x] 11.1 新增 docs/CONFIGURATION.md
- [x] 11.2 更新根 README 中英文
- [x] 11.3 更新 Core README
- [x] 11.4 更新 OpenCode README
- [x] 11.5 更新 MCP README
- [x] 11.6 更新 ARCHITECTURE
- [x] 11.7 更新 ROADMAP
- [x] 11.8 说明 UTF-16 字符预算不等于 Token
- [x] 11.9 说明 Score 不可跨查询比较
- [x] 11.10 说明 Ref 只在同库稳定
- [x] 11.11 说明 Summary Ref 无 Scope
- [x] 11.12 OpenSpec validate 通过
- [x] 11.13 format/typecheck/test/build 全绿
- [ ] 11.14 按 Release Checklist 完成真实宿主和 tarball 验证（发布前验证）
- [ ] 11.15 按 Core→OpenCode→MCP 发布（发布时执行）
