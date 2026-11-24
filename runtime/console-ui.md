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

四 tab：**流程图**（相位态机自动渲染，当前相位高亮）/ **事件**（该 workflow 触发与消费的事件流）/ **流转**（每轮相位流水：相位进出时间/动作/actionLog/失败原因，轮次可回放）/ **数据流**（spec.dataflow 拼图：输入事件源→处理→产物去向，节点全可点）。操作条：启用/停用、编辑（表单+YAML）、克隆、导入——全部=Apply。

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

- ApprovalNeeded 列表（role 挂载命中的待审项）→ console 内批准/驳回（=Apply）。
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

# 运行时设计 3.5：console v2 Web 界面（proto 定稿）

> 结论先行：v2 形态=**Web 交互原型**（纯前端 mock，不带后端），落在 dsh-core-agent 仓 `console-proto/`；本章定义其信息架构与交互规范。**proto 只定交互契约（路由+屏结构+数据来源），实现以本章为准。**既有三层视角（第一层资源树/第二层信息流/服务关注区）全部继承为 v2 屏幕，不另起炉灶；「界面上出现的任何资源标识符都必须可点」继续作为硬性验收。

## 风格与模块基准

**结论：v2 不发明界面语言——console 本身就是 dsh web client 的一个 plugin，功能展示模块与 DeepSeek Harness 对齐，视觉=深色紧凑 harness 风。**

| dsh harness 模块 | v2 对应 | 定稿 |
|---|---|---|
| Conversation shell | Agent 对话 / Session 详情 | **Chat/Trajectory 双视图** + **Turn Tail**（每轮尾部状态条）+ 工具调用卡（=ConnectorOps 调用卡）+ 改动文件卡片（=文档修改提案卡）+ 诊断 view（错误/告警聚合区） |
| Workspace Session 侧栏 | 会话页左栏 | 置顶 / 归档 / 搜索 / 行菜单（ArchivedFilter 同款：归档默认隐藏，行菜单恢复） |
| Jobs 面板模式 | Workflow 运行管理 | 运行列表+详情面板双栏，**follow 语义**：运行中轮次流式追加，终态封板 |
| 快捷键注册表+速查表 | 全站 | `?` 唤起速查表；**共用模态裁决顶层 Esc**；⌘K 命令面板注册进同一 registry |
| settings-card 风格 | 设置面板 | 卡片式分区（外观/通知/终端偏好），不散落各页 |
| Slots 扩展位 | 全站 | **每一屏=注册进 slot 的功能包**：新屏=新 slot entry，壳不动 |

依据：dsh 包内 docs/subsystems/web-client.zh.md 等（npm @deepseek-ai/dsh 0.2.2-rc.5，已解包只读参考）。

## 全局框架

| 区 | 定稿 | 规则 |
|---|---|---|
| 左侧固定侧栏 | **Welcome / 总览** / 系统树 / Workflows / 文档 / 事件 / 审批 / 连接 / 会话 | 审批项带**角标**（待审数实时来自 ops DB）；当前项高亮 |
| 顶栏 | 面包屑全程可点 + **⌘K 命令面板** | ⌘K 模糊搜 services/workflows/docs/agents/runs，附快捷动作（新建会话/去审批/Apply 当前草稿） |
| 路由 | hash 路由 | **刷新可恢复**，深链可直发他人（路由即状态） |

## 屏幕 0：Welcome 大屏（默认落地页）

**Welcome=使用者视角大屏，服务关注区（屏幕 1）=运营视角工作区，二者并存——侧栏 Welcome 第一项、总览第二项。**

```
┌ 业务健康度大数字：InSync 率 83% | drift 2 | 审批积压 4 | 24h 失败率 9% ─┐
│   （hover tooltip 给构成：各系统贡献分解，大数字不许是无出处黑盒）        │
├ dev-delivery 流转横向阶段条 ──────────────────────────────────────────┤
│ 触发●→ Analyze●→ Gate●→ Execute◐ 12m → Verify○ → Deploy○ → Report○     │
│   （每段=最近一轮状态+耗时；点击跳 #/wf/dev-delivery 对应 tab）          │
├ Service 简卡行（一行一系统：名称+相位灯+负责 agent，点入=系统详情）───────┤
├ 最近重要事件（业务健康度与使用者视角，critical/high/info 分级）──────────┤
│   「developer-system 门禁连续 3 轮失败」  critical  12m 前  → run       │
│   「deploy-system prod 发布等待批准」      high     1h 前   → 审批      │
│   （业务化标题而非事件类型堆砌；点入=事件详情/相关对象链）                │
├ 快捷入口：[新建 Goal] [与 root 对话] [手动触发 workflow] ───────────────┤
└──────────────────────────────────────────────────────────────────────┘
```

- 健康度合成：InSync 率=observedGeneration 追平的系统占比；失败率=24h run 终态 Failed 占比；分级沿用事件 severity。
- 数据来源：健康度与阶段条=ops DB 预聚合+run 流水；重要事件=event_log（severity+业务影响排序，业务化标题=展示层生成、不入库为准——规则是数据，解释按需生成）。

## 屏幕 1：总览（服务关注区 v2）

**一屏回答"六个系统现在好不好、谁在跑、什么等我批"。**

```
┌ 全局聚合条：systems 6 | 运行中 3 | driftOpen 2 | 待审批 4 | 24h 运行 49 / 成功率 91% ┐
├ 六系统卡片（每系统一张，点入=系统详情）───────────────────────────────┤
│ core_system      ● InSync   gen 12/12  24h 37 轮  drift 0  待审 1  agent: dsh-core │
│ developer-system ◐ Degraded gen  8/9   24h 12 轮  drift 2  待审 0  agent: dev-1    │
├ 进行中运行：跨系统 run 列表（点入=workflow 运行抽屉）─────────────────┤
├ 最近事件：全局时间线（点入=事件流页按该对象预过滤）───────────────────┤
└─────────────────────────────────────────────────────────────────────┘
```

- 卡片字段=相位灯 / observedGeneration（gen X/Y）/ 24h 运行次数 / drift 计数 / 待审批数 / 负责 agent，全部可点、跳对应过滤视图。
- 数据来源：卡片静态区=Scheme 注册表+Status；运行次数与成功率=ops DB 预聚合表（见可行性）；进行中运行与最近事件=ops DB（run 流水 / event_log）。

## 屏幕 2：系统树（根→Service 系统）

**第一层树的全屏化 + docs 升格为一等子树——"文档也是同样的规则"落进 UI。**

- 展开次序不变：Global → ServiceDesc →（instances → Agent / impl docs / status）→ workflows → workservices → **docs** 全展开。
- **文档节点与资源节点完全同构渲染**，四件套视觉词汇共用：kind 徽章 / revision（rev N）/ 草稿圆点（有未 Apply 草稿）/ 状态灯。一份 ImplDoc 与一个 WorkService 在树上不可凭外观区分，只能靠 kind 徽章——文档与资源是同一套对象规则的两个实例。
- 树上过滤框：按 kind/name/tag 即时过滤子树（前端过滤，数据已全量在册）。
- 数据来源：树结构=Scheme 注册表+目录即对象（layout.md）；草稿圆点=草稿缓存查询；状态灯=Status/conditions。

## 屏幕 3：系统详情（六 tab）

| tab | 内容 |
|---|---|
| 文档 | 该 scope 全部对象（Goal/Rule/ImplDoc/VerifyDoc/…），点入=文档编辑器 |
| 资源 | 引用的 WorkService/ConnectorOps/Ref/Provider（并集视图） |
| 状态 | Status/conditions/drift + 最近 DriftReport |
| Agent | 负责 agent 的 phase/当前 session/子 agent 树/最近 SessionLog |
| 跨系统申请 | Ref 解析与跨系统提案（A46）的进出流水 |
| 事件 | 该 scope 事件时间线（=事件流页按 scope 预过滤） |

- **每 tab 右上常驻「与该系统 Agent 对话」入口**（沿服务关注区既有设计）：`ctx.agents.create + followup`，跳 `#/chat/:agent` 并预置该系统 catalog。
- 数据来源：各 tab 全部 Scheme+ops DB 同源，无独立前端状态。

## 屏幕 3a：Service 场景面（tab 展开的完整视图）

**系统详情六 tab 保留概览密度；每个 tab 右上「展开完整视图」进入专属场景面页（过滤器与全局事件页同款）。**

| 场景面 | 路由 | 内容 |
|---|---|---|
| events | `#/s/:name/events` | 类型/级别/时间窗/对象四维过滤，三泳道混排（=屏幕 9 过滤条按 scope 预置） |
| metrics | `#/s/:name/metrics` | 查询声明清单+曲线+阈值线+越线事件标注（数据本体 TSDB，页面只持声明与查询结果） |
| docs | `#/s/:name/docs` | **tag 过滤为核心**：metadata.tags 多选 chips，与 kind / 草稿圆点 / 全文搜索组合过滤；结果=同构文档卡（rev/状态灯可点） |
| permissions | `#/s/:name/permissions` | 权限矩阵：行=agent/role，列=ConnectorOps/Ref/Provider/写路径；格=授权来源（哪条挂载/哪条 rule），全可点溯源 |

- 数据来源：全部 Scheme+ops DB；metrics 曲线=TSDB 即席查询（不入库，与 ops-log.md 同规则）。

## 屏幕 4：ServiceInstance 详情

**instance 页 = 相位 + 三组文档 + 指标声明 + 两个动作（对话为主，终端为次）。**

- 顶部：相位 chip（phase+reason）、generation/observedGeneration、负责 agent（可点）。
- 主体：impl docs / verify docs / drift reports 三组文档卡，rev 可点=编辑器历史视图。
- metrics 查询声明：观测面声明的 query 清单+最近采样摘要；数据本体在 TSDB，不入 console（ops-log.md 同规则）。
- **主 CTA「在对话框调用该 Agent」**（跳 `#/chat/:agent`，预置该 instance catalog）；次按钮「终端(gotty)」（经 gotty ConnectorOps 开网页终端，见下节）。
- 数据来源：Status=instance.yaml 汇聚区；文档卡=目录即对象+revision。

## 屏幕 5：Workflow 运行管理

**workflow 页从"配置查看"升级为"运行观测"——默认 tab 是运行，不是流程图。**

列表列：名称 / scope / enabled / **运行次数（总/24h）/ 成功率（24h）** / 当前相位 / 涉及文档。

详情 tab：

| tab | 内容 |
|---|---|
| **运行（默认）** | 轮次表（run id/触发源/开始/耗时/终态）→ 点开**运行抽屉**：相位时间线 / action log / 涉及文档（可点=编辑器）/ SessionLog 全文；抽屉内重跑/取消=Apply |
| 流程图 | 相位态机自动渲染，当前相位高亮（沿既有四 tab） |
| 事件 | 该 workflow 触发与消费的事件流 |
| 流转 | 每轮相位流水聚合（相位进出时间/动作/失败原因，跨轮对比） |
| 数据流 | spec.dataflow 拼图，节点全可点 |
| 配置 | spec 表单+YAML 双视图，保存=Apply（dry-run 预览前置） |

操作条：启停/编辑/克隆/导入 全部=Apply（沿既有）。运行次数/成功率=ops DB 预聚合（run 流水按 workflow×天分桶）；轮次/action log=ops DB；流程图/数据流=spec 声明渲染。

## 屏幕 6：文档编辑器（全站核心）

**编辑器是 Apply 语义的 UI 化——LLM 止步于提案，人独占发布。**

布局：中央编辑器 + 右侧协作面板四 tab。

| tab | 内容 |
|---|---|
| LLM | 提案流：LLM 只产**草稿提案**——split diff 卡片，每张 [加入草稿]/[丢弃]；**机制上 LLM 无 Apply 权**，Apply 按钮不在它的通路上 |
| 草稿 | 当前草稿累积 diff（手动编辑+已采纳提案同一通道）；**吸底大按钮「Apply（N 处变更）」** |
| 历史 | Revision 流水（git log+ops DB apply_log 双轨），任一 rev 可开只读视图 |
| 元数据 | scope/kind/labels/ownerRefs/refs/fieldManager 历史 |

Apply 流（确认弹窗）：

```
点「Apply（N 处变更）」→ 弹窗：完整 diff + dry-run 三项检查
  ├ scheme 校验   DocType/必填字段/枚举合法
  ├ 权限准入     当前操作者 fieldManager 有该文档写权
  └ 乐观锁       resourceVersion 与当前 rev 一致（冲突=提示重读）
→ 人确认 → 落库 Revision+1 → 必发 DocApplied 事件 → 草稿清空
```

- 手动编辑与 LLM 提案走**同一草稿通道**：编辑器直接改=写草稿（不触文档面、不发事件）；空草稿点 Apply=无操作（提示，不落库不发事件）——完全对齐 concepts/apply.md 的编辑与发布分离。
- 数据来源：文档体=git 文档面；草稿=草稿缓存；提案卡=Agent 会话产物（会话页提案卡深链至此，已在 LLM tab 排队等人裁）；历史=git+ops DB。

## 屏幕 7：Agent 对话

**会话页是直控面的投影——session/线程/权限面三栏；运行器四选只是入口，权威选型在挂载 yaml。**

布局：左 session 列表 + 中线程 + 右权限面。

- 新建会话**运行器四选**：内嵌 dsh（默认）/ opencode cli / claude-code / 终端（选终端会话页带终端 tab）。选型的权威记录在 ConnectorOps 挂载 yaml（下节），页面仅是选择入口。**落地映射（dsh 0.2.2-rc.5 实测，证据见 cross-agent.md §5.7）**：内嵌 dsh=`subagent-dsh-sdk` provider（现成）；claude-code=`subagent-claude-code` provider（现成）；opencode/gotty=自写 SubagentProvider（`registerProvider`）跑 TUI，承载面用 dsh 内置 web 终端（`remote.terminal.*`，真 PTY、按 SessionId 寻址、沙箱随 session、与终端同生命周期）；gotty 仅用于跨机 ServiceInstance 的独立终端链接（piko 暴露），不再作为 console 默认终端面。
- 线程内三类卡片：

| 卡片 | 内容 | 交互 |
|---|---|---|
| ConnectorOps 调用卡 | op 名/参数摘要/结果摘要/耗时 | 点开=完整调用+ops 日志锚点 |
| 文档修改提案卡 | mini diff+目标文档路径 | 深链进编辑器 LLM tab（等人裁） |
| 审批请求卡 | 请求摘要+权限依据 | [去审批]跳审批页对应项 |

- 右栏权限面：该 agent 挂载的 ConnectorOps/Ref/Provider/Role **并集**物化视图，随 Agent spec Apply 即时刷新。
- 数据来源：session=ctx.agents.list()+dsh-session 记录；线程与会话流=SessionLog 同源；权限面=Agent spec 并集索引。

## 屏幕 8：连接页

**连接层三组一屏；agent-comm 作为普通 ConnectorOps 获得详情页——跨 agent 协议在这里可见可审计。**

- 三组并列：WorkServices（六面体完成度/Reachable 灯/引用计数）/ ConnectorOps（workservice/ops 子集/workflow 绑定/挂载点）/ Providers（类型/账号掩码/引用）。
- **agent-comm 详情**（ConnectorOps 之一，跨 Agent 协议 v0.1 挂载面，见 cross-agent.md §5）：
  - op 面：dispatch/query/interrupt/inbox 四原语实时计数与最近调用；
  - 拓扑图：当前注册 agent 的 from→to 消息拓扑（节点=agent ref，边=近期消息，全可点）；
  - 消息日志：envelope 流水，列含 **token scope**（权限子集摘要），点开=完整 envelope；
  - envelope 表：v0.1 字段说明（随协议演进）。
- 数据来源：三组=Scheme 注册表；agent-comm 流水=ops DB `control_log`（primitive 列即四原语，envelope id/token scope 随行入列）。

## 屏幕 9：事件流（第二层 v2）

**第二层的 Web 呈现，规则一字不改。**

- 过滤条（对象/Kind/scope/level/时间窗）+ 三泳道（Event 流/状态变迁/数据事件，可混排）+ 右聚合面板（driftOpen/审批积压/死信率/Workflow 成功率/预算消耗）。
- 两层互通不变：资源页看"它的事件流"；本页点任一条跳"相关对象"。
- 数据来源：event_log+Status 变迁流水（ops DB）；聚合面板=预聚合表。

## 屏幕 10：审批

**审批=diff 预览+一次点击；批量只限同 rule 低危组。**

- 列表=挂载 role 命中的 ApprovalNeeded 待审项；详情=**完整 diff 预览（不可折叠跳过）**+ 批准/驳回（均=Apply，approval_log 留痕）。
- 批量：同 rule 同组的低危项可批量批；高危档（undo:none / 权限系统高危拦截）单条必审。
- 数据来源：待审区=草稿缓存+ApprovalNeeded 事件；判定记录=approval_log（v0.46 独立账落地）。
- **已决账面区块（v0.46）**：屏尾增「已决账面」行表=`GET /v1/approvals` 现读不缓存（decision chip granted/rejected+obj+judged_by+rv+时刻；批准/驳回即决即见）——判定不再只留 apply_log 字符串考古，驳回（弃稿零文档面动作）亦有行在册；读面缺席=区块诚实降级注记（零 console error）。

## 详情页矩阵（全对象互跳）

**硬性验收升级：详情页之间任意互跳（如 event→run→workflow→doc 编辑器），页面上出现的任何标识符必须可点——跳不过去即 UI drift。**

| 对象 | 路由 | 详情页必备区块 |
|---|---|---|
| Agent | `#/agent/:name` | 权限面（并集物化）/ sessions 列表 / 最近任务 / 父子 agent 树 / owner instance |
| Session | `#/session/:id` | trajectory 视图（Chat 可切）/ token 用量 / SessionLog 全文 / 关联 run |
| WorkService | `#/ws/:name` | 六面体清单（哪几面非空）/ op 集 / 被挂载关系（哪些 ConnectorOps 引用）/ 健康（Reachable/版本） |
| Provider | `#/provider/:name` | 类型 / 凭据脱敏（掩码）/ 引用清单 |
| Ref | `#/ref/:name` | 解析目标 + 反向引用（谁在引用） |
| Role | `#/role/:name` | 权限矩阵 / 挂载者（agent+人） |
| Event | `#/event/:id` | 事件信封全文 / 相关对象链（owner/involved 全可点） |
| Run | `#/wf/:name/r/:n` | 运行抽屉全量（相位时间线/action log/SessionLog）——屏幕 5 运行抽屉的独立路由形态 |
| ServiceDesc / ServiceInstance / Workflow / Doc / ConnectorOps | `#/s/:name` / `#/s/:name/i/:inst` / `#/wf/:name` / `#/doc/*` / `#/connectors` | 见屏幕 3 / 4 / 5 / 6 / 8 |

数据来源：全部 Scheme+ops DB 同源；矩阵每行都是屏幕 0-10 里可点标识符的落点，反向上屏即互跳网。

## 运行器与终端接入（gotty）

**网页终端不是特殊通道，是一次普通 ConnectorOps 挂载；runner 选型记录在挂载 yaml，会话页只是入口。**

- ConnectorOps/Connector 支持四种运行器：内嵌另一个 dsh / opencode cli / claude-code / 终端——与"子 agent 运行时不限于 dsh"（A60）同一判断，运行器=子 agent 运行时选型在会话场景的投影。**终端承载面（0.2.2-rc.5 实测裁决，cross-agent.md §5.7#6）：console 默认终端=dsh 内置 PTY（remote.terminal.*，与会话同生命周期同鉴权）；gotty 只作跨机 ServiceInstance 或需独立分享终端时的暴露通道（piko），不再作默认。**

```yaml
apiVersion: core/v1
kind: ConnectorOps
metadata:
 name: gotty-web
 scope: builtin-developer-system
spec:
 workservice: gotty-web # tool 型 WorkService（category: tool）：网页终端
 workflow: default-task
 config:
   endpointRef: ref/gotty-endpoint # 终端服务地址（Ref 解析）
   runner: opencode-cli # 运行器选型记录在此：dsh | opencode-cli | claude-code | terminal
 auth: {provider: provider/gotty-robot} # 凭据链走 Provider，明文不进前端
 ops: [open-session, list-sessions, close-session]
```

- 安全链：凭据=Provider 账号（前端永不接触明文）；终端内容不落 ops 日志正文（量级不允许），但**开启/关闭事件+会话 id+发起人**必落 ops 日志——审计回答"谁在何时开了哪台终端"。

## 性能与懒加载

**事件/流转是无限增长面，一次性渲染必死——懒加载是终态规则，不是优化项。**

| 规则 | 适用 | 定稿 |
|---|---|---|
| 虚拟滚动 | 事件泳道（≥千级）/ 流转轮次（≥百级） | 常量行高虚拟列表，DOM 只保留视口 |
| 分页 chunk | Session 历史 / action log / agent-comm 消息日志 | 按 **follow/page 语义**分页拉取（对齐 dsh Client 的 page()：首帧 tail page+cursor，历史向旧翻页） |
| 树懒展开 | 系统树 | 子层按需加载+loading 态；展开过的层缓存 |
| 路由级 lazy | 全站 | 按 hash 按需渲染功能包（slot entry 惰性 materialize），启动不渲染全部屏 |

数据通路：全部走 **baseline+increment**（对齐 dsh Client model——每域首帧完整 baseline，随后 upsert/remove 增量；重连=新 baseline 原子替换），前端不做轮询全量刷新。

## 可行性

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 前端双源漂移 | ❗高 | Web 原型最易自建状态、与 Core 真相分叉 | 硬性约定：渲染数据必须全部来自 Scheme+ops DB（无独立前端状态）；mock 用固定 fixture 模拟本章各屏"数据来源"行声明的同一批查询接口 |
| LLM 误 Apply | ❗高（机制兜底） | 提案/编辑产物被直接落库 | 机制上 LLM 无 Apply 权：Apply 唯一入口=草稿 tab 吸底按钮，人点为准；LLM 提案止步"加入草稿" |
| gotty 会话安全 | ⚠️ 中 | 网页终端=直通 shell | 凭据链走 Provider 不进前端；开启/关闭+发起人必落 ops 日志；undo:none 类 op 每次人审（既有规则不变） |
| 运行次数/成功率聚合的查询成本 | ⚠️ 中 | 总览/列表每卡片都要 24h 聚合 | ops DB 预聚合（run 流水按 workflow×天分桶，卡片读桶不扫流水）；SQLite 量级足够 |
| 原型与实现漂移 | ⚠️ 中 | proto 好看、实现走样 | proto 只定交互契约（路由+屏结构+数据来源），实现以本章为准；「标识符全可点」自检进 CI |
| dsh client API 处于 rc 期 | ⚠️ 中 | harness 模块/组件 API 随 rc 变动（0.2.2-rc.5） | 模块对齐只锁「交互模式与信息结构」，不锁具体组件 API（沿 cross-agent.md 同款缓解：只在插件层薄封装） |

**结论：可行。v2 全部新面（命令面板/文档编辑器/会话/连接页）都是既有机制（Scheme+ops DB+草稿+Apply+ConnectorOps）的渲染层投影，无新增后端概念；最大的坑（前端自建状态）用逐屏"数据来源"行钉死。**

## proto 对应关系（屏幕 ↔ console-proto/ hash 路由）

| # | 屏幕/页 | hash 路由 | 备注 |
|---|---|---|---|
| 0 | Welcome 大屏 | `#/welcome` | 默认落地页，侧栏第一项 |
| 1 | 总览 | `#/overview` | 侧栏第二项 |
| 2 | 系统树 | `#/tree` | |
| 3 | 系统详情 | `#/s/:name` | 六 tab；tab「展开完整视图」→ 场景面 |
| 3a | Service 场景面 | `#/s/:name/events` `#/s/:name/metrics` `#/s/:name/docs` `#/s/:name/permissions` | docs=tag chips 过滤为核心 |
| 4 | ServiceInstance 详情 | `#/s/:name/i/:inst` | |
| 5 | Workflow 运行管理 | `#/workflows` / `#/wf/:name` / `#/wf/:name/r/:n` | 详情默认 tab=运行；run 独立路由 |
| 6 | 文档编辑器 | `#/doc/*` | `*`=文档路径，`?rev=` 开历史视图；侧栏「文档」=同前缀列表视图 |
| 7 | Agent 对话 | `#/chat/:agent` | 侧栏「会话」 |
| 7a | Session 详情 | `#/session/:id` | trajectory+token 用量 |
| 8 | 连接页 | `#/connectors` | agent-comm 详情=`#/connectors?ops=agent-comm` |
| 8a | 连接层详情 | `#/ws/:name` `#/provider/:name` `#/ref/:name` `#/role/:name` | WorkService/Provider/Ref/Role |
| 9 | 事件流 | `#/events` | `?obj=` 预过滤 |
| 10 | 审批 | `#/approvals` | 侧栏角标 |
| 11 | Agent 详情 | `#/agent/:name` | |
| 12 | Event 详情 | `#/event/:id` | 相关对象链全可点 |

## 11. 视觉与信息架构整改清单（2026-11-24 用户裁决；AI 实现并自验生效）

> 背景：现 console 可用但"丑"——三栏挤压、两套视觉语言、信息层级平铺（用户原话）。本节是**可机读的整改需求**，由 loop AI 自行实现并以截图+DOM 断言自验；与 §3.5/§1.23 的验收线叠加生效。

### A. 信息架构

| # | 需求 | 判据 |
|---|---|---|
| A1 | Welcome 与「总览」合并为一项（Welcome=总览首屏），侧栏项收敛 | 侧栏项数下降且无重复语义 |
| A2 | Workspace 会话列表与「会话」屏去重（同一数据只一处主入口，另一处深链） | 无重复列表 |
| A3 | 默认落地页=总览（Welcome），审批 badge 常驻可见 | 首屏含审批入口 |

### B. 视觉体系

| # | 需求 | 判据 |
|---|---|---|
| B1 | 字号阶梯统一 11/13/15/20/28 | 抽查 DOM font-size ∈ 阶梯 |
| B2 | 间距 4 基数（4/8/12/16/24），卡片内边距 16 | 抽查 padding/margin |
| B3 | 语义色四类（success/warn/danger/neutral），深色对比度 ≥4.5:1 | 抽查颜色 token |
| B4 | 图标统一 16px 线性、同 stroke | 抽查 svg 尺寸 |
| B5 | 卡片统一（圆角 10/边框 1px neutral-800/内边距 16） | 抽查样式 |
| B6 | 按钮三级（primary/secondary/ghost），每屏主 CTA 唯一 | 主按钮计数=1 |
| B7 | 中英混排统一字体栈，数字 tabular-nums，中英间距 0.25em | 抽查样式 |
| B8 | 正文最大行宽约 72ch；长说明用抽屉/展开，禁止 tooltip 压内容 | 无遮挡内容 |

### C. 数据呈现

| # | 需求 | 判据 |
|---|---|---|
| C1 | 顶部指标三卡：InSync 系统数 / 待审批 / 24h 失败率，基线对齐 | 三卡同高同基线 |
| C2 | 空态规范：无 run/无实例/无事件各有一句原因 + 下一步 CTA | 空态文案存在 |
| C3 | 无实例不得画满格绿条（改中性「不适用/待接入」） | 无 0 实例绿满格 |
| C4 | 阶段条仅在有 run 时显示；字母（触/A/G/P）改图标+中文全称 | 无 run 时无灰点排 |
| C5 | 事件列表两行制（标题+对象链），右截断统一；筛选 chip 带计数 | 列表无裁切 |
| C6 | 时间显示相对（x 分钟前）+ hover 绝对时间；标注时区 | 抽查 |
| C7 | 数字格式统一（千分位/百分比一位小数） | 抽查 |

### D. 交互

| # | 需求 | 判据 |
|---|---|---|
| D1 | 搜索占位符统一中文；快捷键提示必须真实可用（不可用则去掉） | 抽查行为 |
| D2 | 连接/健康状态收敛到 header 右侧；去掉浮动 connected 徽标 | 无浮动徽标 |
| D3 | 任何资源标识符可点（既有硬线）+ 面包屑返回 | 抽查互跳 |
| D4 | 键盘可达：焦点环可见、icon 按钮有 aria-label | a11y 抽查 |
| D5 | 窄屏（<1200px）把导航收起为抽屉，内容区不受挤压 | 响应式截图 |
| D6 | 刷新指示（轮询中/最后更新时刻） | 抽查 |

### E. 锁定与 fork 兜底（用户 2026-11-24）

| # | 需求 | 判据 |
|---|---|---|
| E1 | **锁定模式**：只保留需求内入口——经 profile patch 按行 id 禁用（如 `plugin-manager`/`workspace-controller`/`schedule`/`plugin-inventory`），禁用项 UI 不渲染、对应 API 拒绝 | 侧栏无"添加插件/新建 Workspace/新建自动化任务"入口；API 调用 403/404 |
| E2 | CLI 侧锁定：profile 目录 root 属主/只读，普通用户不能 `dsh plugin add` | 非 root 执行被拒 |
| E3 | fork 兜底：需要"改行为"而非"隐藏入口"时 fork dsh（MIT，repo=deepseek-ai/deepseek-harness，默认分支 master），补丁面最小化+定期同步上游；详见 runtime/dsh-fork.md | fork 触发条件满足才动 |

## 12. 需求提案对话式录入（Proposal Chat，2026-11-24 用户裁决）

> 用户裁决：现有表单「跟傻子一样」——改成对话录入。**通用规则见 core_design/rule.md R-UX-1（所有与人交互默认对话）**；本节是其在提案录入面的落地形态。

### 交互

```
[需求提案] 屏默认进入对话模式
 ┌ 对话区（左 2/3）                     ┌ 字段卡（右 1/3，实时）
 │ assistant：想做哪个系统/什么能力？      │ 标题      ● 已填
 │ user：……                              │ 目标      ● 已填
 │ assistant：验收怎么判断？给 2-3 条…    │ 验收标准  ○ 待补（2/3）
 │ …（逐字段询问，默认值+示例）           │ 影响面    ○ 待补
 │                                        │ 优先级    ◐ 默认 low（可改）
 │ [生成提案预览]（字段齐后出现）          │ 产物落点  ◐ 默认 doc
 └──────────────────────────────────────┘ └──────────────────────────
预览：Proposal YAML（LLM 生成）+ dry-run 结果（R-PUB/spec 准入）
      [返回修改] [确认提交（草稿→Apply）]
```

### 规则

1. **默认对话**：进入提案屏即对话；「直接填表」作为显式降级入口（LLM 不可用自动降级并可提示）；
2. **缺少询问**（R-UX-1 第 3 条）：只问 spec 中不明确/缺失/冲突的字段（标题/目标/验收标准/影响面/优先级/产物落点/提出人），每次带默认值与示例；能推断的自动补充（见 R-UX-1 第 1/2 条：自由描述+自动上下文、自动补充）；
3. **自由输入 + 字段卡**：用户可一段话描述，agent 抽取字段并回填；字段卡可手改（双向同步对话）；
4. **生成与确认**：字段齐→LLM 生成 Proposal 对象（rv=0）→ dry-run（R-PUB lint + spec 准入 + 权限预览）→ 用户确认→ Apply（status=submitted；高危→ApprovalNeeded）；
5. **自动补全**：确认后由系统补缺省字段（proposer=当前主体、status、timestamps），不得手填敏感项（secret 只引用式）；
6. **可审计**：对话转对象的过程留痕（谁/什么会话/生成版本），对象入库后才算数；对话原文不入公共库。

### 判据（机读）

- 从零到可提交：≤6 轮对话完成字段齐全（判据=字段卡全绿）；
- 生成对象过 spec 准入 + R-PUB lint；dry-run 失败时定位到字段；
- 确认后 Proposal rv=1、status=submitted；高危提案产 ApprovalNeeded；
- 「直接填表」路径仍可用（回归不掉）；UI 截图（对话态/预览态）入报告。

