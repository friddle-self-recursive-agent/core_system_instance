# Loop 管线设计

> 概念定义见 [concepts/loop.md](../concepts/loop.md)；本文件是完整管线：原稿管线逐句映射 + 状态机 + 异常路径 + 上下文装配。

## 1. 原稿管线 → 本设计映射

| 原稿 | 本设计 | 概念依据 |
|---|---|---|
| 系统自动 event | 触发源五种：Connector watch / Metric 阈值 / 定时巡检 / Apply 写入 / 人工 | A5，event.md |
| event loop（查看 dsh） | Core 按 Scheme.dispatch（含 Selector 匹配）路由到对应 Loop/Instance | A15，scheme.md |
| service agent 处理（可配置 bind 人） | 派发给 Instance 的 agentRefs；命中 Policy 风险规则则插入审批点（Bind） | agent.md、policy.md、bind.md |
| 按 docs 分析 | 分层上下文装配（§3）→ gap 分析 → DriftReport | servicedesc.md、serviceinstance.md |
| plan | 计划生成 + dry-run 预演（Loop.safety.dryRunFirst） | loop.md 概念 |
| 执行修复 | 经 Connector.apply（幂等）/ Apply（写文档），预算内执行 | connector.md、apply.md |
| 验证通过 | Connector.verify + Rule 校验 + MetricsInfo 复测，Goal.acceptance 为最终判据 | doctypes（acceptance） |
| 更新系统 status 等 | 回写 Status（conditions/observedGeneration/drift） | status.md |
| agent 处理（第二次出现） | Report 阶段：Agent 产出 DriftReport/摘要（A14 定界） | status.md、event.md |
| 汇总 → 观测 | Event 上报 → 观测面聚合（按 Selector） | selector.md |

## 2. 完整状态机

```
                ┌────────────────────────────────────────────────┐
                │                    Loop 引擎                    │
                └────────────────────────────────────────────────┘
 Idle
  │ 触发(Event/定时/Apply)
  ▼
 Dispatch ──route miss──► DeadLetter(告警)
  │ 命中 Instance → 派发 Agent 任务
  ▼
 Assemble ── 分层装配上下文（§3），超预算→降级
  ▼
 Analyze ─── 全量对比：Spec(docs) vs Reality(MetricsInfo+Connector.get)
  │            产出 DriftReport{drifts[], 建议actions[]}
  ├─ InSync ───────────────► Report ──► Idle（no-op，不发Event）
  ▼ 有 drift
 Gate ────── Policy 评估 actions：高危→ApprovalNeeded → AwaitingApproval
  │                          └─ 人驳回 → Report(记录) → Idle
  ▼ 放行/批过
 Plan ────── 动作序列 + dry-run 预演（plan() 结果给 Agent 复核）
  ▼
 Execute ─── 预算内逐步 apply；单步失败 → 尝试 undo → Backoff
  ▼
 Verify ──── 复测现实；不过 → Backoff（带"改过什么"记录防重复修）
  │ 过
  ▼
 Report ──── 回写 Status + DriftReport 归档 + Event(DocApplied/DriftFixed)
  ▼
 CoolDown ── cooldown 后回 Idle

 Backoff：指数退避重试 maxAttempts 次 → 仍失败 → Escalated（Bind 的人，SLA 升级链）
 Escalated：人处理后（Apply 决定/手修现实/改 Spec）→ 重新触发
```

## 3. 上下文分层装配（成本关键）

全量文档塞不进上下文，按层加载（agent.md 可行性的核心缓解）：

| 层 | 内容 | 何时加载 |
|---|---|---|
| L0 常驻 | Goal.acceptance、全部 Rule 的 ruleId 摘要 | 每轮必载 |
| L1 按需 | 命中 drift 的 Rule/WorkflowDesign/Metrics 段落 | Analyze 有 drift 后 |
| L2 证据 | 上轮 DriftReport、ImplDoc/VerifyDoc 相关段 | Plan 阶段 |
| L3 现实 | MetricsInfo 查询结果（带窗口：近 1h/24h 摘要） | Analyze/Verify |

预算（Loop 对象的 budget）：超预算 → 降级为"只报告不修复"（DriftReport 仍产出），绝不硬塞。

## 4. 异常路径汇总

| 异常 | 处理 |
|---|---|
| 修复震荡 | CoolDown + maxMutationsPerTick + DriftReport 记录防重 |
| 重试耗尽 | Escalated（一等终态，非异常） |
| 审批超时 | approvalSla 到点沿 escalationChain 上抛 |
| 事件风暴 | dedupKey 聚合 + Loop 最小间隔 |
| 上下文超预算 | 降级只报告 |
| Agent 崩溃 | 任务幂等重入，Loop 重新派发 |
| Connector 不可达 | drift 记为 Unknown（condition Unknown 态），N 次后 Escalated |

## 5. 一个完整例子（developer-system/ci）

```
1. Connector(gitlab-driver).watch 发现 runner 标签变更 → Event(ExternalChanged)
2. Core 查 dispatch：selector{domain:devtools} → Loop(developer-system-main)
3. Loop 派任务给 Agent(ci-repair-agent)；
   Agent 装配 L0：Goal.acceptance"CI p95<10min"、Rule R-07"runner≥4 且标签匹配"
4. Analyze：Connector.get → 实际 runner 3/4，标签漂移
   → DriftReport{d1: runner-shortage, d2: label-mismatch}
5. Gate：修复动作=调 gitlab API 补 runner（非高危，Policy 放行）
6. Plan：gitlab-driver.plan → [注册 1 个 runner, 修标签]；dry-run ok
7. Execute：apply 两个动作（actionLog 落盘）
8. Verify：get 复查 4/4 + MetricsInfo p95 复测 → 通过
9. Report：Status.conditions[Ready=True]，observedGeneration 追平，
   DriftReport 归档，Event(DriftFixed)
10. CoolDown → Idle。观测面：devtools 域 drift-1，趋势可查。
```
