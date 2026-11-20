---
name: goal
docType: Goal
scope: developer-system
labels: {domain: devtools}
ownerRefs: [{kind: ServiceDesc, name: developer-system}]
---
# Goal — developer-system

## intent

为研发团队提供一条从提交到可部署产物的连续流水线：代码托管、评审、CI 构建、质量门禁全部在线可查，任何环节阻塞超过阈值必须有人被通知到。

## acceptance（可验收条款，Verifying 的判据）

- A1. 提交到构建启动 p95 < 10min（Metrics 指标 `ci_pickup_p95`）。
- A2. 主分支红线检查 100% 执行，无旁路合并（Rule R-01 关联）。
- A3. 任一阶段阻塞 > 30min，对应 Bind 的 oncall 在 5min 内收到通知（Event 可审计）。
- A4. 每周可出一份流水线健康周报（DriftReport 聚合）。
