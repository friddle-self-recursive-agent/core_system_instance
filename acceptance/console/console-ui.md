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
  → followup 开聊；session 列表可见、可续聊（机制见 ../../runtime/cross-agent.md）
```

**实现判断（R2.3 的"能不能用插件做"）**：能——服务关注区是渲染层聚合（数据全部来自 Core 的 Scheme 索引 + Status），对话入口走 dsh-agent 的 `ctx.agents` 原生父子机制（cross-agent.md §3）。**不需要 fork dsh**；fork 仅当 dsh 宿主本身挡死定制时启动（当前无此情况）。

与既有两层的关系：服务关注区是入口，点入 service 详情后左栏仍是资源视角（第一层）的数据，事件 tab 即信息流（第二层）按 scope 过滤的视图——三个视角同源不同切面，无双源问题。

MVP 落点：mvp/console 只实现服务关注区的单 service 行 + /api/status（多 service 聚合与对话入口随 console 正式版）。

# 运行时设计 3.5：console v2 Web 界面（proto 定稿）

> 结论先行：v2 形态=**Web 交互原型**（纯前端 mock，不带后端），落在 dsh-core-agent 仓 `console-proto/`；本章定义其信息架构与交互规范。**proto 只定交互契约（路由+屏结构+数据来源），实现以本章为准。**既有三层视角（第一层资源树/第二层信息流/服务关注区）全部继承为 v2 屏幕，不另起炉灶；「界面上出现的任何资源标识符都必须可点」继续作为硬性验收。
>
> **形态更新（2026-11-26，§14）**：首屏改为**关注报告×对话**，对象详情统一为**工作台**；屏幕 0/1/5/7 的旧形态降为数据口径与钻取细则，以 §14 为准。

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

> **形态更新（§14）**：Welcome 不再是指标大屏——默认落地=关注报告（报告+常驻对话）。本屏的健康度合成、阶段条、事件分级保留为报告的数据来源与钻取口径，不再作为首屏形态。

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

> **形态更新（§14）**：服务关注区作为报告「状态」块的钻取面保留；首屏不再以卡片矩阵/聚合数字为主。

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

> **形态更新（§14.6）**：默认 tab=报告（发生了什么/值得关注/下一步）+常驻对话；运行/流程图/事件/流转/数据流/配置退为次级 tab。

**workflow 页从"配置查看"升级为"运行观测"：主视图回答"这轮为什么失败/卡在哪/下一步"，不是流程图或配置表。**

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
| 历史 | Revision 流水（ops DB apply_log 账本 + 默认 sqlite 后端下 rev-content 503：正文 diff 标注「逐次正文历史待补」，只显示账本行；**不得用周期 git 快照冒充逐次历史**）；git 兼容后端仍可 git log+rev-content 双轨 |
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

> **形态更新（§14.4）**：会话的主入口=报告页/工作台的常驻栏；本屏保留为独立会话页与会话管理面（列表/归档/搜索）。

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
- **ctx 面板（2026-11-26 用户裁决；context.md 规则 10）**：会话页可查看本会话的 **ctx（ContextPack）全文**——tagSig（按 tagType 归组的 tag 集，装配面受限：每 tagType≤5/总计≤20）、chunks 清单（每条 `ref`=<repo>/<path>#<anchor> + `hash`=commit/blob sha，可展开回原文）、tokens/预算、来源（侦察会话新建 or 缓存复用+相似度）、命中统计；面板内可**设置缓存实效**（手动失效该 pack、调整 TTL）并可见 stale 提示（文档更新→index 重算后受影响的缓存条目）。数据=ops DB `ctx_cache` 表（context-rag.md §6），失效/改 TTL 走写面门控（admin 或会话属主）。
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
| 0 | 关注报告主界面 | `#/report` | 默认落地页，侧栏第一项；`#/welcome`/`#/overview` 重定向至此（§14） |
| 1 | 总览（服务关注区） | `#/overview` | 重定向 `#/report`；其状态卡作为报告「状态」块钻取面 |
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
| 13 | 关注报告（对象锚定） | `#/report?scope=workflow:<name>` | workflow/service 页报告 tab 的深链形态（§14.6） |
| 14 | 对象工作台 | `#/obj/:kind/:scope/:name` | 统一六片+对话；旧 `#/doc/*`、`#/event/:id`、`#/wf/:name` 为别名（§14.5） |

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
| E3 | fork 兜底：需要"改行为"而非"隐藏入口"时 fork dsh（MIT，repo=deepseek-ai/deepseek-harness，默认分支 master），补丁面最小化+定期同步上游；详见 ../../runtime/dsh-fork.md | fork 触发条件满足才动 |

> **2026-11-26 更新**：A1/A3 的落地页结论由 §14 取代（首屏=关注报告×对话，`#/welcome`/`#/overview` 重定向 `#/report`）；其余条仍生效。

## 12. 需求提案对话式录入（Proposal Chat，2026-11-24 用户裁决）

> 用户裁决：现有表单「跟傻子一样」——改成对话录入。**通用规则见 core_design/core_design rule/rule_ux.md R-UX-1（所有与人交互默认对话）**；本节是其在提案录入面的落地形态。

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

**提案×上下文对照卡（2026-11-26 用户裁决；proposal.md §4.6）**：提交节点跑 `context.pack`（四族 tag 检索）后在对话区以**独立卡片明确展示**：

| 卡片 | 内容 | 交互 |
|---|---|---|
| 冲突卡（conflicts） | 逐条列出与现有文档冲突的结论：`ref`（<repo>/<path>#<anchor>）+ `hash` + why | 点开=展开原文片段核对；用户可回对话改提案或标注"已知取舍"（进 approval_log） |
| 补充卡（supplements） | 需要补充/更新的现有文档清单（ref+hash+why） | 一键加入提案 supplements 随行；派工后作为 docsUpdate 的起点清单 |

- 对照失败降级 `degraded:true` 卡片可见（不阻断提交、不静默）；同 tagSig 0.9 复用缓存不重复装配；
- 审批屏（人审）与自动批准判定同屏携带该对照；**派工载荷带 docsUpdate 义务（缺省 true）**——执行体按 supplements 清单随行更新受影响文档，不回写不得 landed；
- 提案入口不限本屏：agent 节点（autoLevel=all 可全自动走完含 approve）、API/CLI 同产同卡（对话卡片在 console 会话页可见）。

### 规则

1. **默认对话**：进入提案屏即对话；「直接填表」作为显式降级入口（LLM 不可用自动降级并可提示）；
2. **缺少询问**（R-UX-1 第 3 条）：只问 spec 中不明确/缺失/冲突的字段（标题/目标/验收标准/影响面/优先级/产物落点/提出人），每次带默认值与示例；能推断的自动补充（见 R-UX-1 第 1/2 条：自由描述+自动上下文、自动补充）；
3. **自由输入 + 字段卡**：用户可一段话描述，agent 抽取字段并回填；字段卡可手改（双向同步对话）；
4. **生成与确认**：字段齐→LLM 生成 Proposal 对象（rv=0）→ dry-run（R-PUB lint + spec 准入 + 权限预览）→ 用户确认→ Apply（status=submitted；高危→ApprovalNeeded）；
5. **自动补全**：确认后由系统补缺省字段（proposer=当前主体、status、timestamps），不得手填敏感项（secret 只引用式）；
6. **可审计**：对话转对象的过程留痕（谁/什么会话/生成版本），对象入库后才算数；对话原文不入公共库。

### 控件映射（scheme→widget，R-UX-2）

| scheme 类型 | 控件 | 说明 |
|---|---|---|
| 枚举（`a|b|c`/闭合集） | **selector 下拉/分段选择** | 选项来自 scheme，禁止手输 |
| 字符串 | input | 单行 |
| 长文本 | textarea | 多行（验收标准等） |
| 数组 | 列表编辑器 | 逐项增删，行内仍按类型渲染 |
| 引用（ref） | 对象选择器 | 按 kind/scope 搜索，显示 name+rv |
| bool | switch | — |
| map | 键值编辑器 | 增删行 |
| 数字 | number input | 带 min/max |

字段集/必填/默认值全部来自 scheme（单一真相）；schema 变更后 UI 自动反映，禁止硬编码。

### 判据（机读）

- 从零到可提交：≤6 轮对话完成字段齐全（判据=字段卡全绿）；
- 生成对象过 spec 准入 + R-PUB lint；dry-run 失败时定位到字段；
- **对照卡三态必现其一**（conflicts / supplements / degraded:true），冲突卡引用可展开且 hash 一致；
- 确认后 Proposal rv=1、status=submitted；高危提案产 ApprovalNeeded；
- 「直接填表」路径仍可用（回归不掉）；UI 截图（对话态/预览态/对照卡）入报告。


## 13. 界面文案与内容展示规则（用户视角，2026-11-26 用户裁决；core_design rule/rule_ux.md R-UX-3/4/5 落地）

> 用户原话：「什么事件面。面这个字就很尴尬。去掉面。概念还是概念。但是界面设计按人来设计」「默认优先用户看的是 markdown（渲染后的），细节详细的才是 scheme。scheme 展示也要做的好看。基本上界面上一定要考虑用户的理解」「系统树。界面展示是系统」。

### 13.1 文案人话化（R-UX-3）

- 全站禁「面」字族工程词（事件面/指标面/文档面/权限面/场景面/读面/写面……）与内部里程碑词形（`E4`/`E7`、`L<n>-`、`P-0x`、「真数据」）入界面；屏名随行——文档节「屏幕 3a：Service 场景面」在界面上呈现为「Service 场景」。
- 屏幕 3（系统详情）现势整改点（2026-11-26 线上实证）：「声明/清单全部来自 cored 读面；对象详情=只读 viewer（E4 起升编辑器）」→ 人话说明（如「数据实时来自系统文档库；点击对象可查看与编辑」）；「场景面（E7 真数据）：事件面→指标面→文档面（tag 过滤）→权限面」→ 快捷入口卡「事件 / 指标 / 文档 / 权限」（副标题可留「按 tag 过滤」这类人话）。
- kind 名（ServiceDesc/Workflow/ConnectorOps/Provider）降为次级徽章/注记；主标题用用户词（服务 / 工作流 / 连接 / 凭据源）。

### 13.2 内容展示渲染优先（R-UX-4）

- 文档类（设计文档/desc/goal/报告/事件长文）：**默认渲染 markdown**；「scheme / 原文」为次级切换（屏幕 6 编辑器同样：预览态优先于源码态为默认）。
- 对象正文（ServiceDesc 等 YAML spec）：默认**结构化字段卡**展示（R-UX-2 控件映射的只读态）；「YAML」折叠次级；**首屏禁裸 YAML 转储**（2026-11-26 实证：系统详情首屏=整段 ServiceDesc YAML，整改）。
- 渲染器：vendor 单文件入库（client/，零网络依赖）或最小自写（标题/列表/表格/代码块/链接/粗斜体）；**渲染前 HTML 转义（XSS 红线）**。

### 13.3 系统树=系统视角（屏幕 2/3 修订，R-UX-3③）

- `#/s/<system>` 展示单位=**系统**，不是文档对象树：首屏=系统卡（名称/目标一句话/健康度/实例数/更新时间）→ 服务分组（instances 含 agentRefs 可点入会话）→ 工作流 / 连接 / 文档入口卡（人话标签+计数徽章）；文档对象清单退居「文档」tab 次级。
- 入口卡四张=事件 / 指标 / 文档 / 权限（去「面」）；空态显式且人话（「暂无实例对象在册」可保留）。

### 13.4 判据

- prep 探针机械断言：界面文案字符串清单零「面」字工程用法、零 `E<n>`/`L<n>-` 词形（回潮即红）。
- 屏幕 3 首屏=系统卡+人话入口卡（截图+DOM 断言）；ServiceDesc 正文=字段卡默认态+「YAML」折叠次级（截图）。
- 文档页签默认渲染视图，scheme/原文切换可用（截图）。
- 全站视觉仍 dsh 原生 token（§11 基线不回退，R-UX-5）。

## 14. 关注报告主界面与对象工作台（2026-11-26 用户裁决；core_design rule/rule_ux.md R-UX-6/7 落地）

> 用户原话：「大部分页面设计就是概念的 CRUD 直接翻译。非常难以操作以及理解」「可以用 LLM 跑一个完全的报告出来。哪些值得关注哪些不值得关注。然后默认直接报告旁边可以直接开对话 session 这是主要界面」「你作为业务人员视角你关注是什么。一眼看到的是状态。是异常。是重要系统提案。不是数字的堆叠」「整个 session 和文档交互界面做一个通用界面【设计 tagtagtyperule。ctx.操作。有 scheme 预览就 scheme 预览】其中交互也是能在交互中用 markdown 画出相应重点」「其中 workflow 也是这样的」。
>
> 线上实证（2026-11-26）：Welcome=四宫格数字（InSync 0/0、待审批 0、待你处理 0、24h 失败率 —）；系统树=按 kind 的 CRUD 清单（Scheme 1 / Agent 1 / WorkService 2 / ConnectorOps 3…）；Workflows=十列表格（名称/scope/启用/绑定/链/相位/次数/成功率/最近/文档）。本章把首屏与对象详情整体翻新，旧屏保留为钻取与数据口径。机制定义见 core_design concepts/attention.md。

### 14.0 取代关系

| 旧形态 | 新形态 |
|---|---|
| 屏幕 0 Welcome（指标大屏）+ 屏幕 1 总览（服务关注区） | `#/report` 关注报告主界面（报告+常驻对话）；`#/welcome`/`#/overview` 重定向至此 |
| 屏幕 5 Workflow 详情（默认 tab=运行） | 默认 tab=报告（14.6）；运行/流程图/事件/流转/数据流/配置为次级 |
| 屏幕 7 Agent 对话（独立页为主入口） | 报告页/工作台常驻栏为主入口（14.4）；独立会话页保留深链与会话管理 |
| 详情页矩阵 `#/doc/*`、`#/event/:id` 等 | `#/obj/:kind/:scope/:name` 统一工作台（14.5）；旧路由保留为别名 |
| 系统树/事件/审批/连接/文档列表 | 保留为钻取面；侧栏首位改为「关注报告」 |
| 指标四宫格 | 不再首屏；数字进报告 facts 注脚与明细折叠 |

### 14.1 主界面布局

```
┌ 关注报告    今天 12:00 更新 · 窗口 24h · 已检查 6 系统 ────────── [刷新] [⌘K] ┐
├ 报告（主区 ~2/3）                              ┃ 对话（右栏 ~1/3，常驻）        ┤
│ 一句话综述（不含数字）                           ┃ 会话：关注 · core_system      │
│ ── 状态 ───────────────────────────────       ┃ [历史消息]                    │
│  ● core_system 全部追平                         ┃ assistant（markdown 渲染）：   │
│  ◐ developer-system 交付落后一轮                ┃  结论 / 表格 / 引用块（可点）  │
│ ── 异常 ───────────────────────────────       ┃                               │
│  ▲ developer-system 门禁连续 3 轮失败            ┃                               │
│    为什么… [证据 run-123 · event-456] [聊聊]    ┃                               │
│ ── 提案与审批 ─────────────────────────        ┃                               │
│  ◆ 「接入对象存储」等待你批准        [去审批]   ┃                               │
│ ── 已检查，正常 ───────────────────────       ┃                               │
│  · deploy-system 无 drift                      ┃                               │
│  · 6 个系统 generation 全部追平                 ┃                               │
│ ── 数据可信度 ─────────────────────────       ┃                               │
│  事实注脚：6 系统 / 42 轮 / 2 异常 · 自动汇总    ┃ [输入框]                      │
└────────────────────────────────────────────────┴───────────────────────────────┘
```

- 顶栏只保留：一句话综述、更新时间/窗口、检查范围、刷新；**不做数字宫格**；
- 右侧对话栏常驻（窄屏可折成悬浮球）；**默认已开一个「报告助理」会话**（复用 root agent，不新增 Agent 对象，不是空白面板），点条目「聊聊」=就地切到锚点会话并带上下文，不跳页；
- 证据 chips 默认收起，点开=运行/事件/文档对象（全可点）；报告条目与对象工作台可互跳；
- 页脚「数据可信度」显式展示生成方式（`generatedBy=llm`→「智能归纳」/`rules`→「基础汇总」）、`degraded/missing`、`stale`、事实注脚。

### 14.2 报告三块 + clear

| 块 | 内容 | 动作 |
|---|---|---|
| 状态 | 每系统一行：追平/落后/未接入 + 一句话原因（人话，不列 gen 数字矩阵） | 点入系统工作台 |
| 异常 | 事故/连续失败/drift/阈值越线/会话停滞/连接不可达；每条=标题+为什么+影响+证据 | [聊聊] 开锚点会话；[看运行]/[看事件] 深链 |
| 提案与审批 | 待决 Proposal 与 ApprovalNeeded；按影响排序 | [去审批]（既有审批屏）；[聊聊] 问提案背景 |
| 已检查，正常 | 本轮检查过且正常的项（系统追平/drift 0/队列空/连接可达…） | 点开=检查依据 |
| 数据可信度 | as-of、窗口、generatedBy、degraded/missing、stale | [刷新] |

内容纪律：LLM 只写判断句，数字只能取自候选/服务端 facts（白名单校验，不得自造）；critical/high 条目不得被 LLM 隐藏；attention 默认 ≤7（只截 medium，critical/high 全显），超出显示「还有 N 条」。

### 14.3 生成与缓存（数据通路）

```
事实源（ops DB / Status / DriftReport / run / event / 审批）
 → 候选收集（确定性规则 + 严重度映射）
 → 权限裁剪（viewer scope；permHash）
 → LLM 叙述（Provider 的 llm 档；结构化输出）
 → 服务端校验（candidateId 存在 / evidence 可解析 / 数字命中候选与 facts 白名单）
 → attention_report 缓存（ops DB，派生）
 → console GET /v1/attention 渲染
```

- **接口保持 GET**：`GET /v1/attention?window=24h&scope=global|workflow:<name>&maxAge=300&wait=0|1`；缓存新鲜直接回，陈旧先回旧报告+`stale:true` 并后台重算，`wait=1` 最多等 8s；`maxAge=0` 为手动刷新（按 viewer 限频，超限回缓存）。**不新增浏览器写路径**（代理仍只放行 GET /v1/*，写路径唯一入口 POST /v1/apply 不变）。
- **LLM 不可用/超时/预算尽**：回 `generatedBy:rules` 的模板报告（同结构），界面不空白并显式标注；
- **生成器**：cored 读侧服务（可与 `connectops-context` 同族能力共部署）；可被既有 Workflow 定时预热，**不是新引擎**；报告生成参数（模型/提示/映射表版本）随报告记录，便于复现与回归；
- **数据来源**：候选=ops DB/Status；系统摘要=ctx 按 tag 装配（R-CTX-8）；报告缓存=ops DB `attention_report`（派生，可删）。

### 14.4 报告×对话

- **开聊**：条目 [聊聊] → 在右栏开/切会话，锚点 `{reportId, candidateId, refs}`；会话 ctx 由条目涉及对象 tag 装配（tagSig 可见），负责 agent 优先=该系统 agentRefs，无则 root（复用既有 Agent，不新增对象）；
- **会话列表**：锚点会话标题=「关注 · <条目>」，与普通会话同列、可续聊、可归档（dsh 原生会话机制，无新概念）；
- **回复形态**：markdown 渲染；重点用**首个结论块 + 对比表格 + 带 ref 的引用块 + ⚠️ 风险块**表达；对象引用一律可点（`#/obj/...`）；**禁纯文本转储**；
- **能做什么**：解释、查证据、开提案、生成修改草稿（提案卡/草稿通道）；**不能 Apply/批准**——按钮仍在既有入口，人在那里点；
- **注意力反馈**：条目级「忽略 24h / 这也要看 / 已处理」落 ops DB（按 viewer），只调本人后续排序权重，不改事实；
- **不丢上下文**：切换条目/系统不重建会话；会话栏可手动切到其他会话，锚点信息在会话头可见。

### 14.5 通用对象工作台

**一个组件服务所有对象**（doc / session / workflow / service / instance / event / proposal / approval）；路由 `#/obj/:kind/:scope/:name`，旧 `#/doc/*`、`#/event/:id`、`#/wf/:name` 为别名。

```
┌ 身份条：<名称> [kind 徽章] · scope · rev · 状态          ┃ 对话栏（常驻） ┐
├ 内容：markdown 渲染（R-UX-4）                             ┃                │
├ 标签：tags 按 tagType 分组 chips（点=同 tag 对象）         ┃                │
├ 适用规则：命中的 Rule 文档 + 命中来源（可点原文）           ┃                │
├ 上下文：本会话 ctx pack（tagSig/chunks ref+hash/tokens）   ┃                │
├ 操作：按权限可用的 ops/Apply/提案（含风险档与授权来源）     ┃                │
└ scheme：kind 有 spec → 只读字段卡（YAML 折叠）             ┃ [输入框]        │
  文档类无 spec → 结构段卡（必填段完成度）+ 正文             ┃                │
```

| 片 | 数据来源 | 缺片表现 |
|---|---|---|
| 身份 | Scheme 注册表 + revision | — |
| 内容 | git 文档面（markdown 渲染） | 「本文档暂无正文」 |
| 标签 | DocIndex（tags/tagType/tagRelevance） | 「暂无标签」+（有权限）「补标」入口 |
| 规则 | scope/kind/tag 命中的 Rule 文档 | 「无适用规则」 |
| 上下文 | 会话 ctx pack（R-CTX-6） | 「本会话未装配」+ 装配入口 |
| 操作 | ConnectorOps + 权限并集 | 无权限=不显示（不画灰按钮） |
| scheme | Scheme.kinds / DocType 结构段 | 无 scheme=不显示该片 |

- **单一真相**：片内数据全部来自 Scheme+ops DB+git+ctx；无前端自建状态；
- **对话是一等片**：与 14.4 同一会话栏、同一 markdown 渲染、同一「LLM 无 Apply 权」红线；
- **对象互跳**：身份条/标签/规则/证据里的标识符全可点（既有硬线）。

### 14.6 Workflow 工作台（同构）

- 默认 tab=**报告**：最近 N 轮发生了什么、哪里卡住/失败、下一步建议、涉及文档；数据=run 流水+event+DriftReport+status，生成器=14.3 同一报告服务（`scope=workflow:<name>`）；
- 右侧对话栏常驻：可就该 workflow 的失败轮次/文档变更开聊；
- 次级 tab 保留：运行/流程图/事件/流转/数据流/配置；配置编辑=Apply + dry-run（规则不变）；
- 操作条：启停/重跑/取消按现有能力与权限显示；未实现的动作不画假按钮（诚实余量）；
- 报告条目可深链到全局关注报告中的同一 candidate（去重不重复叙述）。

### 14.7 判据（机读，叠加既有验收线）

- 首屏 `#/report` 渲染报告主区+对话栏；DOM 断言首屏无四宫格数字卡（`[data-metric-card]` 计数=0）；
- 抽查 3 条 attention：每条 `evidence` ≥1 且 href 可点、ref/hash 与对象面一致；无证据条目=红；
- clear 区存在且非空（或显式「本窗口无异常」+检查范围）；生成方式 / 数据缺失 / 是否过期三者状态可见；
- LLM 断开演练：页面仍渲染（rules 报告），界面显示「基础汇总」，零白屏/零 console error；
- 权限断言：无 scope B 权限的 viewer 报告中零 B 条目、审批计数不含 B；
- 工作台：doc（有 scheme）/workflow/event 三类各抽 1，片齐全或显式「无」；workflow 首屏=报告 tab；会话回复 markdown 渲染且对象引用可点；
- 报告不新增 DocType：`scheme.yaml` kinds 计数不因本设计变化；报告缓存可删可重建。

### 14.8 可行性

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 首屏依赖 LLM（慢/挂） | ❗高 | 打开就等 LLM，或空白 | 缓存先行（stale-while-revalidate）+ rules 降级 + 超时上限 8s；首屏永不阻塞 |
| 报告幻觉/无证据 | ❗高 | 编造事故、错误归因 | 候选确定性 + 证据服务端解析 + 数字服务端注入 + critical/high 守卫 |
| 权限泄露 | ❗高 | 报告聚合越权内容 | 生成前裁剪 + permHash 缓存键 + 越权断言 |
| 成本 | ⚠️中 | 每次打开都生成 | 候选指纹（无变化不重算）+ TTL 5m + 频率限制 + token 预算 |
| 报告成第二真相 | ⚠️中 | 对象开始引用报告 | 派生视图无 DocType/无 git；条目只引用事实 |
| 聊天面自建状态 | ⚠️中 | 会话栏与 dsh 会话双源 | 会话=ctx.agents 原生机制；console 只做投影（cross-agent.md） |
| 旧路由/旧屏迁移 | ⚠️低 | 深链失效 | 旧路由别名 + 重定向表；验收含深链抽查 |

**结论：可行。全部为读侧派生+渲染层重组，零新后端概念；最大风险（LLM 不可用/幻觉/越权）都有确定性兜底与生成前裁剪。**

## 15. 命令行（corectl）与事件点火（2026-11-26 用户裁决；core_design concepts/cli.md / R-UX-8）

> 用户原话：「看看写一个命令行[对应桌面功能]然后命令行来提交。来触发系统的event而不是再外面点火了」「接下来任务请用cli提交。一旦有bug修复bug保证event自动能成功走循环」。

**结论：桌面能看的、能提交的，`corectl` 都能做；写命令只走既有 `POST /v1/apply` 与 `POST /v1/events`；自循环点火=`LoopRequested` 事件，外部 ignite 脚本退役。**

### 15.1 桌面 ↔ 命令行

| 桌面 | CLI | 入口 |
|---|---|---|
| 关注报告 / 总览 | `corectl report` / `status` | GET scheme/objects/workflows/runs/inbox/events |
| 系统树/详情 | `corectl get ServiceDesc|ServiceInstance` | GET /v1/objects/{kind} |
| 文档查看 | `corectl get <kind> <name>` / `cat` | GET /v1/objects/{kind}/{name} |
| Workflows / 运行 | `corectl workflows` / `runs` | GET /v1/workflows[/runs] |
| 事件 | `corectl events` / `event publish` | GET/POST /v1/events |
| 审批 / 收件箱 | `corectl approvals` / `inbox` | GET /v1/approvals / /v1/inbox |
| 连接 | `corectl get WorkService|ConnectorOps|Provider` | GET /v1/objects |
| 会话 | `corectl sessions` / `wakes` | GET /v1/sessions / /v1/agents/wakes |
| 文档编辑 Apply | `corectl apply -f <file> [--dry-run]` | POST /v1/apply（唯一写入口） |
| 自循环点火 | `corectl loop` | POST /v1/events `LoopRequested` |

- 地址发现：宿主就绪写 `~/.dsh/cored.addr`（0600）；CLI 优先级 `--server` > `CORED_ADDR` > 文件。
- 主体：缺省 `console-operator` + `role/global/admin`；部署侧可覆写受限 role，与桌面 `config.applySubject` 同口径。

### 15.2 事件点火链路（替代外部 ignite）

```
corectl loop
 → POST /v1/events {type: LoopRequested, dedupKey: <loop>:<round>}
 → eventbus → dispatch {on: LoopRequested, dispatch: root-agent}
 → WakeLog（/v1/agents/wakes 投影）
 → WakeNotifier（CORE_SYSTEM_WAKE_ADDR 开启）→ 宿主 plugin POST /wake/spawn
 → 宿主校验 type/agent → pgrep 单飞 → 执行部署侧 loopCommand（固定命令，载荷不进命令）
 → core-headless loop 会话（loop-next.md + 运行护栏）
```

部署配置（部署侧，不入公开仓）：

| 配置 | 作用 |
|---|---|
| `CORE_SYSTEM_WAKE_ADDR` | cored 唤醒桥地址（宿主 listener 回填） |
| `CORE_SYSTEM_WAKE_TYPES` | 白名单（缺省 `LoopRequested`） |
| `config.loopCommand` / `CORE_SYSTEM_LOOP_CMD` | 宿主拉起 loop 的固定命令（如部署脚本） |
| `config.loopRunningPattern` / `CORE_SYSTEM_LOOP_RUNNING_PATTERN` | 单飞检测 `pgrep -f` 模式 |
| `config.coredAddrFile` | 就绪后写地址文件（仅主控制面 profile） |

失败语义：cored 未开桥=纯投影零出站；宿主未配命令=503；已有 loop=200 `already-running` + pending 持久化（循环退出后自动拉起，不丢事件）；宿主不可达/拉起失败=stderr 留痕，事件仍受理。

**会话结束**：loop 会话不得自行 `setsid` 点火下一轮；结束前用 `corectl loop` 提交（`ignite-loop.sh` 护栏 6），本轮仍在收尾时走 pending，退出后自动拉起。循环每一轮都由事件链驱动。

### 15.3 判据（机读）

- `corectl loop` 后 `GET /v1/events?type=LoopRequested` 命中，且 `GET /v1/agents/wakes` 出现 `agent=root,type=LoopRequested`；
- 宿主日志出现 `wake 桥已拉起自循环 ... spawned` 或 `already-running`；
- 停掉外部 ignite（不手工启动 dsh core-headless）后，重复 `corectl loop` 仍能拉起/续跑循环；已有循环时进程数不增加（单飞）；
- `corectl` 的 apply/event 请求体主体与桌面一致；缺 role=拒绝；无 cored 直连 DB/文件；
- 事件载荷中的任何字符串不进入宿主命令（spawn 参数恒空数组）；`CORE_SYSTEM_WAKE_ADDR` 缺席时 cored 仅落投影零出站；
- CLI 无 `--server`/`CORED_ADDR` 时能从 `~/.dsh/cored.addr` 读到地址；文件 0600。

### 15.4 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 随机端口导致 CLI 不可用 | ⚠️中 | 宿主写地址文件；CLI 三级发现 |
| 重复拉起循环 | ❗高 | pgrep 单飞 + `already-running`；事件 dedup |
| 命令注入 | ❗高 | 固定命令、参数空数组、载荷只进日志 |
| 桥不可用/宿主重启 | ⚠️中 | 显式 503/日志；下一事件重试；过渡期保留外部 ignite 到桥验收 |
| 权限旁路 | ❗高 | 与桌面同一主体判定；部署侧可覆写受限 role |
| 循环在跑时新事件 | ✅ 低 | 返回 already-running 并入 pending（持久化、同因合并）；循环退出后自动拉起，不杀不重启 |

**结论：可行。CLI=既有控制面的薄客户端；事件点火复用既有事件总线/路由/唤醒面，新增仅宿主唤醒桥与部署侧命令配置；零新写路径、零新权限模型。**

## 16. 任务中心与循环可见性（人视角，2026-11-26 用户裁决）

> 用户原话：「不通畅啊。给出页面建议吧。按人的视角。这明显不通畅啊。」

**线上实测根因（不是审美问题，是入口断裂）**：

| 现象 | 根因 |
|---|---|
| 审批页看不到 loop | 审批页只列待审/已决；loop 是 dsh session，不在审批页 |
| loop 会话难找 | 会话藏在侧栏「未分组」，标题常为「未命名」；两个 `console · core-headless` 是探针会话，不是 loop |
| 会话没有节点 | 会话页不显示 workflow/task/phase；loop 不是 Workflow run，没有节点投影 |
| workflow 页对不上 | `core-workflow` run #1 是另一条 MetricThreshold 事件 run；`dev-delivery` 无现势 run |
| 深链不可用 | 点击会话 URL 不更新；`#/session/<id>` 只能手填；Chat 视图切换禁用 |
| 运行详情空 | run 抽屉 SessionLog/action log 是诚实空态，没链到真实会话 |

结论：**用户要的不是更多列表，而是「一处看到现在在做什么、卡在哪、谁在做、下一步」，并且一键进完整对话。**

### 16.1 页面建议（按人的视角）

#### A. 任务中心 `#/tasks`（新侧栏一级，放在报告之后）

```
┌ 任务中心 ─ 正在做 3 · 等人 1 · 卡住 1 · 今日完成 8 ─ [并发 3/4 调整] ┐
│ 正在做                                                               │
│ ● loop-78  对照卡降级重试/验证…   节点 Verify   12m   [对话] [节点]  │
│   下一步：等待 verify 通过后 Deploy                                  │
│ ● task-123 修复 gate 失败        节点 Execute  8m    [对话] [证据]  │
│ 等人                                                                 │
│ ◆ 提案「接入对象存储」待你批准   来源 task-120  [去审批] [看背景]    │
│ 卡住                                                                 │
│ ▲ task-130 等待 task-129 完成（依赖）  [看依赖]                      │
│ 完成                                                                 │
│ ✓ loop-77  …  14m   [报告] [会话]                                    │
└──────────────────────────────────────────────────────────────────────┘
```

- **一行一个工作**：标题（任务名/loop 号）+ 人话状态 + 谁在做 + 当前节点 + 跑了多久 + 最后动作 + 下一步。
- 分组固定：**正在做 / 等人 / 卡住 / 完成**；「卡住」必须写原因（依赖/写集冲突/租约过期/审批/权限）。
- 每行 `[对话]` 直达会话全文；`[节点]` 直达工作流节点/任务时间线；`[证据]` 直达对象/运行/事件。
- 顶部并发控制：`3/4` 可点开调整 `maxConcurrent/perService/perRepo`、暂停/恢复（=Apply，留痕）；排队原因可见。

#### B. 任务详情 `#/task/:id`

```
┌ 修复 developer-system 门禁连续失败    ● 正在做   负责人 dev-1  [暂停][取消] ┐
│ 在做什么：定位 gate 失败并修复，连续 3 轮绿才算完                          │
│ 卡在哪：—                                                                  │
│ 下一步：Verify → Deploy（prod 需人批）                                     │
├ 左：对话/轨迹（Chat | Trajectory）        ┬ 右：时间线/关系/证据            │
│ [完整会话流，实时追加]                    │ queued→ready→running→verify→done│
│                                           │ 依赖 task-129 / 写集 repos…    │
│                                           │ 节点：Verify（workflow dev-…） │
└───────────────────────────────────────────┴────────────────────────────────┘
```

- 会话、任务、workflow/run/节点三者同屏；任何标识符可点。
- `在做什么 / 卡在哪 / 下一步` 三行置顶——人不需要读日志猜。

#### C. 当前循环卡（报告首屏 / Workflows 页头）

- 有 loop：`当前循环 loop-78 · 正在做 · 最后一步「Verify 重试」· 已跑 12m` + `[看完整对话] [看节点]`
- 无 loop：`当前无进行中循环` + `[用 CLI 点火]`（`corectl loop`）——不假装在跑。
- 卡片数据=LoopRequested 唤醒 + 宿主会话；**loop 与 workflow run 的关系显式标注**（当前=会话型任务，无 run；若将来映射到 loop-workflow 则显示 run/phase）。

#### D. 会话页头（`#/session/:id` / 侧栏会话）

- 头部 chips：`Task: task-123` · `Workflow: dev-delivery` · `节点: Verify` · `Run: #3`；无则显式 `会话型任务（无 workflow）`。
- `Chat` / `Trajectory` 双视图都可用；`复制会话链接` 一键复制 `#/session/<id>`；选择会话即更新 hash，刷新恢复。
- 会话标题由首条任务/loop-next 生成，禁止长期显示「未命名」。

#### E. 工作流页（`#/wf/:name`）

- 节点图/列表上直接显示：该节点当前活跃会话/Task 数；点节点=过滤后的任务/会话列表，不再只画静态相位。
- 运行抽屉：`SessionLog 全文` 有真实会话链接；空态必须给原因和下一步，不摆死胡同。
- `core-workflow` 的 run 与 loop 会话分开标注：`事件对账 run` vs `loop 会话型任务`；不让用户误以为 run #1 就是 loop。

#### F. 审批页

- 每条待审项显示来源：`来自 task-123 / loop-78 / proposal-x`；一键跳到任务/会话背景。
- 已决记录同样可回溯到任务/会话；审批不再孤立。

#### G. 并发可视化

- `#/tasks` 顶部/右侧显示并发车道：`运行中 3 / 上限 4`，每车道=任务名+节点+agent；空车道=可接新任务。
- 排队队列显示阻塞原因（依赖/写集/服务上限/仓库上限）；调整上限、暂停/恢复=Apply 并留痕。
- 多任务并发不是“更多列表”，而是**车道 + 任务**两层：先看车道是否打满，再看任务卡在哪。

### 16.2 路由与信息架构

| 页面 | 路由 | 说明 |
|---|---|---|
| 任务中心 | `#/tasks` | 新侧栏一级；默认分组正在做/等人/卡住/完成 |
| 任务详情 | `#/task/:id` | 会话+节点+时间线+依赖/写集+操作 |
| 会话详情 | `#/session/:id` | Chat/Trajectory 双视图；头部 Task/Workflow/节点/Run chips |
| 工作流 | `#/wf/:name` | 节点上显示活跃任务/会话；run 抽屉链会话 |
| 审批 | `#/approvals` | 每条链任务/会话背景 |
| 循环卡 | `#/report` / `#/wf/:name` 页头 | 当前 loop 状态+一键会话 |

- 所有页面遵守：**任意进行中的工作，最多两次点击到达**（列表→详情→会话）；不再要求用户知道 session id 或去“未分组”里翻。
- 人话状态词固定：`正在做 / 等人 / 卡住 / 完成`；禁用 `run #1`、`session-…` 当主标题（放次级注记）。

### 16.3 数据来源

| 数据 | 来源 |
|---|---|
| Task 列表/状态 | `GET /v1/objects/Task`（Task.status：phase/agentSession/lastAction/lastError/dependsOn） |
| 会话全文 | dsh 宿主 session store（Chat/Trajectory）；`Task.status.agentSession` 提供深链 |
| Workflow/run/节点 | `/v1/workflows`、`/v1/workflows/runs`、run 相位时间线 |
| Loop 来源 | `LoopRequested` 事件 + `/v1/agents/wakes` + 宿主会话 |
| 审批 | `/v1/inbox`、`/v1/approvals`、草稿缓存 |
| 并发控制 | `runtime.taskScheduler`（Scheme）+ 调度器状态 |

- 前端不新建状态：会话/任务/工作流全部来自既有读面+宿主 session；Task 状态由调度器系统写。

### 16.4 判据（机读）

- 从审批页任一待审项、工作流任一节点、任务中心任一行，**≤2 次点击**到达会话全文或任务详情；不可达=红。
- 任务中心首屏在 2s 内列出所有 running/blocked/等人项；每行含 `在做什么/卡在哪/谁在做/下一步`（空则显式「—」）。
- 会话页头显示关联 Task/Workflow/节点/Run（或显式「会话型任务」）；复制链接可刷新恢复。
- 工作流节点点击后出现该节点活跃任务/会话；run 抽屉 SessionLog 有真实链接（无则显式空态+原因）。
- 并发上限/暂停调整=Apply 后可观测生效；排队原因显式（依赖/写集/服务/仓库）。
- 不出现「未命名」长期占位（>1 分钟仍无标题=红）。

### 16.5 可行性

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 会话 ID/宿主数据不可得 | ⚠️中 | 前端拿不到 dsh session 列表 | 宿主已有「宿主全部会话」面；Task.status.agentSession 回填；深链 `#/session/<id>` 已验证可用 |
| loop 与 workflow 关系缺失 | ❗高 | 用户误判 run #1=loop | 显式标注「会话型任务（无 run）」；后续 Task/loop-workflow 映射 |
| 多任务状态源 | ⚠️中 | Task 状态与会话状态双源 | Task.status 单一写者=调度器；会话状态只作证据展示 |
| 并发控制越权 | ❗高 | 调整上限影响全局 | 仅 admin/owner 可 Apply；变更留痕；默认保守 |
| 页面性能 | ⚠️低 | 多任务+会话流 | 分页/虚拟滚动；follow 增量；任务中心只拉摘要 |
| 旧路由/深链 | ⚠️低 | 书签失效 | 保留旧路由别名；`#/session/<id>` 兼容 |

**结论：可行。任务中心是 Task/Workflow/会话三源的统一读侧投影；新增的只有 Task 状态与深链，不引入第二套状态。**

## 17. web/ v2 重构批：两级控制台·总览大屏·宿主界面复用·文档目录化·AI 修文档（2026-11-26 用户裁决；已实现 workservice@bf532f9）

> 用户原话要点：「核心控制台改成系统控制台。添加另一个级别叫业务控制台先不加东西。系统控制台以系统视角展示，连接/Global/会话/系统树放二级。总揽就是大屏：现在跑的任务[workflow]系统的状态、最近需要的审批、核心 Agent。点击 Service 也是这样的布局展示（后续 ServiceAgent 登录就干这个）。能不能直接复用 deepseek 的 session 界面。文档界面目录展示是目录树，有 tag 过滤，展示 tag/版本/重要程度，直接展示渲染后的 markdown——现在谁还编辑，直接有对话框通过 llm 来修复文档然后 apply。」

### 17.1 两级控制台（IA 重构）

| 项 | 落地 |
|---|---|
| 级别 tabs | 侧栏顶部「系统控制台 / 业务控制台」，`localStorage('cc.level')` 持久化；业务级切 `#/biz` |
| 业务控制台 | 占位屏（显式空态：后续 ServiceAgent 登录后承载业务大屏与操作面——先不加东西） |
| 系统级一级 | 总览 / 关注报告 / 任务中心 / Workflows / 事件 / 审批 / 需求提案 |
| 系统级二级 | 折叠组「基础设施」：会话 / 系统树 / 文档库 / 对象工作台 / 连接（组头点击折叠，会话级内存态） |

### 17.2 总览大屏（`#/`）

- 统计条五卡（在册对象/事件/待审/收件箱/进行中任务）+ 当前循环卡（`GET /v1/loop/current` 现读，缺席=诚实降级）。
- 三区：**正在跑的 Workflows**（snapshot.runs 非终态，行=workflow/#run/相位徽/相对时间，深链运行页）、**最近需要的审批**（草稿缓存 ∪ ApprovalNeeded/Escalate 归档行，最近 8 条，「去处理」深链）、**核心 Agent**（kind=Agent 对象 ∪ 会话活性状态徽，深链会话屏）。
- **Service 同构视角** `#/service/:name`：同一 dashLayout 换 ServiceDesc 数据源（正文 `agent://` 引用解析→核心 Agent 区过滤），页脚 ServiceDesc 在册性诚实词形——后续 ServiceAgent 登录即落此视图。

### 17.3 会话屏复用宿主原生界面（DeepSeek 风格零重复建设）

- `#/chat/:agent` 与 `#/session/:id`：右主区 iframe 同源嵌宿主原生会话界面（消息流/tool 折叠/composer 全套复用；门牌 cookie 已共享）；「新窗口打开」弹全屏原生。
- 左栏会话清单保留（faces.sessions 注入优先，快照 sessions 投影次之，双缺=诚实空态）。
- `#/session/:id` 下方保留 ContextPack 契约面（§14/G-14：takeBudget/tagSig/分片缓存/编辑分叉/撤销栈）。

### 17.4 文档库目录化 + AI 修文档

- 文档库屏：tag 过滤输入框（缓存正文 frontmatter 现匹配，预取窗口 24 篇诚实注记）+ 行内 tag chips / rv 版本 / 重要度列（`importance:` frontmatter，≥80 高亮）。
- editor 右栏第三 tab「**AI 修文档**」：契约 `__CC.chatFaces.docFix(prompt, ref) => Promise<string>`（宿主 LLM 通道）→ 全文建议 → 「写入草稿」→ 既有 Apply 通路（乐观锁+预检照走，AI 无特权）；未注入=显式缺席词形（「原文」手编保留）。

### 17.5 判据（机械）

- `npm test` 全绿（50+；i18n 六锚含词典规模底线）；全部文件 ≤800 行。
- 浏览器活体：级别 tabs 切换保持深链；大屏三区随 patch 增量刷新；Service 视角与大屏同构；iframe 同源加载宿主界面；文档库 tag 过滤生效；AI 面板未注入显式缺席。

## 18. 需求直达链路批（2026-11-26 用户裁决；待实现清单）

> 用户原话要点：「最上面是总览，总览下面就是 rootAgent 直接对话。可以对话提需求（默认可以看上下文，上下文做成规则结构展示，可以直接编辑 apply 文档）。apply 后可以看到触发的哪些文档更新。workflow 可以看到哪些 agent 哪些 session，其中 session 相关文档（RAG 的）、上下文、资源。现在我提交一个需求『进行代码审核。看看实际和文档差距有多大。并进行修复』，像在 zcode 上提交一样在框内提交。然后可以看到 doc 的文档更新（分析结论提交到相应 doc 然后 apply）。文档 apply 即状态从 InSync 变成 Running，然后可以点进相应的 workflow 看在哪个节点（agent）。workflow 查看一定是可视化的节点，标准多节点 workflow 模式。点击 workflow 节点就可以看到 agent 和 session，后者看到程序的日志和状态。整个网页流程非常顺畅。workflow 的展示和配置都默认多节点、可编辑、美观好看、自动扩展。」

### 18.1 rootAgent 对话框（2026-11-26 二次裁决，取代 intake 方案）

> 用户修正原话：「需求提案没有。就是 rootAgent 而已。入口永远是一个对话框可选 session。只是对话框目标是为了找到文档、更新文档。交互要做的非常多。别人是 ask question，你应该是提示文档是什么、生成结论是什么、给完整文档模式观看。另外 chat.js 中某些对话或者思考过程是可以 expand 的（一定要有）。chat 中开始说的 ref 文档、provider connector 以及内部资源啥的一定要能点击查看。」

| 项 | 设计 |
|---|---|
| 入口形态 | **永远一个对话框**（大屏顶部，可选 session——下拉切换目标会话；rootAgent 缺省）。无 intake/Proposal 表单环节 |
| 对话目标 | **找文档、更新文档**——不是问答机：AI 主动提示「涉及哪些文档（ref 可点）/ 生成结论是什么 / 完整文档模式观看」 |
| 文档为中心的交互 | ①消息内文档 ref 内联可点（→渲染视图/编辑器）②结论卡：AI 生成的修改结论结构化展示（结论+涉及文档+变更要点）③**完整文档模式**：结论对应的目标文档全文预览模式（渲染 md），确认后写入草稿→Apply |
| 消息级 expand | 思考过程/长内容/工具过程折叠块，点开展开（chat.js 必备交互） |
| ref 可点击族 | 文档（doc/:… 渲染视图）、provider/connector（connectors 屏）、内部资源（对象工作台/system tree）——消息文本中出现的 ref 一律链接化 |
| 数据通路 | 宿主注入 `__CC.chatFaces.{send(sessionId,text), transcript(id), docFix(prompt,ref), sessions}`——plugin 侧经 sessionController（selfheal 桥同款注入通路）实现 send；未注入=composer 显式缺席词形（不装假） |
| 上下文结构卡 | 对话框侧栏「上下文」：ContextPack 投影（tagSig/规则命中/预算域）复用 sessionctx 渲染核；可编辑分叉→apply |

### 18.2 文档状态徽 InSync→Running（2026-11-26 二次裁决：语义简化）

> 用户修正原话：「文档状态徽就是看自己所属的 Workflow 开始运动了。」

- **语义=所属 workflow 动了**：文档所属 workflow 存在非终态 run → 徽 `Running`；否则 `InSync`。（不做 eventId 逐事件关联——单看文档所属 workflow 的 run 活性。）
- docs 屏行、对象详情头、编辑器头共用此徽；apply 成功回执仍显示触发 run 的深链。

### 18.3 Workflow 可视化节点图（B5+B6+B7）

- runScreen 重做：**横排管线节点图**——节点=run.`phases` 声明序列（数据已在 runs 行：phases/transitions/phase/status/eventId/involved），连线=transitions 边；当前相位高亮+状态徽+推进动画（patch 增量驱动重绘）。
- 节点点击→下方抽屉：①该相位事件链（日志=events 按 run/相位过滤）②agent/agentSession 深链（loop/current 与 Task.status.agentSession 回填链）③involved 文档 chips（RAG 关联）④session 上下文深链（`#/session/:id`→ContextPack/分片=「相关文档(RAG)、上下文、资源」）。
- 列表/详情/运行页统一大屏卡风格（dash-card 体系）；节点图默认多节点（phases 缺席=诚实降级为单节点+注记，不编造）。
- 「可编辑、自动扩展」：相位编辑面后续接 Workflow 对象 spec.phases/transitions 的 apply 通路（本轮先读侧可视化+编辑占位，声明面已支持——objspec.go `view.Phases = doc.Spec.Phases`）。

### 18.4 全链顺畅（B8+B9）

- 提需求→分析→doc 更新→apply→Running→点进节点：全程深链一条龙，无手工拼 URL；patch 增量驱动状态流转零轮询。
- i18n 词条随批；`npm test`+构建+`lint/max-file-lines.sh` 全绿；部署 CT116 浏览器全流程验收截图留证。

### 18.4a editor scheme 引用折叠（2026-11-26 二次裁决）

> 用户修正原话：「editor.js 这些没问题。但是有 editor.js ref 到 scheme 的，默认隐藏不展示 scheme，expand 才展示完整 scheme 给你看。」

- editor 渲染视图中一切 scheme 派生内容（frontmatter 声明区/YAML 字段卡/scheme 引用段）**默认折叠隐藏**——默认只见文档正文（渲染 md）；点「scheme」expand 展开完整 scheme 内容。

### 18.4b 用户视角设计原则+三段式会话展示+bug workflow 呈现（2026-11-26 三次裁决）

> 用户原话：「一定要有用户人的视角。我怎么简单的无副作用的用。可以在用的过程中不停的提供新的信息、新的要求。但是别一开始就这么多概念。概念是为了保运行的、保可查、不失控的。用这个思路重新对页面和部分流程进行设计。goal 要加上这条：这是一个企业级内置 agent 系统。其中一个运行的 workflow[session] 结束了，三段的部分也要在界面上分别展示（还是默认隐藏，可以 expand，或者跳转详情卡片）。另外运行时候的 bug 应该开始进入 event 了。默认的 workflow 中有 bug 触发 agent 评审→触发临时性 bug 文档→修复代码→发版本→bug 文档删除→整理更新部分文档/记忆（这也是一个 workflow，要跑起来）。workflow 感觉也要有 workflow 模版了。」

**设计原则（全页面回检准绳）**：

1. **简单无副作用优先**：使用者的每个动作默认零副作用（看=免费，动=显式确认）；概念（workflow/scheme/权限）一律不前置——默认隐藏、可 expand、或跳详情卡。
2. **使用中持续供信息**：对话/表单允许边用边补充新信息新要求（不锁轮次、不强迫一次说全）。
3. **概念=机制层**：概念展示统一收进「详情卡/expand」，主流程只见人话词形（goal.md 已补企业级内置 agent 系统定位——core_design@084a0c6）。

**落地项**：

| 项 | 设计 |
|---|---|
| 三段式会话分展示 | workflow[session] 结束后，三段（tag 装配段/执行段/收尾段）在界面分别可读：默认折叠，expand 原地展开，或「详情卡」跳 `#/session/:id`（ContextPack 面板已承载第一段；执行段=事件链；收尾段=收敛结论）——chat 屏 session 抽屉统一入口 |
| bug 生命周期 workflow | 呈现于 workflows 列表（模板实例卡：六步相位管线=BugReport→评审→BugDoc→修复→发版本→删除+整理）；事件屏 BugReport 归档行深链；设计面已落（core_design concepts/workflow.md §9a——BugReport 事件+BugDoc kind+dispatch 声明） |
| workflow 模板 | workflows 屏新增「模板」区（首批三模板：bug 生命周期/dev-delivery/文档收敛——core_design workflow.md §9b）；模板卡=「实例化」按钮（复制模具→参数表单→apply） |
| 页面回检 | 总览大屏/会话/文档库按三原则回检：主流程人话词形、概念全部收进 expand/详情卡 |

1. 按本需求生成文档（本节+必要的 concepts 增量）。
2. **CLI 自己提交 apply 触发一次**：把需求写成文档对象 → `corectl` apply → 触发 workflow/loop。
3. **全程跟踪**：浏览器跟拍 InSync→Running→节点图亮起→终态，截图留证。

### 可行性

| 项 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| intake 多轮契约 | ✅低 | TurnRequest/Response 词形已在册（intake.go §97-130），plugin 代理通路已有（/core-console/intake→/v1/intake/*） | 前端按 ready/askingField 逐轮渲染 |
| 节点图数据 | ✅低 | runs 行已携带 phases/transitions/phase/status/eventId/involved（routes_workflow.go §293-312）——零后端改动 | phases 缺席=单节点诚实降级 |
| InSync/Running 徽 | ⚠️中 | 「对象↔run」关联靠 eventId 同源+involved 回指；冷启动窗口外的 run 不可见 | 徽语义=「窗口内可见事实」，出窗=InSync 诚实降级 |
| AI 修文档通道 | ⚠️中 | 依赖宿主 chatFaces.docFix 注入（未注入=缺席词形） | 会话屏原生界面兜底人工通路 |
| 流程顺畅度 | ⚠️中 | intake→generate→apply→run 三跳跨面 | 全深链+patch 增量+过渡态显式 |

**结论：可行。数据面零后端改动（runs/intake/apply 契约全在册）；新增全部在读侧投影与可视化层。**

## 19. 全页可用性批（2026-11-26 用户裁决：「每个页面走下，基本上还是不能用——要么没做，要么就是不能用」）

**背景**：控制台 v2 骨架/主题/导航已立，但逐页活体审计（CT116 现场走查 13+ 面）暴露一批「没做」与「不能用」。本批=把每一页修到**个人日常可用**：真实数据、动作可点、死路消灭、终态显式。

### 19.1 逐页审计结论（现场证据）

| 页面 | 判定 | 现场证据 |
|---|---|---|
| 总览 #/ | ⚠️半可用 | 大屏立；但 2 个 AwaitingApproval run 未作为「需你批准」可动作项出现；底部连接灯恒「连接中…」（侧栏双 footer 覆写竞态）；面包屑=裸 route 词「welcome」；~15 条 400 噪声 |
| 审批 #/approvals | ❌不能用 | **核心死路**：ApprovalNeeded 事件行只有「忽略」无「批准/驳回」——run#1/#2 全控制台无一处可批准 |
| Workflows #/workflows | ❌不能用 | 「暂无在册工作流」假空态——registry 明明 7 条（快照无 workflows 键，页面没读 GET /v1/workflows）；runs 表缺席；模板区没做 |
| 会话 #/chat/root-agent | ❌不能用 | session 下拉零选项（快照无 sessions 键，页面没读 GET /v1/sessions——后端 5 会话在册）；单窄列，无 session 列表 |
| 文档库 #/docs | ❌崩溃 | 屏保持上一页内容——docsScreen 引用未导入的 `syncBadge`（ReferenceError，screenOf 中断=面包屑/导航高亮全停） |
| 任务 #/tasks | ⚠️半可用 | 分组投影正常；卡住任务（状态未知）无「取消」动作；已知活体 bug「空 status 不调度」页面无逃生动作 |
| 关注报告 #/report | ⚠️半可用 | 关注项卡标题三重重复（一般+ApprovalNeeded+ApprovalNeeded）；卡不可点无去处理；AwaitingApproval runs 不入报告；导航双高亮（关注报告+任务中心同亮） |
| 需求提案 #/proposals | ⚠️半可用 | 列表有行但卡片不可展开（要素/验收不可读）、无批准/驳回入口 |
| 系统树 #/tree | ⚠️半可用 | 全折叠+窄列——逐个点小箭头才见对象；ServiceDesc 不深链 service 大屏 |
| 对象工作台 #/obj | ⚠️半可用 | 六片布局立；但内容/规则面板恒「现读中…」（=api.object global-scope 缺 ?scope= → 400）；scheme 聚合缺席注记 |
| 连接 #/connectors | ✅可用 | 四族清单+工作台深链正常 |
| 编辑器 #/doc/... | ⚠️半可用 | 三 tab+Apply 吸底立；正文拉取失败恒「注水中…」无终态（同 400 根因） |
| 业务控制台 #/biz | ✅占位（裁决内） | 显式占位不装假 |

### 19.2 根因（一刀多果）

| 根因 | 爆点 | 修 |
|---|---|---|
| R1 `api.object` scope=global 时省略 `?scope=` → cored 400「需显式 scope」 | ~15 条/页 console 400；对象工作台正文卡死；编辑器注水不停；文档库 tag 列全 — | 恒带 `?scope=`（缺省 global）——api.js 一行 |
| R2 misc.js 引用未导入 `syncBadge` | #/docs 整屏失明（渲染中断） | 补导入（或内联）——一行 |
| R3 人工批闸通路缺失（引擎语义：run 挂起=等 `ApprovalGranted`/`ApprovalRejected` 事件，involved=Workflow 锚寻径——workflows 规则 13） | run#1/#2 永挂；审批页/运行页/总览均无「批准继续」 | 审批页事件行+运行详情 hero 加「批准继续/驳回终止」→ POST /core-console/event-publish（白名单扩 ApprovalGranted/ApprovalRejected/TaskCancelRequested）→ cored /v1/events（source=human 服务端强制） |
| R4 页面读死快照键（workflows/sessions/inbox 快照缺席即空白） | workflows 假空态、chat 下拉零选项、收件箱 — | 换活体面：GET /v1/workflows、GET /v1/sessions、（inbox 保持诚实缺席注记） |
| R5 main.js 三小病 | 面包屑裸词、双高亮（report→tasks 映射残留）、双 footer 连接灯覆写 | 标签映射+删映射+去重 footer 且 nav 重绘后重放连接态 |

### 19.3 逐页落地清单

| 页 | 项 |
|---|---|
| 总览 | 审批区行=挂起 run 一等公民（批准继续/驳回终止按钮就位）；Agent 区显示会话活性（GET /v1/sessions 投影）；「触发事件」接 event-publish 通路；收件箱卡缺席时隐藏不显示 — |
| 审批 | 事件行加「批准（发 ApprovalGranted）/驳回（发 ApprovalRejected）」（确认弹窗→发布→行消隐+快照重读）；批准后 run 在 Workflows 屏可见续行 |
| Workflows | registry 区（GET /v1/workflows 7 条+触发器词形）；runs 表（GET /v1/workflows/runs 全窗口+相位 chip+深链）；模板区首批三模板卡（bug 生命周期/dev-delivery/文档收敛——只读呈现+「设计见 workflow.md §9b」深链；实例化待 Template kind 落册，诚实置灰） |
| 会话 | session 下拉+左侧列表双源 GET /v1/sessions（state/phase/lastAction chip）；双列 DeepSeek 式布局（列表|线程+composer）；点行=选用进 composer 并挂上下文面板 |
| 文档库 | R2 修复复活；新建文档入口=「对话提需求」词形引导（文档创建走对话+Apply——裁决口径）；designdoc 工作台入口保留 |
| 任务 | 行级「取消」按钮（确认→TaskCancelRequested 发布）；详情页动作同源；状态未知行显式「调度器未见 status——已知活体 bug 台账 BUG-013」注记 |
| 关注报告 | 卡去重（severity 徽一次）；挂起 runs 入卡+批准直达；全卡可点 |
| 提案 | 卡点开=要素 expand（title/summary/acceptance/impact/proposer）；行尾「去审批」深链 |
| 系统树 | 默认展开对象数 ≤3 的 kind；列宽自适应；ServiceDesc 行加「Service 大屏」深链（#/service/:name 同构大屏） |
| 对象工作台 | R1 复活正文/规则；scheme 聚合缺席词形保留 |
| 编辑器 | 拉取失败终态词形（重试按钮），不再恒「注水中」 |
| 事件 | 行尾 copy-id（写剪贴板）；involved 三段可点深链；raw 引号词形清理 |

### 19.4 转正（同批落地）

1. **入口**：gate（dsh-web-gate）token 命中后 302 → `/core-console/`——控制台=默认落地页；dsh 原生界面降级为「agent 节点深查窗」（会话屏 iframe/新窗口按钮仍可达 `/?embedded=1`）。**2026-11-27 用户裁决：不再叫 v2——v1 旧 client 载体（plugin/client 前端巨石）整体删除，`/core-console/` 即正式入口；`/core-console/v2` 仅保留 302 兼容。**
2. **载体毛刺**：`/core-console/`（尾斜杠）与无斜杠同壳 200（dsh 前缀匹配语义 url===path||path+'/'——注册词形补齐）；`/core-console/v2` 与 `/core-console/v2/` 302 → `/core-console/`（历史书签兼容）；favicon data-URI 注入壳页（消 404 噪声）。
3. **口径**：dsh=agent 运行面（会话权威轨迹+sessionController.prompt 通路）；cored=控制面；本控制台=唯一日常 UI——与 goal「企业级内置 agent 系统」定位一致。

### 19.5 判据（机械）

- [ ] 逐页复验截图 13 面零「恒注水中/假空态/无动作死路」
- [ ] console 噪声：对象 400 归零
- [ ] run#2 从审批页「批准继续」→ 相位机续行（Executing 亮起）全程截图
- [ ] #/docs 渲染文档清单（syncBadge 修复实证）
- [ ] `?token=` 落地直达 `/core-console/`；尾斜杠 200；`/core-console/v2` 302 → `/core-console/`
- [ ] web npm test 全绿；plugin npm test 全绿

## 20. 全页深度扫描与整改方案（2026-11-26）

全量 34 屏活体扫描、16 端点与 21 个在册对象核对结论（含 P0 崩溃/失明修复、以人为本主线收束、布局修复、假数据清理清单及 `core_design` 真实 Scheme/概念文档纠偏），见独立文档：[console-audit-2026-11-26.md](console-audit-2026-11-26.md)。


## 21. 概念可见性审计（2026-11-26）

已实现概念 × 界面对账（19 kinds+非 kind 能力逐条判定 K1 直觉可见/K2 详情可达/K3 相关互链；22 项销项 V-01..V-22 四批；tag 聚合页设计草案；假数据存量补充），见独立文档：[concept-visibility-2026-11-26.md](concept-visibility-2026-11-26.md)。

## 22. 统一样式规范（2026-11-26）

全站 style 混乱整治（字号 15 档半像素混用/40+ 裸色值两蓝并存/radius 10 档六成绕过 token/按钮无变体体系）——以 DeepSeek 实测 token 体系为基准定版：--ds token 全表+按钮四变体+S-01..S-06 机械迁移判据，见独立文档：[style.md](style.md)。

## 23. 会话屏通信与视觉重建（2026-11-26）

chat 批：通信病灶实测（steer 闲置/无停止/无活体反馈/整屏重绘/requestId 丢弃）+ 视觉重建（DeepSeek 对话版型三段式/零 inline style/chat.css 拆分）——C-01..C-11 逐项判据，见独立文档：[chat.md](chat.md)。
