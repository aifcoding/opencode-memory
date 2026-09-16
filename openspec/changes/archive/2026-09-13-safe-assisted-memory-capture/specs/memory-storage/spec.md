## ADDED Requirements

### Requirement: 候选存储隔离

系统 SHALL 使用独立表保存 capture runs 和 memory candidates，不将 pending/rejected candidate 写入 memories 或 FTS。

#### Scenario: 保存 Pending 候选

- **WHEN** 合法候选通过安全扫描
- **THEN** 写入 memory_candidates，固定为 origin=agent、trust=low、status=pending

#### Scenario: 候选不建立 FTS

- **WHEN** 候选保存完成
- **THEN** memories_fts 和 session_summaries_fts 均不包含该候选

### Requirement: Capture Run 持久化

系统 SHALL 持久化 captureKey、来源、状态、lease、候选数量和过滤数量。

#### Scenario: 零候选也记录完成

- **WHEN** 提取结果合法但没有可保存候选
- **THEN** run 标记 completed 且 candidateCount=0，重复事件不再次提取

### Requirement: 候选审批事务

批准候选 SHALL 在同一事务中创建正式 memory、同步 FTS 并更新 candidate。

#### Scenario: 原子批准

- **WHEN** pending 候选通过批准前安全检查
- **THEN** memory、FTS 和 approved candidate 一起提交

#### Scenario: 原子回滚

- **WHEN** 任一步写入失败
- **THEN** 不产生正式 memory 或孤立 FTS，candidate 保持 pending
