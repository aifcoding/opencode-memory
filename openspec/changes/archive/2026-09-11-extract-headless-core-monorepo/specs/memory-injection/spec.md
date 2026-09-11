## MODIFIED Requirements

### Requirement: 固定记忆每轮注入

Core SHALL 负责固定记忆生命周期、配额校验和通用参考文本渲染；OpenCode Adapter SHALL 在每次主模型调用时将该文本 ephemeral 注入上下文。Core SHALL NOT 构造或依赖 OpenCode 消息类型。

#### Scenario: Core 渲染固定上下文

- **WHEN** 调用 `MemoryManager.getPinnedContext`
- **THEN** 返回固定条目、最终参考文本和渲染字符数

#### Scenario: Adapter 执行 ephemeral 注入

- **WHEN** OpenCode 主模型调用触发 messages transform
- **THEN** Adapter 将 Core 返回的文本追加到本轮消息，且不写入消息历史

#### Scenario: 跨会话固定与 ephemeral 语义

- **WHEN** 固定一条记忆后由另一个会话触发消息 transform
- **THEN** 固定记忆仍按其作用域返回为参考文本，注入只追加到当前轮消息且不写入消息历史

#### Scenario: 跨会话持续注入

- **WHEN** 某记忆已固定，用户在任意新会话对话
- **THEN** 该记忆每轮被注入，不因会话切换而消失

#### Scenario: ephemeral 不落历史

- **WHEN** 注入固定记忆
- **THEN** 注入内容不持久化到消息历史；unpin 或修改后，下一轮注入立即反映变化

### Requirement: 配额（超额拒绝）

`MemoryManager.pinMemory` SHALL 在原子配额校验后返回结构化结果；超额时返回 `quota_exceeded`，不得隐式淘汰已有固定项。

#### Scenario: Adapter 映射配额错误

- **WHEN** Core 返回 `quota_exceeded`
- **THEN** OpenCode Adapter 将其格式化为兼容的用户提示，不解析异常字符串

#### Scenario: 超额拒绝

- **WHEN** 固定新记忆会导致注入总量超过配额
- **THEN** 拒绝并提示改 summary 模式或先取消其他固定
