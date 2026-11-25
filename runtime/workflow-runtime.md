# Runtime — Workflow 引擎运行时（管线 + 编辑 + 展示 + 数据流 + 落地 agent）

> 概念依据：core_system/concepts/workflow.md（Workflow=循环本体；**不存在 Loop 概念，一切循环皆 Workflow**）。
> 本文件是运行时落地形态：引擎怎么跑（管线）、怎么编辑、怎么展示、数据流怎么走、怎么把 Workflow 落到真实系统（专用 agent）。

## 1. 引擎实现（代码，非 LLM 即兴）

Workflow 引擎 = core 内的一段**确定性代码**（状态机 + 触发器 + 刹车 + 成本记账）。LLM 只出现在两个被声明的点：`spec.llm` 指定的生成相位（分析/计划）、执行相位内的 Agent。引擎本身不做任何"智能"判断——规则之外引擎无动作。

管线（对原始要求逐条映射）：

| 原始要求 | 本设计 | 概念依据 |
|---|---|---|
| 系统自动 event | 触发源五种：Connector watch / Metric 阈值 / 定时巡检 / Apply 写入 / 人工 | event.md |
| 路由到对应系统 | Core 按 Scheme.dispatch（类型+owner+scope）路由到 Workflow 实例 | scheme.md |
| service agent 处理 | 派发给 Instance 的 agentRefs；命中风险规则插入审批点（role） | agent.md、permission.md |
| 按 docs 分析 | 分层上下文装配（§3）→ gap 分析 → DriftReport | servicedesc.md |
| plan | 计划生成 + dry-run 预演（spec.safety.dryRunFirst） | task-scheme.md |
| 执行修复 | ConnectorOps 幂等执行 / Apply 写文档，预算内 | connector.md、apply.md |
| 验证通过 | Connector.verify + Rule 校验 + MetricsInfo 复测，Goal.acceptance 为最终判据 | doctypes |
| 更新 status | 回写 Status（conditions/observedGeneration/drift） | scheme.yaml conventions |
| 汇总→观测 | Event 上报 → 观测面聚合 | event.md |

## 2. 完整状态机

```
                ┌────────────────────────────────────────────────┐
                │              Workflow 引擎（代码）               │
                └────────────────────────────────────────────────┘
 Idle
  │ 触发(Event/定时/Apply)         [spec.enabled=false → 全部旁路]
  ▼
 Dispatch ──route miss──► DeadLetter(告警)
  │ 命中 → 派发 Agent 任务
  ▼
 Assemble ── 分层装配上下文（§3），超预算→降级
  ▼
 Analyze ─── 全量对比：Spec(docs) vs Reality(MetricsInfo+ConnectorOps.get)
  │            产出 DriftReport{drifts[], 建议actions[]}
  ├─ InSync ───────────────► Report ──► Idle（no-op，不发Event）
  ▼ 有 drift
 Gate ────── 权限系统评估 actions：高危→ApprovalNeeded → AwaitingApproval
  │                          └─ 人驳回 → Report(记录) → Idle
  ▼ 放行/批过
 Plan ────── 动作序列 + dry-run 预演
  ▼
 Execute ─── 预算内逐步执行；单步失败 → 尝试 undo → Backoff
  ▼
 Verify ──── 复测现实；不过 → Backoff（带"改过什么"记录防重复修）
  │ 过
  ▼
 Report ──── 回写 Status + DriftReport 归档 + Event(DocApplied/DriftFixed)
  ▼
 CoolDown ── cooldown 后回 Idle

 Backoff：指数退避重试 maxAttempts 次 → 仍失败 → Escalated（一等终态）
 Escalated：人处理后（Apply 决定/手修现实/改 Spec）→ 重新触发

 AUTO 处理不了的 Escalate 到达 → 按 spec.onEscalate 策略（可配置）：
   pause       → 任意相位 → Paused（相位冻结，现场+断点=SessionLog 保留）
   finish-tick → 跑完本轮（防半成品）→ Paused
   continue    → 只通知（root 上报+Bind 发送），不停
 Paused：人处理后在 console 批准 Resume（=Apply）→ 回到挂起前的相位续跑；
   恢复不自动——autoResume 仅 continue 级可选
```

每个相位状态与迁移**都落 ops DB**——这就是展示层"提交流转"的数据源（§5）。

## 3. 上下文分层装配（成本关键）

| 层 | 内容 | 何时加载 |
|---|---|---|
| L0 常驻 | Goal.acceptance、全部 Rule 的 ruleId 摘要 | 每轮必载 |
| L1 按需 | 命中 drift 的 Rule/WorkflowDesign/Metrics 段落 | Analyze 有 drift 后 |
| L2 证据 | 上轮 DriftReport、ImplDoc/VerifyDoc 相关段 | Plan 阶段 |
| L3 现实 | MetricsInfo 查询结果（带窗口：近 1h/24h 摘要） | Analyze/Verify |

预算超限 → 降级为"只报告不修复"（DriftReport 仍产出），绝不硬塞。

## 4. 异常路径汇总

| 异常 | 处理 |
|---|---|
| 修复震荡 | CoolDown + maxMutationsPerTick + DriftReport 记录防重 |
| 重试耗尽 | Escalated（一等终态，非异常） |
| 审批长时间无人处理 | Notification 重发 + Escalate 上溯（无 SLA 机器，A35/A32） |
| 事件风暴 | dedupKey 聚合 + Workflow 最小间隔 |
| 上下文超预算 | 降级只报告 |
| Agent 崩溃 | 任务幂等重入，Workflow 重新派发 |
| ConnectorOps 不可达 | drift 记为 Unknown（condition Unknown 态），N 次后 Escalated |
| Escalate 到达（AUTO 处理不了） | 按 onEscalate 策略：pause（立即挂起）/ finish-tick（跑完本轮停）/ continue（只通知）；恢复=人批 Resume |

## 5. 可编辑与展示（console 的 workflow 面）

**编辑**：Workflow 就是文档——编辑=改 spec 后 Apply（过权限系统）；console 提供表单化编辑器（enabled/triggers/services/llm/brakes 分组字段），保存即 Apply。第三方（别的系统、别人）编辑走同一入口：有对应 scope 写权限即可编辑；**导入**：把外部系统的既有编排（如既有 CI 流水线描述）渲染成 Workflow spec 后 Apply 入库（导入预览=dry-run 展示渲染结果）。

**展示**（数据全部来自 Scheme+ops DB，无独立前端状态）：

```
┌ workflow 详情页 ────────────────────────────────────┐
│ Tab1 流程图    相位态机自动渲染（当前相位高亮，mermaid） │
│ Tab2 事件      该 workflow 触发/消费的事件流（可过滤）   │
│ Tab3 流转      每轮的相位流水（ops DB：相位进出时间/     │
│               动作/actionLog/失败原因），轮次可回放     │
│ Tab4 数据流    输入事件源 → 处理 → 产物去向（引用关系图， │
│               节点=对象全部可点）                       │
│ [启用/停用] [编辑] [克隆] [导入] ── 全部=Apply 动作     │
└─────────────────────────────────────────────────────┘
```

**数据流**：Workflow 声明自己的输入输出（`spec.dataflow`）——输入=触发事件源与读的文档域；输出=写的 Status/产物/通知。展示层把同 scope 内多条 Workflow 的 dataflow 拼成系统级数据流图（谁的事件流向谁、产物进哪个存储）。

## 6. 不同系统挂钩不同 workflow

- Workflow 归属：builtin 集合在 `global/workflows/`；系统自定义在 `systems/<s>/workflows/<name>.yaml`——**目录即挂钩**（scope.md），一个系统挂几条 workflow、各自管什么，由其目录下的对象清单表达。
- 触发挂钩：`spec.triggers.events` 按类型+owner 路由（dispatch 表）；同一事件可命中多条 workflow（各自独立运转、各自刹车）。

## 7. 默认研发 workflow（builtin：`dev-delivery`）

系统自带一条完整的研发交付 workflow（默认文档，可整体 disable、可逐步调整）：

```
触发：event（错误日志 ≥error / 新需求工单 / 用户请求）
  ↓ Analyze   Agent 读 L0/L1 + 错误日志/需求描述 → 产出问题定位或需求拆解
  ↓ Gate      高危/跨系统 → AwaitingApproval（人批）；auto 白名单内直接过
  ↓ Plan      修复/实现计划 → 选 TaskScheme 模板（build-and-verify）
  ↓ Execute   ① developer-system：onedev pull 修复分支/新代码
              ② 本地 build + test（红线：lint/test 全绿才产物）
              ③ 产物 digest 入库
  ↓ Verify    探针复测（错误率归零？新功能验收点？）
  ↓ Deploy    deploy-system 按 DeployDesign.envs 升序发布（preview→prod，prod 人批）
  ↓ Report    Status 追平 + DriftReport/SessionLog 归档 + Event(DriftFixed)
```

**override 默认验收报告标准**=acceptance.md §8：里程碑标题 `[<scope>] <里程碑>（loop-<seq>）` + 机械证据指针 + 页面截图（内置 Skill acceptance-screenshot/chromium-headless 由 agent 在验收节点调用）。

**每一步都可调整**：步骤=声明的相位与 TaskScheme 引用，调整=改 spec/模板参数后 Apply（如"prod 必须人批"收紧 Gate、"preview 自动"放宽 Execute）；整条可用 spec.enabled 一键停用。

## 8. Workflow 落地 = 专用 agent（apply-workflow）

把一份 Workflow 声明落到真实系统（接线、写代码、闭环验证）**本身也是 workflow 干的活**——由专用 agent 承担：

```
Workflow spec（新入库/变更）
  → apply-workflow agent（builtin，AUTOLEVEL=ask 默认）
      ├ 解析 spec：触发源接线（注册 Connector watch）、相位→代码落点
      ├ 缺的连接层 → 调 developer-system（pull/写自定义 connector 代码/build）
      ├ 每层调用代码化：引擎与 ConnectorOps 的对接由代码实现，不是运行时即兴
      └ 落地后闭环：注册一条 watch-only workflow 监控新 workflow 的
        成功率/死信/成本（自监控）→ 异常回 Event 走修复循环
```

要点：**流程实现=代码**（引擎+connector 是代码），**写代码的过程=调研发系统**（developer-system 闭环），**监控=core_system 内置 workflow 自举承担**（self-hosting：管理 workflow 的也是 workflow）。

## 9. 一个完整例子（developer-system/ci）

```
1. Connector(onedev-driver).watch 发现 runner 标签变更 → Event(ExternalChanged)
2. Core 查 dispatch → Workflow(developer-system-workflow)
3. 派任务给 Agent(ci-repair-agent)；装配 L0：Goal.acceptance"CI p95<10min"、Rule R-07"runner≥4 且标签匹配"
4. Analyze：ConnectorOps.get → 实际 runner 3/4，标签漂移 → DriftReport{d1, d2}
5. Gate：修复动作=调 API 补 runner（非高危，放行）
6. Plan：plan → [注册 1 个 runner, 修标签]；dry-run ok
7. Execute：apply 两个动作（actionLog 落盘）
8. Verify：get 复查 4/4 + MetricsInfo p95 复测 → 通过
9. Report：Status 追平，DriftReport 归档，Event(DriftFixed)
10. CoolDown → Idle。观测面：devtools 域 drift-1，趋势可查。
```

## 10. loop 版本记录（验收锚点）

每次 workflow loop 执行到 Report 相位产出一条**带版本**的执行记录：

- 版本号：`loop-<seq>`，seq 单调递增、持久于 ops DB（Report 相位分配，重启不重置）；
- 内容：触发源 / 相位轨迹 / 关键产物 digest / 验收探针结果（Goal.acceptance 复测）/ 偏差清单；
- 去向：ops DB 相位流水 + `acceptance/loop-<seq>.md`（**运行时临时文档，gitignore，永不提交**——core_design rule.md R-PUB-3）；
- 语义：版本记录是对账锚点——按版本可复查"这轮改了什么、验了什么、过没过"；收敛判定（连续 N 轮无新偏差）读版本序列。

验收与验证流程全文（机械/语义/回归三层、报告模板、设计偏离回写）见 [acceptance.md](acceptance.md)。

## 11. 执行模型：节点=session/agent，默认绑定 ConnectorOps（apply 即实现）

- **节点执行单元**：global workflow 节点=session；service 内部 workflow 节点=session；跨 service（外部）=agent 调 agent。
- **默认绑定**：每 workflow 缺省绑定同名 ConnectorOps（`<name>` → `<name>` ConnectorOps；`spec.connector` 可覆写）。
- **apply 即实现**：workflow apply（创建/变更）→ apply-workflow agent 写入/更新该 ConnectorOps 实现（骨架+节点接线）；运行时不做代码即兴。
- **代码仓库与生效**：所有 ConnectorOps 实现归 **deploy-system** 的 git 仓库，按小概念命名 `connectops-<concept>`（connectops-chrome/dsh/opencode/gh…）；流程=写代码 → 提交（每次变更必提交，override 亦同）→ **build 生效** → 运行时引用；未 build 生效=unbound，运行态不可引用。
- **调用链**：`docs（workflow spec）→ connectDef（scheme/ConnectorOps 对象）→ connectOps 代码`。
- **流转**：引擎相位机只负责相位推进/刹车/记账；绑定的 ConnectorOps 按声明序列流转节点——Service 调用节点（ops）、Agent 节点（唤醒/派子任务）、其他 ConnectorOps（嵌套调用）。
- **判别器**：apply 一条 workflow → 同名 ConnectorOps 实现出现且含节点流转骨架；改 spec 再 apply → 实现更新（diff 可查）；未绑定/未实现 → 决策面 `execution=unbound` 可见。

### 11.1 落地形态（2026-11-26，R-7 轮——机械面/agent 面二分）

「apply 即实现」拆成两步，各自可机械验收：

| 步 | 执行体 | 产物 | 验收判据 |
|---|---|---|---|
| 骨架+节点接线 | **cored 绑定物化器**（`--allow-apply` 写面开启时装配；DocApplied×Workflow 订阅 + 装配期存量枚举初值——metrics 阈值桥 v0.47 同款范式） | 同名（或 `spec.connector` 覆写）ConnectorOps 对象：`spec.workservice=workflow-engine` + `spec.workflow=<锚名>` + `spec.ops=[flow]` + `spec.flow.nodes`（节点名/标题/unit/op/connector/provider 投影——unit 声明缺省 session，跨服务=agent 调 agent 待节点声明 `unit: agent` 表达） | apply 后 `GET /v1/objects/ConnectorOps/<名>` 200 且 flow.nodes=生效相位投影；改 spec 再 apply → 对象 rv+1（`/v1/history` diff 可查）；幂等重入=noop 零提交 |
| 实现代码（connectOps） | **apply-workflow agent**（连 developer-system 闭环，§8） | 实现仓 OpsConnector 代码+WorkService 六面体补全 | declared-deferred（需要 developer-system 拉起；运行时不做代码即兴——红线不变） |

- **所有面语义**：物化器只写 `labels[core/origin]=workflow-bind` 标注的对象（自己物化的骨架）——人/agent 已写的 ConnectorOps 实现零盲写；骨架翻转为实现=实现在该对象上继续演进（label 由实现侧改写）。
- **绑定解析**：生效对象（override 优先）`spec.connector` → 归一化（`connector-ops/<name>` 前缀剥离）；未声明=同名。解析结果入聚合面 `execution` 投影：`{state: bound|unbound, connector, connectorScope, skeleton}`——unbound=绑定名解析成功而 ConnectorOps 对象缺席（缺口可见）；skeleton=true=对象仍为物化器骨架（origin=workflow-bind），实现代码未落。
- **宿主 WorkService**：`workflow-engine`（global/workservices/，content round）——flow ConnectorOps 的实现落点声明（impl ref=workservice 仓 workflow 包，即 cored 引擎自身=骨架执行面）；真实节点内容实现=apply-workflow agent 面。
- **builtin 无文档 workflow**（core-workflow/default-task 等）：绑定=同名，无文档对象即无物化触发 → 决策面 unbound（缺口不静默——其实现=引擎内置态机，connectDef 缺席照实可见）。

### 11.2 apply-workflow agent 拉起形态（2026-11-26，R-8 轮——派单受理投影首段）

§11.1 两步之间的**接口面**：骨架（步 1）→ 实现代码（步 2）怎么交棒。首段=机械派单面：

- **触发接线**：物化器一次真实物化动作（`created|updated`——骨架新建/更新，即「该版本实现未落」的机械签名）→ 记一条对 `apply-workflow` 锚的**派单受理投影**：`GET /v1/agents/dispatches`（`{count, accepted, dropped, dispatches:[{seq, agent, status, autoLevel, action, workflow, scope, connector, rv, eventId, at}]}`）——rv=骨架落库后版本（实现侧 diff 基线）、eventId=DocApplied 回执（来源链可回指 event_log/apply_log）。`noop`（幂等重入零差异）/`skipped`（非本物化器所有面）**不派单**——无新实现可做，不制造噪音。
- **诚实投影（wake 面同构）**：**派单受理 ≠ agent 会话已拉起**——真实拉起=dsh 会话挂载（cross-agent.md §5.7 #2/#3：preset 基座+setup 注入；agent-session.md §3 子 agent 进程），declared-deferred。受理投影只证明「骨架→agent 派单接口面已接线」。
- **AUTOLEVEL=ask（§8 默认）**：投影行 `autoLevel: ask` 数据面在册（级别管"问不问"——ask 批准/拉起动作面随真实拉起段落地；准入与 AUTOLEVEL 正交，agent-session.md §2）。
- **观测面非账本**：受理投影=进程内环（有界，重启归零=幂等重入不重复派单的语义锚）；持久态=骨架对象本体（聚合面 `execution.skeleton=true`）+ apply_log 审计（fieldManager=workflow:bind）——投影丢失不致实现缺口静默。
- **余量（declared-deferred）**：会话真实拉起与 ask 批准动作面（ApprovalNeeded→人批→spawn）、watch-only 自监控闭环（§8）、developer-system 代码化调用——随 agent-session 域落地轮扩。

### 11.3 拉起投影面第二段（2026-11-26，R-9 轮——派单行携节点接线载荷 nodes）

§11.2 首段的下一步接口面：受理行从「有派单事实」升为「拉起输入面」——派单受理行（kind=workflow）新增 `nodes` 键（v0.55），载荷=骨架 `spec.flow.nodes` 节点清单投影（name/title/unit/op/connector/provider，`flowbind.NodesOf` 单点真相——聚合面 executionFlow 键消费同一投影零硬编码）。apply-workflow 真实拉起时其输入=该节点清单（每个节点=一段接线契约：unit=session 走宿主会话、unit=agent 走跨服务 agent 调用、connector/provider 落实现落点）。**红线不变**：拉起输入面在册≠已拉起——受理投影仍非会话挂载，真实执行仍 observe（红线 a）；本面只证明「骨架→agent 的交棒载荷已带接线契约」，不新增任何自动执行。

**构建生效链判别面随行（R-9 主增量——workflow 运行管理屏判别三问）**：①构建产物 digest=骨架对象落库 rv（`skeletonRv`）；②生效对象 rv=ConnectorOps 面上现值；③对账=骨架 rv ↔ 最近绑定器 apply 行 rv（apply_log fieldManager=workflow:bind 行——ok=落库后版本/noop=幂等重入照落现值）→ chain 三词 `consistent|divergent|absent`：divergent=对象在绑定器之外演进过（骨架翻转为实现后物化器零盲写，实现侧 diff 基线=lastBindRv——链分裂可见不静默）。读口=`GET /v1/workflows` 行集四键 `reconcile`/`executionFlow`/`executionDigest`/`executionHistory`（v0.55 新载荷键=代际判别器）；呈现=console workflows 屏「生效链」列+wf 详情配置 tab 生效链行+流程图 tab 骨架节点 × run 相位对账投影（节点态四词着色 ◉当前·✓已过·○未至·⤫不在序列——off-flow=对账缺口可见）。细化验收线=console-adoption.md §1.29（L57-01…11）。

### 11.4 派单第二来源：Proposal 批准派单（2026-11-26，能力 B 轮——concepts/proposal.md）

apply-workflow 锚的派单投影自 v0.51 起有**第二触发源**：Proposal（需求提案，core_design concepts/proposal.md——console 提需求→审批→派工的一等对象）对象以 `spec.status=approved` 落库 → 一条派单受理投影（同 face `GET /v1/agents/dispatches`，行 `kind=proposal`——v0.50 骨架派单行补 `kind=workflow` 投影，新载荷键=代际判别器）。与骨架派单的分工：骨架派单=「骨架→实现代码」的交棒（步 1→步 2）；Proposal 派单=「需求→执行体」的交棒（批准后 agent 产出=文档草稿（docsRoot 对象）或部署侧任务文件，落点声明=spec.landing 产物指针）。载荷带 proposal 名/目标（title/summary）/验收标准（acceptance）/priority/proposer——执行体输入随行（agent 面余量=真实拉起后消费）；审批链复用（ApprovalNeeded 提交分流自产 + ApprovalGranted/Rejected 判定事件 + approval_log 账）与状态机词汇见 proposal.md §4/§5。**红线不变**：派单受理≠拉起；Proposal 不 enable 任何 workflow、不自动执行代码。

## 12. 可行性

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 引擎代码复杂度 | ⚠️ 中 | 相位机+接线+记账 | 标准 FSM；复杂度在权限校验完备性不在相位机（concepts/workflow.md §7） |
| 编辑器表单覆盖不全 | ⚠️ 低 | spec 字段多 | 表单+YAML 双模式（表单覆盖常用字段，全量走 YAML 编辑） |
| 导入渲染失真 | ⚠️ 中 | 外部编排语义≠声明式相位 | 导入预览=dry-run 展示渲染结果；导入件标 origin=import，首期观察模式（mode: observe）跑一段时间再放开 act |
| 第三方编辑权限面 | ⚠️ 中 | 谁能改谁系统的 workflow | scope 写权限+权限系统裁剪（P7）；builtin workflow 修改=高敏项 |
| apply-workflow 自举深度 | ⚠️ 有条件 | 落地 agent 也要能跑 | 它自身跑在 builtin default-task 上；首版只支持"注册现有 connector + 生成 watch 接线"，代码生成走 developer-system 人工确认；**拉起形态首段（§11.2）=派单受理投影先行**——接口面机械可验，会话拉起 deferred |
| 展示数据双源 | ✅ 低 | — | 全部来自 Scheme+ops DB（console-ui.md 硬性约定） |
