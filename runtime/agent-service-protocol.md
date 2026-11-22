# Runtime — Agent↔Service 沟通协议（完整设计）

> 概念依据：concepts/agent.md"一个 Service 一个 Agent"。本文件定协议：意图怎么下发、上下文怎么预插入、session 怎么界定、运行中文档怎么动、记忆放哪。
> 原则：**直接复用既有机制**（docs 按需加载、Apply、Ref、Memory DocType），不发明第二套通信栈。

## 0. 总图

```
Workflow 引擎 / root agent
   │  dispatch(intentEnvelope)            ←协议入口①
   ▼
ServiceAgent（一个 Service 一个）
   │ ② 上下文预插入：Service 资源目录+关系摘要（catalog）自动注入
   │ ③ Agent 自行导入：按 catalog 点名加载 docs（docs权限系统.onDemand）
   │ ④ 处理：一意图=一 session；运行中可 提议更新文档 / 提交 Ref / 写 Memory
   │ ⑤ 回报：report(result) + Status 回写（fieldManager 分持不变）
   ▼
Service 文档域（Docs：Goal/Rule/ImplDoc/…/Memory/Ref 记录）
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

- **Service 内 Agent 信息不隔离**：不做 SubAgent 级信息墙——ServiceAgent 自己判断读什么、派什么、给子 agent 看什么；
- 权限复用既有机制：Agent 权限面=ConnectorOps+Ref+Provider+Role 并集，权限系统裁剪；**子 agent=父一次性全量下发**（⊆父，只减不增不变量不放松；不做按步骤细粒度裁剪；运行时缺权限直接 ask 上级，上级重新全量申请整包重发）；
- catalog 注入同样过权限判定（无权限的对象不出现在 catalog）。

## 6. 可行性

| 项 | 评级 | 说明 |
|---|---|---|
| envelope 字段演进 | ✅ | Scheme 注册+可选段扩展，无版本断裂 |
| catalog 生成成本 | ⚠️ 低 | 索引查询已有（console 同源）；摘要缓存随 ops DB |
| "记忆即文档"检索 | ⚠️ 有条件 | v1 靠 catalog+规则导入；语义检索后补索引，不改契约 |
| 一意图一 session 的重入 | ✅ | taskId+断点机制已有（agent-session.md） |
