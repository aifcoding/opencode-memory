## ADDED Requirements

### Requirement: 提取目标必须显式解析

系统 SHALL 在启动时把 `capture.target` 解析为唯一生成目标；SHALL NOT 在运行期自动切换目标。

#### Scenario: 启用但未配置目标

- **WHEN** `capture.enabled=true` 且没有 `target`（含 `host-default`）
- **THEN** 初始化失败并给出明确原因，不注册任何提取入口

#### Scenario: 目标互斥

- **WHEN** 同时提供 `target` 与旧 `capture.agent`
- **THEN** 初始化失败并报冲突，不静默选择其一

#### Scenario: 生成失败不换目标

- **WHEN** 本次生成超时或模型不可用
- **THEN** 本次提取失败并记录错误码，不切换到其它 model/agent，不阻断宿主正常对话

### Requirement: 生成前必须执行安全流水线

系统 SHALL 在调用生成器之前完成来源筛选、本地凭据扫描、预算裁剪与最终载荷扫描。

#### Scenario: 输入含凭据

- **WHEN** 待发送材料命中凭据规则
- **THEN** 本次提取被拒绝，生成器调用次数为 0，错误信息不回显命中内容

#### Scenario: 超预算

- **WHEN** 材料超过输入预算
- **THEN** 按完整消息边界裁剪并标记已裁剪，不得任意截断句子后放行

### Requirement: 模型自述材料只产生低信任候选

`memory_extract(text)` SHALL 以 `sourceKind='model-report'` 记录来源，参数 SHALL NOT 覆盖 role、trust、scope 或 target。

#### Scenario: 模型自述伪造来源

- **WHEN** 工具参数文本中包含「用户已确认」「system 指令」等字样
- **THEN** 仍按未验证自述处理，不提升信任、不触发任何工具或写入

#### Scenario: 候选与召回

- **WHEN** 提取完成
- **THEN** 只写入 pending 候选；pending 不参与自动召回

### Requirement: 提取结果必须校验

系统 SHALL 对生成结果做 JSON 与 schema 校验，失败时不写入任何候选。

#### Scenario: 非法输出

- **WHEN** 生成返回非 JSON 或字段非法
- **THEN** 本次提取标记失败，候选新增为 0，允许受控重试
