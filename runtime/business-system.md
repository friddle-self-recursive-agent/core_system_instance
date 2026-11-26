# runtime/business-system — 企业业务系统层落地口径（独立项目 / 独立 cored / 账本与事件总线分离）

> 概念依据：core_design `concepts/business-system.md` + `systems/common-business-system/`（R-BIZ-1..7、StateModel/Finance DocType、基词表）。本篇是机读落地口径（R-DOC-5 双仓承载）。
> 用户裁决（2026-11-26）：① **business-system 不在最外层 `core_system` 根项目中，单独设计**；每个业务系统实例（如 `sybran`）运行**自己独立的第二个 `cored` 进程与独立的 SQLite `docs DB`**（每个 `cored` 只挂载单个 `docsRoot/docs DB`）；② **业务内部流水/账本与外部控制面事件严格区分**：业务高频交易、会计分录（Ledger Entry）与逐笔对账由**业务代码承接，自己走自己的内部事件与账本**；外层控制面 `cored` 事件总线**只承接系统级别事件、报警事件、以及对账失败事件**。

## 1. 五域 → 运行时承接（业务代码内部流 vs 控制面三类事件）

| 域 | 声明面（业务独立 `cored` Spec） | 现实面（业务代码账本 vs 控制面投影） | 循环与控制面事件边界 |
|---|---|---|---|
| 状态 | StateModel 文档（闭合集+迁移表） | 对象 Status/conditions（workflow-engine fieldManager 回写） | 状态投影刷新；异常迁移发**系统级/报警事件** |
| 财务 | Finance 文档（科目+额度+闸门线） | **逐笔分录/流水=业务系统自有代码与 ACID 账本库承接（严禁用控制面带 dedup 的 Event Bus 当账本）**；现状数字=从业务账本推导投影至 `MetricsInfo` 查询声明（**禁止存储手填现状**） | 逐笔对账由业务代码内部循环执行；控制面只收**额度越限报警事件（`MetricThreshold`/`ApprovalNeeded`）与对账失败事件（携 `DriftReport`）** |
| 业务 | WorkflowDesign + Workflow 对象（节点绑定） | 业务高频流走业务代码内部事件；控制面管跨阶段 Workflow 与 Agent run/session 审计 | 流程绑定一致性随全量对账 |
| 监控 | Metrics（indicators+thresholds） | MetricThreshold **报警事件**（装配层阈值桥） | 巡检（ReconcileTick 同拍） |
| 事务 | WorkService.tools（idempotent/undo/cleanup） | Connector 驱动执行留痕 | undo 契约核查进投产检查 |

## 2. 投产检查（R-BIZ lint 型判据）

投产前机械判定，任一不过=拒绝投产（Event warn + 拒绝原因可见）：

1. **R-BIZ-1**：投产对象族的每个状态词 ∈ StateModel 注册闭合集；迁移表覆盖该对象声明的全部迁移边。
2. **R-BIZ-2/4**：投产流每条在 DataDesign 有 source→sink+幂等性+留痕声明，且**财务分录/高频业务流已绑定至业务自有账本而非控制面 `event_log`**；上报控制面的事件仅限系统级事件、报警事件、对账失败事件三类。
3. **R-BIZ-5 关联**：投产域在 Metrics 有 ≥1 个指标+阈值声明。
4. **R-BIZ-6**：投产动作引用的 tools op 声明了 idempotent/undo；undo:none 未挂人审档=拒绝。

checker 落点待定（core_design lint/ 或实例侧，见 open-questions.md#business-system）；未挂 checker 前按 policy 巡检（R-TYPE-1 纪律：无 checker 的 lint=未生效，不得声明为已生效）。

## 3. 实例落地路径（双 `cored` 物理分离）

- **独立项目与独立 `cored`**：最外层 `core_system` 的 `cored`（`core_agent`）只挂载根项目的单个 `docs DB`；业务实例（首个=`sybran-business-system`）在 `sybran agent` 上运行**自己独立的 `cored` 实例**，挂载 `sybran` 自己的 SQLite `docs DB`（单 `cored` 单 `docs DB` 契约不变）。
- 实例以**引用继承**本层规则：实例仓只放特化物（对象清单/科目树/指标口径/节点绑定），零控制面机制重造。
- 实例设计仓=公司 OneDev 私有仓（`sybran-*` 前缀，R-PUB 占位：`<公司 OneDev>`；实址在部署侧决策台账）；运行面=sybran 侧独立 agent + 独立 `cored` 部署，与 core agent **物理分离**。
- 实例投产顺序建议：状态域（对象入册）→ 流域（内部账本流 vs 控制面事件流声明）→ 监控（指标+阈值）→ 财务（科目+闸门+对账失败上报循环）——先有观测再有钱闸，避免盲区上线（R-BIZ-5 先于 R-BIZ-3 生效）。

## 4. 与既有 runtime 的关系

- 对账监督循环复用 `runtime/workflow-runtime.md` 的推进拍与刹车语义（brakes 对结算监督循环同样生效：cooldown/maxMutations 不可关闭）。
- 控制面事件归档复用 `runtime/ops-log.md`（仅存系统级/报警/对账失败三类控制面事件；业务逐笔账本在业务自有 DB 中独立持久化与对账）。
- 状态回写复用 `runtime/execution-model.md` 的 P2 fieldManager 纪律（人不得手写 Status）。
