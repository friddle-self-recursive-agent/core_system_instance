# runtime/business-system — 企业业务系统层落地口径

> 概念依据：core_design `concepts/business-system.md` + `systems/common-business-system/`（R-BIZ-1..7、StateModel/Finance DocType、基词表）。本篇是机读落地口径（R-DOC-5 双仓承载），不重复概念论证。

## 1. 五域 → 运行时承接（零新机制）

| 域 | 声明面（Spec） | 现实面（运行时投影） | 循环 |
|---|---|---|---|
| 状态 | StateModel 文档（闭合集+迁移表） | 对象 Status/conditions（workflow-engine fieldManager 回写） | 状态投影刷新=对账循环判据之一 |
| 财务 | Finance 文档（科目+额度+闸门线） | 流水=事件归档查询；现状数字=MetricsInfo 查询声明（**禁止存储手填现状**） | 账实对照+月结/年结 Workflow |
| 业务 | WorkflowDesign + Workflow 对象（节点绑定） | Agent run/session 审计 | 流程绑定一致性随全量对账 |
| 监控 | Metrics（indicators+thresholds） | MetricThreshold 事件（装配层阈值桥） | 巡检（ReconcileTick 同拍） |
| 事务 | WorkService.tools（idempotent/undo/cleanup） | Connector 驱动执行留痕 | undo 契约核查进投产检查 |

## 2. 投产检查（R-BIZ lint 型判据）

投产前机械判定，任一不过=拒绝投产（Event warn + 拒绝原因可见）：

1. **R-BIZ-1**：投产对象族的每个状态词 ∈ StateModel 注册闭合集；迁移表覆盖该对象声明的全部迁移边。
2. **R-BIZ-4**：投产流每条在 DataDesign 有 source→sink+幂等性+留痕声明。
3. **R-BIZ-5 关联**：投产域在 Metrics 有 ≥1 个指标+阈值声明。
4. **R-BIZ-6**：投产动作引用的 tools op 声明了 idempotent/undo；undo:none 未挂人审档=拒绝。

checker 落点待定（core_design lint/ 或实例侧，见 open-questions.md#business-system）；未挂 checker 前按 policy 巡检（R-TYPE-1 纪律：无 checker 的 lint=未生效，不得声明为已生效）。

## 3. 实例落地路径

- 实例（首个= sybran 业务实例）以**引用继承**本层规则：实例仓只放特化物（对象清单/科目树/指标口径/节点绑定），零机制定义。
- 实例设计仓=公司 OneDev 私有仓（`sybran-*` 前缀，R-PUB 占位：`<公司 OneDev>`；实址在部署侧决策台账）；运行面=sybran 侧独立 agent 部署，与 core agent **物理分离**（各自机器/各自 dsh，互不承载对方负载）。
- 实例投产顺序建议：状态域（对象入册）→ 流域（流声明）→ 监控（指标+阈值）→ 财务（科目+闸门+对账循环）——先有观测再有钱闸，避免盲区上线（R-BIZ-5 先于 R-BIZ-3 生效）。

## 4. 与既有 runtime 的关系

- 对账循环复用 `runtime/workflow-runtime.md` 的推进拍与刹车语义（brakes 对结算循环同样生效：cooldown/maxMutations 不可关闭）。
- 事件归档复用 `runtime/ops-log.md`（append-only；每日对账纪律即 R-BIZ-7 的账实对照载体）。
- 状态回写复用 `runtime/execution-model.md` 的 P2 fieldManager 纪律（人不得手写 Status）。
