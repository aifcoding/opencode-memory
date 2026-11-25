# 通用 LLM 提取管线（宿主无关）

## 问题

当前 LLM 提取逻辑（`captureSession`）绑定在 OpenCode 适配层，内部同时承担历史读取、子会话创建、agent 调用、输出解析与候选入库，其他宿主（Claude Code、Codex、MCP-only 客户端）无法复用。且生成前的过滤没有凭据扫描与输入预算，存在敏感内容外发风险。

## 方案

把「提取编排 + 安全管线」下沉到 core，宿主只实现端口：

- `ConversationSource`：按稳定快照读有界历史；
- `TextGenerator`：一次纯文本生成（不依赖宿主 SDK）；
- `TargetResolver`：启动时把 `capture.target` 解析成已绑定的 generator，运行期不换目标；
- `ExtractionService`：固定顺序（来源筛选 → 凭据扫描 → 预算裁剪 → 最终扫描 → 生成 → 输出校验）后写 pending 候选。

配置统一为 `capture.target` 三选一（model / agent / host-default），`enabled=true` 且无 target 时拒绝启动。

## 影响

- core 新增 `domain/extraction.ts`、`ports/{TextGenerator,ConversationSource}.ts`、`application/ExtractionService.ts`；
- 新增公共 model generator（先只支持一种协议）与 MCP `memory_extract(text)` 手动入口；
- OpenCode / Claude Code / Codex 各自只写 adapter 与配置映射；
- 不改变现有规则采集（`AutoCaptureService`）与召回路径。
