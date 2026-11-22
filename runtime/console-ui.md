# 运行时设计 3：总控 Plugin 界面（R1.5.1 / R1.5.2）

> 宿主：dsh 侧的 console 实现（R1.5.1"dsh 后有总控 Plugin 界面"；v0.9 A43：这是实现说明，系统本身无 plugin 概念）。**v0.7 起 console 即 Core 的默认界面**（A39）；单独的 Core 界面暂缓，做通畅后再做。形态 v1=TUI，v2=Web（同一插件双渲染）。

## 第一层：Service 视角树（R1.5.1）

**必须是树**：以 Service 为主线，**Global → ServiceDesc → ServiceInstance → WorkService/Agent** 逐层展开；树上每个节点可点入，关系（引用/归属/状态）可跳转。服务关注区（§下文）= 这棵树的入口首屏。

```
Global
└─ core_system (ServiceDesc)
   ├─ Goal / Desc / Rules / Docs…          ← 声明侧文档全可点
   ├─ instances
   │  └─ default (ServiceInstance)
   │     ├─ agents: builtinRoot (Agent)    ── phase / 最近任务 / 子 agent 树
   │     ├─ impl docs: ImplDoc / VerifyDoc / DriftReport…
   │     └─ status: conditions / observedGeneration
   ├─ workflows                            ← 挂在该系统的 workflow（点入=详情页）
   │  └─ dev-delivery  ● enabled   phase: Idle
   └─ workservices
      └─ onedev (WorkService)              ── ConnectorOps / Ref / Provider / 最近事件
└─ developer-system (ServiceDesc)
   └─ …（同构展开）
```

展开次序固定：Global → ServiceDesc →（instances → Agent / impl docs / status）→（workflows）→（workservices → ConnectorOps/Ref/Provider）；同层多对象并列，跨系统引用（Ref）跳到目标系统的树。

**渲染数据全部来自 Scheme + ops DB**（无独立前端状态，避免双源）：树结构来自 Scheme 注册表+目录即对象；状态灯/数量/phase 来自 Status 与 ops DB 聚合。

对象详情页固定区：`yaml 声明` / `Status+Conditions` / `关系图`（owner↔owned、refs、roles，全部可点） / `相关事件` / `最近 DriftReport`。

硬性验收：**界面上出现的任何资源标识符都必须可点**；点不到即 UI drift（console 插件自检项）。

### workflow 详情页（树内 workflows 节点点入）

五 tab：**流程图**（相位态机自动渲染，当前相位高亮）/ **事件**（该 workflow 触发与消费的事件流）/ **流转**（每轮相位流水：相位进出时间/动作/actionLog/失败原因，轮次可回放）/ **数据流**（spec.dataflow 拼图：输入事件源→处理→产物去向，节点全可点）/ **成本**（budget_log）。操作条：启用/停用、编辑（表单+YAML）、克隆、导入——全部=Apply。

## 第二层：信息流视角（R1.5.2）

监控、状态、数据事件的流式聚合视图：

```
[对象/Kind/scope 过滤条]      # v0.11 A47：无 selector，按对象与作用域过滤
时间线（三泳道可混排）:
  Event 流      ExternalChanged / MetricThreshold / ApprovalNeeded / Install...
  状态变迁      phase/conditions 跳变（含 reason）
  数据事件      Metrics 阈值越线、产物入库（digest）、同步完成
右侧: 聚合面板（driftOpen、审批积压、死信率、Workflow 成功率、token/预算消耗）
```

两层互通：资源页看"它的事件流"；信息流页点任一条跳"相关对象"。

## 审批与 install 入口

- ApprovalNeeded 列表（Bind 命中的待审项，SLA 倒计时）→ console 内批准/驳回（=Apply）。
- install service 命令入口（触发 InstallRequested → install-service.md 流程，模板发现结果在 UI 呈现 asks）。

## 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| TUI 表达力（树+泳道+跳转） | ⚠️ 中 | v1 用成熟 TUI 框架；渲染数据全部来自 Scheme+ops DB（无独立前端状态，避免双源） |
| 全量可点的关系图成本 | ⚠️ 低 | 关系来自 ownerRefs/refs 元数据，Core 已有索引 |

## 服务关注区（默认工作区，R2.3）

资源视角/信息流视角之外的**默认入口视角**：打开 console 第一眼是服务关注区，不是资源树。

```
┌ 服务关注区（默认工作区）────────────────────────────┐
│ ▸ core_system         ● InSync    agent: dsh-core  │
│ ▸ developer-system    ● Drifting  agent: dev-1     │
│ ▸ deploy-system       ○ Idle      agent: dep-1     │
│   …（每个 service 一行：状态灯 + 负责该 service 的 agent）│
└──────────────────────────────────────────────────────┘
        │ 逐层点入：关注区 → service
        ▼
┌ service 详情页 ─────────────────────────────────────┐
│ Tabs: 文档 | 资源 | 状态 | agent 状态 | 跨系统申请 | 事件 │
│  文档    该 scope 全部对象（Goal/Rule/ImplDoc/…可点入） │
│  资源    该 service 引用的 WorkService/Connector/Ref   │
│  状态    Status/conditions/drift + 最近 DriftReport    │
│  agent 状态  负责 agent 的 phase/当前 session/最近任务   │
│  跨系统申请  Ref 解析与跨系统提案（A46）的进出流水        │
│  事件    该 scope 的事件时间线                          │
│ [与该 service 的 agent 对话] ← 每个 tab 里都有此入口     │
└──────────────────────────────────────────────────────┘
        │ 点击"对话"
        ▼
  在宿主内 ctx.agents.create({parentAgent, setup: 该 service 的 tools/docs})
  → followup 开聊；session 列表可见、可续聊（机制见 runtime/cross-agent.md）
```

**实现判断（R2.3 的"能不能用插件做"）**：能——服务关注区是渲染层聚合（数据全部来自 Core 的 Scheme 索引 + Status），对话入口走 dsh-agent 的 `ctx.agents` 原生父子机制（cross-agent.md §3）。**不需要 fork dsh**；fork 仅当 dsh 宿主本身挡死定制时启动（当前无此情况）。

与既有两层的关系：服务关注区是入口，点入 service 详情后左栏仍是资源视角（第一层）的数据，事件 tab 即信息流（第二层）按 scope 过滤的视图——三个视角同源不同切面，无双源问题。

MVP 落点：mvp/console 只实现服务关注区的单 service 行 + /api/status（多 service 聚合与对话入口随 console 正式版）。
