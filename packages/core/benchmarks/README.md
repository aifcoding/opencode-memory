# Capture benchmark

这是 20 条人工标注样本的 **deterministic pipeline self-test**，不是真实模型提取质量基线。样本覆盖规范、架构决策、故障根因、一次性任务、临时错误、未确认猜测、凭据、已注入记忆和工具结果。

运行：

```bash
bun run evaluate.ts
```

当前确定性规则提取器只匹配 `规范/约定/决策/采用/根因/工作流/偏好/确认` 关键词，输出：

```json
{
  "samples": 20,
  "precision": 1,
  "recall": 1,
  "falsePositiveRate": 0,
  "domainAccuracy": 0.9,
  "duplicateRate": 0
}
```

该结果只说明确定性规则、自标注样本和评测脚本连通；真实模型的 Precision/Recall/FPR/Domain Accuracy/Duplicate Rate 需要后续接入提取 Agent 后重新测量。
