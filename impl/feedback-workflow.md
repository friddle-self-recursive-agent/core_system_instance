---
name: impl-feedback-workflow
docType: ImplDoc
scope: builtin-self-recursive-core
ownerRefs: [{kind: ServiceDesc, name: builtin-self-recursive-core}]
---
# ImplDoc — 反馈修复闭环 workflow（feedback-remediation）

> R14.2 指定设计对象：把"有错误报错 → service agent → root agent → 提议 → 批准 → developer_system pull → deploy_system 发布 → 验收"落成一套**零新概念**的设计（A56）。
> 本文档只做设计，不实现。公司侧实物（事件源系统、集群、OneDev 地址）见公司 git 上的可验证报告（agent_pool 前缀仓，A55）。

## 0. 现状盘点

| 已有 | 在本设计中的位置 |
|---|---|
| 事件机制（log 式五级 Level，dsh 队列） | concepts/event.md |
| core-workflow（触发→整理→相位态机→回归） | concepts/workflow.md |
| Agent 自治分级（默认 RootAgent=ask / ServiceAgent=auto；RootAgent 同机制可配置 auto/all，A64） | concepts/agent.md §AUTOLEVEL |
| 提案制（不允许私改 Spec，生成 Proposal 走 Apply） | principles P6 / concepts/apply.md |
| 审批相位（AwaitingApproval，挂起-恢复） | concepts/workflow.md §7 |
| 通知（ApprovalNeeded 默认接通知实例） | concepts/notification.md |
| developer-system（onedev=SCM，本地 build） | impl/developer-system.md |
| deploy-system（当前机器执行器 + install 流程） | impl/deploy-system.md |
| 验收（Goal.acceptance 可数据判定） | goal.md A3 / VerifyDoc |

## 1. 完整功能图

```
═══════════════ 观测源层（WorkService 六面体·观测面） ═══════════════
   反馈中心        工单/Bug系统       监控栈            客户端上报
 (feedback)     (bug-mgmt)      (logs/metrics)    (crash/heartbeat)
     │               │                │                  │
     └───────────────┴────────┬───────┴──────────────────┘
                              │ Connector.watch（轮询巡检，P3：事件只当信号）
                              ▼
                  Event(type=MetricThreshold|ExternalChanged, level≥error)
                              │ Scheme dispatch（类型+owner+scope 直达）
═════════════════════════════▼═══════════════════════════════════
              ┌───────────────────────────────────┐
              │ ServiceAgent（auto）〔scope:业务系统〕│ ←第一响应
              │  Analyzing：读 Goal/Rule/VerifyDoc   │
              │  对比现实（MetricsInfo）定位漂移       │
              │   ├─ 权限内可修 → Planning/Executing │
              │   │   （default-task，TaskScheme）   │
              │   └─ 跨系统/高危/无权限 ──────────┐    │
              └────────────────────────────────┼────┘
                                               ▼ Escalate（上溯 root，双通道通知）
              ┌──────────────────────────────────────────┐
              │ RootAgent（默认 ask，可配置）                │ ←第二响应
              │  生成 Proposal（Spec 变更以 Apply 进待审区） │
              │  附 DriftReport 证据 + 修复计划引用          │
              └──────────────┬───────────────────────────┘
                             ▼ Event(ApprovalNeeded, level=warn) → Notification
              ┌──────────────────────────────────────────┐
              │ AwaitingApproval（挂起-恢复）               │
              │  人审入口 = console plugin 页面（dsh 宿主）  │
              │   · 信息流视角第二层：事件流+提案 diff       │
              │   · 批准=有权限者合入 Apply；驳回=Event 回写 │
              └──────────────┬───────────────────────────┘
                             ▼ 批准合入（一次一批）
        ┌────────────────────┴───────────────────────┐
        ▼                                            ▼
 developer-system（workflow 实例）                  deploy-system（执行器）
  ① onedev-driver.checkout                      ④ 环境升序发布：
    pull 修复分支/补丁到本地                        preview → prod（deploy-system
  ② exec-local 本地 build+test                    的 ConnectorOps：集群 deployments
    （红线：test/lint 全绿才产物）                   patch/回滚，分批+健康门槛）
  ③ storage files/ 本地 put 产物（digest）        ⑤ build-status 回写 OneDev
        └────────────────────┬───────────────────────┘
                             ▼
              Verifying：探针复测（错误率归零？健康检查？）
                             ▼
              Reporting：Status.conditions 追平（observedGeneration）
                         DriftReport 归档 + Event(DriftFixed)
                             ▼
              验收 = Goal.acceptance 数据判定（无"凭感觉"）
```

## 2. 组件映射表（每个环节 → 既有概念 → 需建对象）

| # | 环节 | 承载概念 | 要新建的对象（实例级） | 公司侧实物 |
|---|---|---|---|---|
| 1 | 错误报错产生 | Event + WorkService 观测面 watch op | 无新概念；3 个 watch 源 ConnectorOps | 反馈中心/工单/监控栈的 API 轮询 |
| 2 | 事件到 service agent | Scheme dispatch 表 + Agent AUTOLEVEL | ServiceAgent 若干（按业务域） | dsh profile 会话（auto） |
| 3 | 上溯 root agent | Escalate 出口（默认上溯 root；role 挂载双通道） | RootAgent（默认 ask） | dsh profile 会话 |
| 4 | 生成提议 | Proposal = Spec 变更的 Apply 进待审区（P6，非新概念） | Proposal 文档（含证据引用） | console 页面呈现 diff |
| 5 | 批准 | AwaitingApproval 相位 + Notification(ApprovalNeeded) + 权限系统裁决 | Role（审批角色） | dsh plugin 审批页面 |
| 6 | onedev pull | developer-system：onedev-driver.checkout（同 ref 幂等） | ConnectorOps 授权 | OneDev 修复分支 |
| 7 | 发布正式环境 | deploy-system：exec-local + 集群 ConnectorOps（patch deployment，分批） | DeployDesign.envs（preview→prod 门槛） | 内网集群 prod/preview |
| 8 | 验收 | Verifying 相位 + VerifyDoc.probes + MetricsInfo | 每条 acceptance 挂探针 | 错误率/健康指标源 |

## 3. Workflow 对象（声明式，可执行在 core plugin）

```yaml
apiVersion: core/v1
kind: Workflow
metadata:
  name: feedback-remediation
  scope: builtin-self-recursive-core
spec:
  triggers:                          # ① 触发
    events: {types: [MetricThreshold, ExternalChanged], minLevel: error}
    timer: {resync: 5m}              # 巡检兜底（P3 保险丝）
  ingest:                            # ② 整理
    dedup: {window: 10m}
    group: {by: dedupKey, max: 50}
  phases: [Idle, Analyzing, AwaitingApproval, Executing, Verifying, Reporting, Failed]
  onFailed: {backoff: 60s*2^n, maxAttempts: 3, escalate: {to: root, notify: role-holders}}
  brakes:
    cooldown: 5m                     # 同一系统修复后冷却，防震荡
    maxMutationsPerTick: 5           # 发布类动作从严
    avoidRepeatFix: true             # DriftReport 防重复同类修复
  regression:
    statusWriteback: true
    reports: [DriftReport, SessionLog]
```

要点：本 Workflow **不包含业务 if-else**（反模式红线）；"先 preview 后 prod"是 DeployDesign 的 envs 声明，执行者读声明，不写死在相位里。

## 4. 跨权限分析（五穿越点，同 workflow §7 骨架）

| # | 穿越点 | 权限 | 机制 |
|---|---|---|---|
| 1 | 事件读取（观测源 watch） | bus 订阅，minLevel=error | 引擎统一订阅 |
| 2 | 文档读取（Goal/Rule/VerifyDoc） | docs.read 白名单 | SessionLog 记 docsLoaded |
| 3 | Proposal 生成 | 无副作用（只写待审区） | 待审区=独立 scope，无 prod 权限 |
| 4 | 执行（pull/build/发布） | ConnectorOps 并集 | **三条出路**：权限齐备 / 跨系统提案 / 审批提升——本 workflow 常态走 3（发布必人批） |
| 5 | Status 回写 | fieldManager 分持 | Status=引擎专写；Spec 默认 Agent 无权（P6） |

发布步骤是本 workflow 唯一的**高危穿越**：deploy ConnectorOps 默认不在 ServiceAgent 的权限并集内 → 只能走出路 3（人批），机制上保证了"发布必过审批"不靠自觉。

## 5. 分阶段落地（不开做，仅设计排序）

| 阶段 | 范围 | 退出条件 |
|---|---|---|
| P0 | 只读：3 个事件源 watch → Event 落队列；console 信息流可见 | 人工注入一条测试错误，事件 5m 内可见 |
| P1 | 分析+提议：ServiceAgent 分析、RootAgent 生成 Proposal、人工在页面批准/驳回 | 一条真实反馈走完全流程（不执行发布） |
| P2 | developer-system 接入：批准后自动 pull+build+产物 | 产物 digest 可回溯 |
| P3 | deploy-system 接入：preview 自动、prod 人批发布+回滚预案 | 预发环境一次真实发布验收 |
| P4 | prod 发布 + 全链验收探针 | acceptance 全绿一周 |

## 6. 可行性分析（逐组件）

| 组件 | 评级 | 风险/约束 | 缓解 |
|---|---|---|---|
| 事件源 watch（反馈/工单/监控） | ⚠️ 有条件 | 各系统 API 覆盖不齐；部分只有页面无 API | 能 API 的 watch；不能的定时巡检+页面探针；P3 兜底丢事件 |
| ServiceAgent 自治分析 | ⚠️ 有条件 | LLM 误判（H1 硬前提） | AUTOLEVEL=auto 仅限低危域；高危动作被权限面拦截 → 必走提案 |
| Proposal→批准 | ✅ | 机制现成（P6/AwaitingApproval/Notification） | 无 |
| developer pull+build | ✅ | onedev-driver 契约已设计；本地 build 无远端队列 | checkout 同 ref 幂等；红线 gate |
| deploy 发布正式环境 | ⚠️ 高风险面 | prod 直改、回滚慢、影响真实用户 | preview→prod 门槛；分批+健康探针；三段 undo；prod ConnectorOps 强制审批 |
| 验收数据判定 | ⚠️ 有条件 | acceptance 探针要逐条挂 MetricsInfo，工作量大 | 先挂 3 条核心探针（错误率/可用性/回滚耗时），其余 v2 |
| 双通道通知可达性 | ⚠️ 低 | 人不在环时提案积压 | Notification 多渠道；提案带 SLA 展示但不自动过期（A32） |

## 7. 待决问题

见 open-questions.md#feedback-workflow（事件源 API 清单需公司侧核实；prod 分批策略的粒度待与运维对齐）。

## 8. 审阅标注区

| 标记 | 位置 | 说明 |
|---|---|---|
| | | |
