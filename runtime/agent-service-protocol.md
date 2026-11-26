# Runtime — Agent↔Service 沟通协议（完整设计）

> 概念依据：concepts/agent.md"一个 Service 一个 Agent"。本文件定协议：意图怎么下发、上下文怎么预插入、session 怎么界定、运行中文档怎么动、记忆放哪。
> 原则：**直接复用既有机制**（docs 按需加载、Apply、Ref、Memory DocType），不发明第二套通信栈。

## 0. 总图（对齐三段式 Session，R-CTX-4）

```
Workflow 引擎 / root agent
   │  dispatch(intentEnvelope)            ←协议入口①
   ▼
ServiceAgent（一个 Service 一个）
   │ ② 【第一段：获取上下文 Session（侦察段）】
   │    - 预插入基础命令使用规范（查询 Skill）+ Service 资源目录摘要（catalog Index）
   │    - 按任务 Tag 优先触发 TagCtxShard 缓存分片（提取大小 takeBudget 可调）
   │    - 仅对未命中/stale 的差量 Tag 调用检索命令拉取 Tag/TagRule/四族/Event/近期相关 Session
   │ ③ 【第二段：任务执行 Session（执行段）】
   │    - 一意图=一逻辑 Session；多轮对话始终复用本 Session（保 Prefix KV Cache）
   │    - 按需触发任务缓存 + 动态增量更新（JIT）；记录真实引用归因轨迹
   │    - 回报：report(result) + Status 回写 + SessionClosed 事件（立即返回，零主链路等待）
   │ ④ 【第三段：总结与演化 Session（异步后台段 + 独立审核 Agent 裁决）】
   │    - 异步复盘：不合理处提 Proposal（先查重 Relevance ≥ 85）+ 正向归因补缓存 + 防刷分 Rerank
   │    - 经另一独立审核 Agent（Judge Agent）+ 界面人类评论因子（humanScore）裁决通过后 Apply
   ▼
Service 文档域（SQLite docs DB 权威 + 定时导出 Git：Goal/Rule/ImplDoc/…/Memory/Ref + CtxCache）
```

## 1. 协议①：意图下发 envelope

```yaml
intent:
  id: {taskId, dedupKey}
  source: {workflow: dev-delivery | agent: root | human: console}
  kind: incident | feature | question | verify | custom
  payload:            # 意图本体（错误日志/需求描述/问题）
    text: "..."
    evidenceRefs: [...]   # 相关 Event/文档/指标的引用（可空）
  context:            # ② 预插入（见 §2）
    catalog: <service-catalog-digest>
    hints: [...]          # 派发方建议先读的对象（可空，Agent 不必听从）
  grants: {tokens: [...], refs: [...]}   # 上级一次性全量下发的权限（token+ref 整包；运行时缺权限 ask 上级重发，见 workflow.md §7）
  autoLevel: ask|auto|all
  replyTo: {ops-channel}    # 结果回报通道（workflow 相位/根 agent/人）
```

约定：envelope 全部字段可缺省（最小={id, source, kind, payload}）；字段语义由 Scheme 注册（`agent-protocol` Scheme），扩展=加可选段，不改协议版本。

## 2. 协议②：上下文预插入（catalog）

派发前，Service 侧自动生成**资源目录摘要**（catalog digest）随 envelope 注入：

- Service 的 Goal/Rule ruleId 清单、Instance 状态灯、WorkService/ConnectorOps 清单、最近 DriftReport 标题、活跃 Workflow——每项**一行概要+引用句柄**（可点/可拉）；
- 生成方式：core 的索引查询（数据全部来自 Scheme+ops DB，与 console 树同源）；
- **Agent 自行导入**：catalog 只是"货架标签"，Agent 根据意图挑选拉取全文（按需加载机制不变，SessionLog 记 docsLoaded 可审计）。

这解决"全量塞不下、空手又盲目"：预插入的是地图，不是地图上的每个房间。

## 3. 协议③：session 生命周期（一个意图=一次 session）

```
session := intent(id) 开启 → 处理（可多轮工具调用/文档读写）→ intent 终态关闭
  ├─ 记录：SessionLog（docsLoaded/actions/outcome）落 ServiceInstance
  ├─ 断点续跑：同 taskId 重开=延续 session（幂等重入）
  └─ 新意图=新 session（不跨意图复用会话状态；延续靠 Memory 文档，不靠会话）
```

## 4. 协议④：运行中的文档操作（全部走 Apply）

| 动作 | 载体 | 说明 |
|---|---|---|
| 提议更新文档 | Proposal → Apply（P6） | 运行中发现 Spec 要改，生成提案进待审；**理论上都应落在 Docs 中**——不写私账 |
| 运行时提交 Ref | Ref 对象 Apply | 解析到的新资源随手入册（resolver system 回写真实地址） |
| 写记忆 | **Memory DocType** | 经验/偏好/上下文延续以文档存 **Service 文档域**，随 docs_operator（git）管理；下次意图由 catalog 引导自行导入 |

**记忆系统 = Service 的文档管理**（强调）：不建独立记忆库/向量库；记忆就是 Docs 的一种 DocType，享受同等的版本/权限/对账。检索=catalog 摘要+按需拉取，后续要语义检索再加索引组件（不改变"记忆即文档"）。

## 5. 协议⑤：信息与权限（不隔离，复用判定）

- **Service 内 Agent 信息不隔离，但跨 Service Event Scope 严格隔离（event.md 规则 19）**：同一 Service 内不做 SubAgent 级信息墙——ServiceAgent 自己判断读什么、派什么、给子 agent 看什么；但**事件派发与消费严格按 Event `metadata.scope` 与 Agent `spec.eventScopes` 校验**（ServiceAgent 只处理本 Service 及其 Instance scope 内的事件；底层 `Heartbeat` / `ReconcileTick` 等 `tier: infra` 事件默认 `visibility: default-hidden` 不混入常规事件流与第一段侦察）；
- **`ServiceDesc` 与 `ServiceInstance` 设计↔实现文档 1:N `[metadata 关联]` 追踪（R-DOC-9）**：1 篇 `ServiceDesc` 设计文档可对应 N 篇 `ServiceInstance` 下的 `ImplDoc` / `VerifyDoc`。各 `ImplDoc` / `VerifyDoc` 在 frontmatter `metadata.trace` 与 `<doc>.md.metadatainfo` 侧车中声明 `trace.implements` / `trace.verifies`，由 `DocIndex` 自动反向聚合至设计文档的 `trace.implemented_by` / `trace.verified_by`（1 对 N 追踪列表）；设计文档版本推进时自动将下游 N 篇实现文档标为 `stale` 并驱动对账；
- 权限复用既有机制：Agent 权限面=ConnectorOps+Ref+Provider+Role 并集，权限系统裁剪；**子 agent=父一次性全量下发**（⊆父，只减不增不变量不放松；不做按步骤细粒度裁剪；运行时缺权限直接 ask 上级，上级重新全量申请整包重发）；
- catalog 注入同样过权限判定（无权限的对象不出现在 catalog）。

## 6. 可行性

| 项 | 评级 | 说明 |
|---|---|---|
| envelope 字段演进 | ✅ | Scheme 注册+可选段扩展，无版本断裂 |
| catalog 生成成本 | ⚠️ 低 | 索引查询已有（console 同源）；摘要缓存随 ops DB |
| "记忆即文档"检索 | ⚠️ 有条件 | v1 靠 catalog+规则导入；语义检索后补索引，不改契约 |
| 一意图一 session 的重入 | ✅ | taskId+断点机制已有（agent-session.md） |
