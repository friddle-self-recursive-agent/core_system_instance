---
name: impl
docType: ImplDoc
scope: developer-system/ci
ownerRefs: [{kind: ServiceInstance, name: developer-system/ci}]
---
# ImplDoc — ci 实例怎么实现声明的能力

## how

| 声明能力 | 实现 | 驱动 |
|---|---|---|
| 代码托管（capabilities: scm） | WorkService `gitlab-prod` | gitlab-driver v1.2 |
| 构建执行（capabilities: ci-execute） | WorkService `jenkins-prod` | jenkins-driver v0.9 |
| 构建触发 | gitlab webhook → jenkins job 模板 `oncommit-main` | gitlab-driver/jenkins-driver |

## mapping（声明→实现对照）

- Goal.A1（p95<10min）→ 3 个常驻 runner + 队列上限 20（jenkins label `ci-main`）。
- Goal.A2（红线 100%）→ 保护分支配置（gitlab）+ 质量门 job 强制前置（R-01）。
- Goal.A3（阻塞通知）→ MetricThreshold 规则：`ci_stage_blocked_seconds > 1800` → Event(critical) → Bind(oncall)。

## 当前约束

- runner 规格固定 4C8G；扩容走 DeployDesign 修订，不在本实例私自扩。
