## ADDED Requirements

### Requirement: 候选禁止自动注入

pending 或 rejected candidate SHALL NOT 自动 Pin、进入固定上下文或影响 Pin 配额。

#### Scenario: 提取完成后不注入

- **WHEN** Agent 新生成一个 pending candidate
- **THEN** 下一轮 getPinnedContext 和 OpenCode overlay 不包含该候选

#### Scenario: 批准后仍不自动 Pin

- **WHEN** 用户批准候选并生成正式 memory
- **THEN** 该 memory 保持未固定，只有用户显式 Pin 后才进入上下文

### Requirement: 候选输出使用低信任围栏

OpenCode Adapter SHALL 将候选列表和候选详情标为低信任历史参考数据。

#### Scenario: 查看候选

- **WHEN** 用户列出或读取 pending candidate
- **THEN** 候选正文位于转义后的 reference 围栏中，并明确不是正式记忆或当前指令
