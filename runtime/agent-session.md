# 运行时设计 6：Agent Session 记录制与 AUTOLEVEL（R2 / A29–A31）

> 概念依据：core_system/concepts/agent.md v0.3。R2 裁决：**没有**"Agent 一切写操作经 Apply，违者 Policy 拒绝"这条规则；治理换轨为**记录制 + 分级制**。

## 1. PlanDoc / SessionLog（记录在 ServiceInstance）

Agent 的运转不留白：**每一次 PLAN、每完成一次 Session，必须记录文档，记在该 Agent 所属的 ServiceInstance**（docType 见 core_system/doctypes）。

```
systems/<s>/instances/<i>/docs/
  plan-<ts>-<task>.md      # PlanDoc：意图、引用的 TaskScheme/Workflow、dry-run 结果
  session-<ts>-<id>.md     # SessionLog：相位迁移、docsLoaded、动作摘要、outcome、token/耗时
```

- 触发：dsh 会话结束（或每相位迁移——粒度"看实现"，v1 建议**会话级**，相位级列为可选）+ `SessionClosed` Event。
- 写入：走 Apply（存储机制），fieldManager=该 agent——**这是事后留痕，不是逐写审批**。
- 对账：Instance 缺 PlanDoc/SessionLog = drift（Workflow 检查，docType required）。
- 价值：回放（态机可审计）、上下文压缩（下轮会话先读近期 SessionLog 而非全量）、漏读检测（docsLoaded 与 L0 清单比对）。

## 2. AUTOLEVEL 落地

| 级别 | 运行时行为 |
|---|---|
| `ask` | Planning 完成后挂起 → control plugin 发 ApprovalNeeded → 上级 agent（默认上溯 root）批/驳回；对象有 role 挂载时 role 持有者同达（双通道；驳回也产 SessionLog） |
| `auto` | 白名单/Scheme 内直跑；权限系统高危档仍拦（准入与 AUTOLEVEL 正交：级别管"问不问"，权限系统管"许不许"） |
| `all` | 不询问；仅显式授权 + 权限系统放行 |

默认（scheme.yaml runtime.autoLevels）：**RootAgent=ask，ServiceAgent=auto**——均为默认值；**RootAgent 与普通 Agent 同一 AUTOLEVEL 机制，autoLevel 均可配置，Root 也可 auto/all**（A64，all 需显式授权）。升级路径：模型变强 → Desc 调 autoLevel（Apply+权限系统）→ 自治空间变大，机制不变（P8）。

## 3. 子 agent（机器级进程）

- spawn：父进程经 control plugin `spawn machine-instance` 起独立子 agent 进程（一 agent 一进程；明确不省内存，R2）。**子 agent 运行时不限于 dsh**（A60）：dsh / opencode / 自写 agent 均可，选型与其工具环境在该子 agent 引用的 ConnectorOps 中描述或调用。
- 上下文：子 agent 不继承父会话内存；靠 PlanDoc/SessionLog/引用的 ConnectorOps 描述环境与工具。
- 权限：父一次性全量下发（⊆父，只减不增；不做按步骤细粒度裁剪）——上级派任务时把权限 token 与 ref 整包给全；运行时发现缺权限直接 ask 上级，上级重新全量申请并整包重发；直控三原语（dispatch/interrupt/query）全程 ops DB 留痕。

## 4. Skill 缓存（v0.6，A38）

Agent 会话的工具上下文 = Provider.llmPrompt（出厂说明书）+ **Skill**（工具使用处的缓存：注入提示+成功调用示例）。Session 成功调用后自动沉淀 Skill（阈值见 open-questions）；下次同类任务按需注入，不必重学。规则：**Skill 是缓存不是真相**——与 Provider 契约冲突即失效；provider 版本变更默认作废；示例脱敏。console 资源树把 Skill 列为一类节点。


**内置验收 Skill（acceptance-screenshot）**：Provider=`browser-headless`（provider.md 示例，本地工具型）、工具=`chromium-headless`；产出=页面截图 PNG（落 acceptance/shots/loop-<seq>-*.png，gitignore 永不提交）。workflow 验收节点通过 agent 调用该 skill 取证——首次成功调用自动沉淀（注入提示+成功命令示例），Provider 版本变更即失效。截图失败=报告标 unverified，不许手绘替代。
## 5. 三段式 Session 与上下文检索（Tag 核心 + 0–100 全局相关性 + 异步总结演化）

Session / Doc / TaskScheme / Event 的**上下文装配与历史检索**统一对齐 `runtime/context-rag.md`（R-CTX-1..8）：

### 5.1 自动打标与 0–100 统一标度

- **时机**：Session 关闭（SessionLog 落档时）与 Doc/TaskScheme Apply 后，自动维护：`tags[]`（每个 tag 归属唯一 `tagType`）、`tagRelevance`（`map<tag, 0-100>`）、`importance`（`0–100` 重要程度，含界面人类审核评分因子 `humanScore` 与跨任务多样性折扣 $w_{\text{div}}$）、`digest`（一句话标题+描述）——写进系统内部索引，并在定时导出 Git 时同步写出 `<doc>.md.metadatainfo` 侧车（R-DOC-6/7）；
- 打标失败/超时：对象仍入库，元数据留空 + Event(warn)——检索降级不阻塞写入；
- 打标提示词与评判标准**可编辑**（随 builtin skill/提示词管理，改提示词=改配置不是改代码）。

### 5.2 三段式 Session 生命周期与检索工具

一个逻辑意图/任务由**三段式 Session** 完成（详见 `runtime/context-rag.md` §7）：

1. **第一段·获取上下文 Session（侦察段）**：
   - 预插**基础命令使用规范（查询 Skill）+ 顶层目录 Index（Service Catalog 货架标签）**；
   - 先按任务 Tag 细粒度触发 `TagCtxShard[tagType:tag]` 缓存分片（可动态调整 `takeBudget`）；
   - 仅对未命中/stale 的差量 Tag 调用检索命令拉取：完整 Tag/TagRule、四族对象（Rule/Doc、Scheme、Provider、ServiceDesc）、近期关联 Event、**近期相关 Session（`SessionLog` / `ContextNotes`）**，以及各对象 `importance (0-100)` 与 `Relevance(A, B) (0-100)`，产出 `ContextPack`。
2. **第二段·任务执行 Session（执行段）**：
   - **会话自复用（保 Prefix KV Cache）**：多轮对话始终复用本 Session，按需触发任务缓存并支持中途动态增量更新（JIT 调用 `context.find/expand`）；
   - 记录每个引用块的真实归因轨迹（`used_effective / queried_irrelevant / missed_in_phase1`）；
   - 执行完毕立即返回响应并发出 `SessionClosed` 事件（零主链路等待）。
3. **第三段·总结与演化 Session（异步后台段 + 独立审核 Agent 裁决）**：
   - 由 `SessionClosed` 异步拉起，固定产出三项草案：①对真实阻塞/冲突/不一致提 **Proposal**（先跑 `Relevance ≥ 85` 查重合并）；②**正向归因裁剪**生成/补充 `TagCtxShard` 与会话缓存；③**防同质任务刷分的 Importance / TagRelevance Rerank**（叠加跨任务多样性折扣 $w_{\text{div}} = 1 - \max_{j<i}\text{Relevance}(T_i,T_j)/100$ 与界面人类评论因子 `humanScore`）；
   - **独立审核 Agent（Judge Agent）闸门**：总结草案不直接 Apply，必须经另一独立审核 Agent 校验归因证据与同质任务相关性通过后才落库。

| 工具 | 参数 | 返回 |
|---|---|---|
| `context.find` / `search-sessions` | `{query, tags?, kinds?, includeRecentSessions?, takeBudget?, page?}` | 列表 `[{ref, hash, title, digest, importance(0-100), relevance(0-100), rankScore(0-100), ts}]` + relatedTags |
| `context.pack` | `{query, tags?, takeBudget?}` | 优先触发 `TagCtxShard` + 差量装配 `ContextPack`（`takeBudget` 动态可调） |
| `context.expand` / `get-object` | `{ref}` | 按 `ref+hash` 句柄拉取章节或全文 |
| `context.relevance` | `{entityA, entityB}` | 全局相关性 `Relevance(A, B) ∈ [0, 100]` 及分项拆解 |

### 5.3 索引与缓存实现

- 文档权威在 SQLite `docs DB`（R-DOC-7）；索引与 `TagCtxShard` 物化在 `ops DB`（可丢弃可重建）；
- 排序、非对称覆盖率计算、跨任务多样性折扣 $w_{\text{div}}$ 均为引擎确定性公式（`context-rag.md` §4）。

## 6. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 记录被 Agent "忘了写" | ⚠️ 中 | dsh 宿主在会话收尾强制生成（框架层，不靠自觉）；缺档=drift |
| 会话级粒度太粗 | ⚠️ 低 | 相位级为可选配置；先粗后细 |
| 进程数增长 | ⚠️ 低（已接受） | R2 明确接受；看门狗回收僵尸 |
| 打标质量不稳定 | ⚠️ 中 | LLM 评判重要度/摘要可能失真 | 提示词可编辑+评判从简（1-5 档）；错标靠迭代查找兜底（§5.3） |
| 检索导入过多 | ⚠️ 低 | 一次拉爆上下文 | 强制分页（默认 10/页，上限 50）+列表不给全文+迭代轮次上限 |
| tag 词表漂移 | ⚠️ 低 | 各 agent 自造 tag 失控 | tag 词表随 service 域管理（global 内置+前缀自治，同 capabilities 思路） |
## 7. 会话活性与停滞处置（KI-003 落地形态 + 底层 Heartbeat 事件默认隐藏 + Event Scope 门控）

- **底层心跳事件（`Heartbeat`）一等建模与默认隐藏（event.md 规则 18）**：会话推进点（相位推进/工具调用完成/产物落盘任一）除更新 `session_heartbeat` 行外，周期心跳建模为一等事件 `Heartbeat`（`tier: infra`，`visibility: default-hidden`，`defaultLevel: debug`）；`Heartbeat` 与 `ReconcileTick`、`SessionHealed`、`LongTaskRunning` 均属底层 `infra` 事件，**默认不在 Console 事件流、工作台事件片、关注报告（AttentionReport）及第一段侦察「近期相关事件」中展示**（仅当调试视图显式开启 `showInfra=true` 时可见），而异常失活事件（`SessionStalled`、`HeartbeatLost`）属 `tier: attention` + `default-visible`，默认立即上屏；
- **Event `scope` 区分与 Agent `eventScopes` 边界校验（event.md 规则 19）**：每条 Event 必带四层 `metadata.scope`（`builtin | global | systems/<s> | systems/<s>/instances/<i>`）；每个 Agent 通过 `spec.eventScopes` 声明可处理的事件 scope 范围（ServiceAgent 缺省锁定本 Service 及所属 Instance，子 Agent $\subseteq$ 父 Agent），派发与消费双侧强制校验 `event.metadata.scope ∈ agent.spec.eventScopes`；
- **watchdog**：装配层定时器（阈值可配，缺省 10m）超时合成 `SessionStalled`（复用合成死信机制；过阶段门 + dedup，同 session 同窗至多一条）；
- **自愈固定顺序**：先注入固定 prompt「继续」（保留上下文，不重启）→ 恢复记 `SessionHealed`；仍无心跳 → 诊断（最后工具调用/日志/等待对象/权限面）→ 权限类产 `ApprovalNeeded` 向上提交；人工类按 bind 用户已配置通道上报（未配置=不 notify 仅页面展示，notification.md 规则 6；外发 dedup 窗口内至多一封）；长任务类产 `LongTaskRunning`（任务名/已运行/阶段/决策点），结束回收；
- **分工**：外部巡检只做确认与兜底，不代替系统判定；同会话连续自愈无效达阈值（缺省 2）→ 停手升级；
- **判据**：注入停滞 → `SessionStalled` 在账且注入「继续」后恢复；权限阻塞 → `ApprovalNeeded` + 送达；人工 → bind 邮件（dedup 窗口内至多一封）；长任务 → `LongTaskRunning` 且无停滞误报。

## 8. 实现落点（loop-56，KI-003 实现收口）

| 面 | 落点 |
|---|---|
| 心跳账面 | ops DB `session_heartbeat` 表（ops-log.md §2 v0.54 行）：session/ts/phase/last_action/task_name/long_task/heal_attempts/healed_at/state/updated_at；upsert 即续租（watchdog 扫描键=updated_at）；进程内计数=观测面（Heartbeats 投影 heartbeats 键） |
| 心跳注册 | `POST /v1/sessions/heartbeat`（cored-bridge.md §2.3 v0.54；写面门控=--allow-apply 同开关）——会话侧推进点上报 `{sessionId, phase, lastAction, taskName?, longTask?}` |
| 查询面 | `GET /v1/sessions`（恒开）：`{count, sessions:[{sessionId, state, phase, lastAction, taskName, longTask, healAttempts, heartbeats, involved, lastBeat, healedAt}], watchdog:{enabled, interval, stallThreshold, healRetryLimit}}`——**state 词=suspected-stall 判定态词 SuspectedStall 的 DB 词形**（event.md 规则 14b 判定/事件词分立） |
| 判定面 | cored 装配层 watchdog（`internal/sessionliveness`，`--session-watch-interval`；0=关断零事件零扫描）——`--stall-threshold` 缺省 10m（event.md 规则 14②）；updated_at < now-threshold=停滞候选；**状态迁移不续租**（watchdog 自身翻转不算心跳，停滞行不逃扫描池）；注册表闸门前置（SessionStalled 未注册=stderr `unregistered` 不启动） |
| 合成事件 | SessionStalled（error，dedup=`session:<id>`，route=root-agent+notification/*——cc 旁路 bind 通知）/SessionHealed（info，dedup=`session-heal:<id>`）/LongTaskRunning（info，dedup=`longtask:<id>`）/ApprovalNeeded、Escalate（复用既有注册类型）——source 恒 core，与注入同主干零旁路 |
| 自愈第一动作 | 注入固定 prompt「继续」（装配层 SelfHeal 执行面；dsh 宿主=plugin 侧 sessionController.prompt 软出现面）；注入留痕=行 phase=inject-continue；注入失败继续上报绝不静默（HealAttempts=0 下一拍重试第一动作=重试不是跳步）；心跳重现=恢复记 SessionHealed 且连败计数清零 |
| 诊断分诊 | 权限类→ApprovalNeeded（向上提交不自行绕过）；人工类→bind 已配置通道（未配置任何通道=不 notify 仅页面展示，零外发）；长任务→LongTaskRunning 显式汇报（有进展心跳=不判停滞；结束回收=恢复出池） |
| 升级链 | 人工路连续自愈无效达 `--heal-retry-limit`（缺省 2）→ 合成 Escalate + 行态 escalated 停自动处置（不静默重试） |
| 自愈注入执行面（v0.56 R-10 真实接线——console-adoption.md §1.30 / workflow-runtime.md §11.6） | `SelfHealBridge`（Bounce/InjectWord——cored 唯一依赖方向）+ `Watchdog.SetSelfHealBridge` 装配：dsh plugin `mountSelfHealBridge` loopback listener（`POST /selfheal/bounce`）→ `sessionController.prompt(mode=queue)` 注入固定 prompt「继续」（cored `--self-heal-word` 单点声明同值；注入词不被远端改写）；cored 经 env `CORE_SYSTEM_SELFHEAL_ADDR` 回填——env 未设=纯观测词形不变（healed-self 恢复判定照旧）；注入受理=BeatSource 观测续租落行（last_action 带 inject 词形）**不触发 SessionHealed**（恢复判据=会话侧真实推进心跳 healed-by-beat，attempts 清零）；失败=err 返回照实上报绝不静默（行态保持 suspected-stall，下一拍重试第一动作=重试不是跳步）；**心跳防伪**=POST /v1/sessions/heartbeat 拒收 source=watchdog（判定面自续租禁入——心跳面唯一口径）；红线=注入只对「已判停滞的会话」发固定 prompt（桥零自主判定零定时器零队列），不新增任何自动任务/自动执行面 |
