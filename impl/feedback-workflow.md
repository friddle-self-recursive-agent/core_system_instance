---
name: impl-feedback-workflow
docType: ImplDoc
scope: builtin-self-recursive-core
ownerRefs: [{kind: ServiceDesc, name: builtin-self-recursive-core}]
---
# ImplDoc — 反馈修复闭环（=core-system-developer-loop 入口形态）

> 2026-11-27 用户裁定「现在不是这个模式了」：旧的独立 `feedback-remediation` Workflow 设计（专属相位机+专属 YAML）**作废**。
> 通用解释器架构下（concepts/workflow.md 权威）：**反馈修复闭环不是一份独立 workflow，而是 `core-system-developer-loop` 的入口形态之一**——观测源产生 Event/日志，命中节点 1（Idle 监听），之后走同一条 8 节点主干（Agent 判断→审批→Doc Apply→developer-system→验收→deploy-system→总结归档）。零专属对象、零新概念。

## 1. 入口映射（反馈 → 主干）

```
观测源（WorkService 六面体·观测面 watch：反馈中心/工单/监控栈/客户端上报）
  │  Connector.watch（轮询巡检；事件只当信号，P3）
  ▼
Event(type=MetricThreshold|ExternalChanged, level≥error)
  │  Scheme dispatch（类型+owner+scope 直达）
  ▼
core-system-developer-loop
  节点1 监听日志与 Event ─→ 节点2 Agent 判断 ─→ 节点3 审批（human|agent|auto 可切）
  ─→ 节点4 Doc Apply（修复方案/临时 BugDoc 落库） ─→ 节点5 developer-system（pull/build/产物 digest）
  ─→ 节点6 验收（探针复测） ─→ 节点7 deploy-system（发布/回滚） ─→ 节点8 总结归档+Status 回写
```

- 修复方案文档 = 节点 4 的 Doc Apply（临时 BugDoc 可建，收尾动作 invalidate/delete/keep 在节点 8 `postActions`/`bugDocPolicy` 可配，通用解释器原则）。
- 验收 = VerifyDoc.probes 探针 + Goal.acceptance 数据判定（节点 6 conditions[] 自由增删）。

## 2. 关键配置点（继承自旧设计，落点全在声明面）

| 配置 | 声明位置 | 说明 |
|---|---|---|
| 事件源接入 | WorkService 观测面 watch op + scheme dispatch | 源系统各建六面体；API 覆盖不齐的定时巡检兜底 |
| 发布门槛 | 各业务 DeployDesign.envs（preview→prod 顺序） | "先预发后生产"是声明，不写死在相位里 |
| 发布高危闸 | deploy 渠道 ConnectorOps 默认不在 ServiceAgent 权限并集 | 越权请求→审批闸（权限双态：默认直给/越权弹窗，permission.md 规则 6）——发布必过人批不靠自觉 |
| 验收探针 | VerifyDoc.probes + MetricsInfo | 错误率/可用性/回滚耗时先行，逐条挂探针 |
| 修复防震荡 | workflow 副本属性（cooldown/防重复修复类声明，可 fork 配置） | 出厂主干不改，部署侧 fork 副本调参 |

## 3. 落地形态

无专属 workflow 对象。部署侧按需 **fork `core-system-developer-loop` 副本**调整绑定：事件源 service、developer/deploy 渠道绑定值、审批档位（human/agent/auto）；主干 `undeletable+immutableNodes` 不动。平台级声明示例见 `examples/workflows/`（`gh-issue-trigger`、`agent-release`——同构：入口触发→agent→审批→文档→构建→验收→发布）。

## 4. 可行性

| 项 | 评级 | 说明 |
|---|---|---|
| 入口 1（Event/日志触发） | ✅ | workflow 引擎已实现并活体（entryPoints 双入口，scheme dispatch 直达） |
| 审批闸/通知 | ✅ | AwaitingApproval 挂起-恢复+ApprovalNeeded 通知已活体；权限双态默认弹窗 |
| BugDoc 收尾可配 | ✅ | 节点 8 postActions/bugDocPolicy 已声明面可增删 |
| 探针验收 | ✅ | VerifyDoc.probes+Verifying 相位既有机制 |
| 发布门槛 | ✅ | DeployDesign.envs 声明+deploy 渠道 ConnectorOps 绑定（渠道=部署侧变体） |

## 5. 审阅标注区

| 标记 | 位置 | 说明 |
|---|---|---|
| | | |
