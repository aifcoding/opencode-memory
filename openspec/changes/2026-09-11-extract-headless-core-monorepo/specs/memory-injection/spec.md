## MODIFIED Requirements

### Requirement: 固定记忆每轮注入

Core SHALL 负责固定记忆生命周期、配额校验和通用参考文本渲染；OpenCode Adapter SHALL 在每次主模型调用时将该文本 ephemeral 注入上下文。Core SHALL NOT 构造或依赖 OpenCode 消息类型。

#### Scenario: Core 渲染固定上下文

- **WHEN** 调用 `MemoryManager.getPinnedContext`
- **THEN** 返回固定条目、最终参考文本和渲染字符数

#### Scenario: Adapter 执行 ephemeral 注入

- **WHEN** OpenCode 主模型调用触发 messages transform
- **THEN** Adapter 将 Core 返回的文本追加到本轮消息，且不写入消息历史

### Requirement: 配额（超额拒绝）

`MemoryManager.pinMemory` SHALL 在原子配额校验后返回结构化结果；超额时返回 `quota_exceeded`，不得隐式淘汰已有固定项。

#### Scenario: Adapter 映射配额错误

- **WHEN** Core 返回 `quota_exceeded`
- **THEN** OpenCode Adapter 将其格式化为兼容的用户提示，不解析异常字符串
