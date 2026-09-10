# memory-injection Specification

## Purpose
定义固定记忆的显式生命周期、全文与摘要模式、注入配额及每轮上下文注入行为。

## Requirements

### Requirement: 固定记忆每轮注入

已固定的记忆 SHALL 在每次主模型调用时自动注入上下文，注入内容不写入消息历史（ephemeral，改/删后下一轮生效）。

#### Scenario: 跨会话持续注入
- **WHEN** 某记忆已固定，用户在任意新会话对话
- **THEN** 该记忆每轮被注入，不因会话切换而消失

#### Scenario: ephemeral 不落历史
- **WHEN** 注入固定记忆
- **THEN** 注入内容不持久化到消息历史；unpin 或修改后，下一轮注入立即反映变化

### Requirement: 显式 pin 生命周期

pin/unpin SHALL 仅由用户显式触发，无自动 pin。

#### Scenario: 显式固定
- **WHEN** 用户固定一条记忆
- **THEN** 该记忆 `pinned_at` 置时间戳，开始每轮注入

#### Scenario: 显式取消
- **WHEN** 用户取消固定
- **THEN** `pinned_at` 清空，停止每轮注入（记忆本身保留，仍可 recall）

### Requirement: full/summary 双模式

pin SHALL 支持 full（注入全文）与 summary（注入一行摘要）两种模式。

#### Scenario: summary 模式要求摘要非空
- **WHEN** 以 summary 模式固定但该记忆无 summary
- **THEN** 拒绝并提示提供 summary 或改用 full 模式

### Requirement: 配额（超额拒绝）

固定记忆按最终渲染文本计算的注入总量 SHALL 有上限；超额时拒绝新的 pin，不隐式淘汰已有固定。

#### Scenario: 超额拒绝
- **WHEN** 固定新记忆会导致注入总量超过配额
- **THEN** 拒绝并提示改 summary 模式或先取消其他固定

### Requirement: memory_pins

系统 SHALL 提供 `memory_pins` 工具，用于列出当前固定记忆。

#### Scenario: 查看固定列表
- **WHEN** 用户请求查看固定记忆
- **THEN** 返回所有固定记忆的 id/title/mode
