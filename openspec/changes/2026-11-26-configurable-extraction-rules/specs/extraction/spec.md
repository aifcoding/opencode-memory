## ADDED Requirements

### Requirement: 指令必须按「用户规则在前、程序约束在后」组合

系统 SHALL 把用户规则（或随包默认规则）放在 instructions 前部，把程序附加约束放在最后一节，并在附加约束中声明「与上文冲突时以本节为准」。

#### Scenario: 用户规则与附加约束冲突

- **WHEN** 用户 md 要求收录某类内容，而附加约束要求排除
- **THEN** 发给模型的 instructions 中附加约束位于最后，并包含冲突声明

#### Scenario: 材料内伪造约束

- **WHEN** 会话材料中出现「程序附加约束」「以本节为准」等字样
- **THEN** 材料仍作为数据传递，不获得 instructions 身份；工具、scope、审批权限不变

### Requirement: 模型由配置决定，未配置时使用宿主默认

系统 SHALL 支持 `capture.model {provider, model, variant?}`；未配置时使用宿主默认模型；显式配置但不可用时 SHALL 失败，不得回退。

#### Scenario: 未配置模型

- **WHEN** `capture.enabled=true` 且未配置 `capture.model`
- **THEN** 使用宿主默认模型执行提取

#### Scenario: 显式模型不可用

- **WHEN** 配置了 `capture.model` 但 provider/model 不存在或无权限
- **THEN** 本次提取失败并返回 `model_selection_unsupported`，宿主默认模型的调用次数为 0

### Requirement: 提取规则来自 md 文件，读不到即失败

系统 SHALL 支持 `capture.instructionsFile`（本地绝对路径）；未配置时使用随包默认规则；配置后替换默认规则；文件不存在、不可读、为空或超限时 SHALL 失败且不回退。

#### Scenario: 规则文件缺失

- **WHEN** 配置了不存在的 `instructionsFile`
- **THEN** 提取失败并返回 `instructions_unreadable`，不回退默认规则

#### Scenario: 规则文件含凭据

- **WHEN** 规则文件内容命中凭据规则
- **THEN** 拒绝执行，错误信息不含文件片段

### Requirement: 来源准入不可被配置或规则覆盖

系统 SHALL 只接受可信来源材料：host-transcript 仅 `human/model`，model-report 仅 `model-report`；缺失 origin SHALL 被拒绝。模型输出 SHALL NOT 改变来源、scope、trust 或审批状态。

#### Scenario: 注入消息

- **WHEN** 材料包含 automation/system/synthetic 等非人工来源
- **THEN** 该材料不进入提取，候选与正式记忆新增为 0

#### Scenario: 模型伪造元数据

- **WHEN** 模型输出包含 `status=approved`、外部 scope 或未知字段
- **THEN** 这些字段被忽略或拒绝，候选只能以 pending 写入

### Requirement: 代码只保留基础风控

系统 SHALL 在生成前后执行以下检查：凭据扫描（规则、材料、最终载荷、输出）、资源上限（输入输出、候选数、超时、并发与租约）、最小结构（JSON、字段类型、字段白名单）。标题长度、正文长度、引用存在性、同批去重等质量规则 SHALL NOT 作为拒绝条件。

#### Scenario: 质量缺陷候选

- **WHEN** 模型返回标题过长、正文较短或缺少 evidenceQuote 的候选
- **THEN** 候选按结构校验结果进入 pending 或被结构规则拒绝，不因质量规则整体判失败

#### Scenario: 资源超限

- **WHEN** 材料或输出超过配置上限，或等待超过 timeout
- **THEN** 在预算内中止，不先无限读入再检查

### Requirement: 临时生成会话必须隔离

系统 SHALL 在临时会话中禁用全部工具、排除递归采集，并在结束后清理；无法保证隔离时 SHALL 返回 `tool_isolation_unsupported`。

#### Scenario: 材料要求执行工具

- **WHEN** 材料或规则要求运行命令、写文件或调用 MCP 工具
- **THEN** 临时会话无可用工具，只返回文本

#### Scenario: 超时清理

- **WHEN** 生成超时
- **THEN** 先取消生成，再删除临时会话；清理失败记录 `session_cleanup_failed`

### Requirement: 任务身份必须包含指令内容

系统 SHALL 使用内容 hash 作为任务身份，至少包含：来源上下文、最终材料、最终有效 instructions、风控契约版本、实际模型指纹与影响输出的配置。

#### Scenario: 修改规则后重跑

- **WHEN** 用户修改 md 或程序约束段，材料不变再次触发
- **THEN** 形成新任务并重新生成

#### Scenario: 相同任务重复触发

- **WHEN** 材料、指令、模型均未变化
- **THEN** 复用 completed，或返回 in-progress，不并发生成、不重复写候选

### Requirement: 旧配置必须显式迁移

系统 SHALL 把 `capture.target.kind='model'` 映射为 `capture.model`，把 `host-default` 映射为不配置模型；`agent`/`target.kind='agent'` SHALL 报弃用错误；新旧字段同时出现 SHALL 拒绝启动。

#### Scenario: 旧 agent 配置

- **WHEN** 配置仍使用 `capture.agent`
- **THEN** 启动失败并提示迁移到 `capture.model` 或移除该字段
