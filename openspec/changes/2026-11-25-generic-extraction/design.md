# 设计：通用 LLM 提取管线

## D0 适配层与 core 的分工（已确认）

- OpenCode 适配层：`capture.agent` 缺省时视为 **host-default**（新建临时子会话、直接生成、不切 agent）；配置后固定到该 agent。
- core 的 `capture.target` 校验仍要求 enabled 时目标可解析；**由适配层注入 host-default**，不要求用户手写 target。
- 安装时不自动写 agent 文件（避免安装副作用与升级/卸载归属问题）；显式 setup 生成 agent 留到下一版。

## D1 目标统一为 target 联合类型

```
{ kind: "model", provider, model }
{ kind: "agent", name }
{ kind: "host-default" }
```

互斥；`enabled=true` 无 target 或 target 无法解析 → 拒绝启动；运行期生成失败不换目标。
旧 `capture.agent` 映射为 agent target，与 `capture.target` 同时出现视为冲突。

## D2 端口最小化

- `ConversationSource.read({sessionId, checkpoint, maxBytes, signal})` → `{snapshotId, messages}`；
- `TextGenerator.generate({instructions, data, maxOutputTokens, maxOutputBytes, signal})` → `{text}`；
- 上下文注入由服务返回块、宿主决定如何附加；
- 事件接线、工具注册、子会话生命周期、scope 映射全部留在宿主。

## D3 固定安全顺序

来源筛选 → 本地凭据扫描 → 确定性预算裁剪 → 最终载荷扫描 → 持久幂等（beginCapture 租约）→ 生成 → JSON/schema 校验 → completeCapture(pending)。

- 默认不发送 system、工具输出、附件、宿主注入块；
- 规则采集路径：命中片段脱敏为 `[REDACTED]` 后继续；仅整条只含凭据时放弃（不落库）；
- LLM 提取路径：命中片段替换为 `[REDACTED]` 后继续提取，仅当全部材料都是敏感内容时取消本次提取；错误与日志只记录命中数量，不回显原文；
- 消息全部作为不可信数据处理，`assistant` 不代表已验证事实。

## D3.1 提取质量双层约束（已实现）

- 提示词：明确「无值得留存内容返回空数组」，列收录/禁止清单，要求 `evidenceQuote` 原样摘录；
- 本地后置校验 `validateCaptureCandidates`：正文 <20 字、纯问句、标题 <2 字、`evidenceQuote` 不在材料中、同批重复标题 → 丢弃，并记录过滤原因；
- 不信任模型输出：即使提示词写了，仍以本地校验为准。

## D4 `memory_extract(text)`（MCP 手动入口）

允许但低信任：`sourceKind='model-report'`，参数不接受 role/trust/scope/target；同样走凭据扫描与预算；只写 pending。
**已确认**：pending 永不参与召回；**批准后允许自动召回，但召回块标注来源 `model-report`**（与架构师「批准后也不召回」的建议不同，理由是审批应带来可用性）。

## D5 能力分级

能力由已装配端口派生，`full / hook-only / tools-only` 仅用于展示，不参与业务判断。
无子会话但能直接生成文本的宿主同样可以提取。

## D6 不做

- model→agent→host-default 自动兜底；
- 把规则采集当生成失败兜底；
- 统一事件总线 / 通用 agent 框架 / provider 路由器；
- core 读取任意文件或猜 session；
- 自动审批、自动覆盖正式记忆；
- 把 hook 时序、工具注册、model/agent 解析移进 core。
