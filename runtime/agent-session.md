# 运行时设计 6：Agent Session 记录制与 AUTOLEVEL（R2 / A29–A31）

> 概念依据：core_system/concepts/agent.md v0.3。R2 裁决：**没有**"Agent 一切写操作经 Apply，违者 Policy 拒绝"这条规则；治理换轨为**记录制 + 分级制**。

## 1. PlanDoc / SessionLog（记录在 ServiceInstance）

Agent 的运转不留白：**每一次 PLAN、每完成一次 Session，必须记录文档，记在该 Agent 所属的 ServiceInstance**（docType 见 core_system/doctypes）。

```
systems/<s>/instances/<i>/docs/
  plan-<ts>-<task>.md      # PlanDoc：意图、引用的 TaskScheme/Workflow、预算、dry-run 结果
  session-<ts>-<id>.md     # SessionLog：相位迁移、docsLoaded、动作摘要、outcome、token/耗时
```

- 触发：dsh 会话结束（或每相位迁移——粒度"看实现"，v1 建议**会话级**，相位级列为可选）+ `SessionClosed` Event。
- 写入：走 Apply（存储机制），fieldManager=该 agent——**这是事后留痕，不是逐写审批**。
- 对账：Instance 缺 PlanDoc/SessionLog = drift（Loop 检查，docType required）。
- 价值：回放（态机可审计）、上下文压缩（下轮会话先读近期 SessionLog 而非全量）、漏读检测（docsLoaded 与 L0 清单比对）。

## 2. AUTOLEVEL 落地

| 级别 | 运行时行为 |
|---|---|
| `ask` | Planning 完成后挂起 → control plugin 发 ApprovalNeeded → 上级 agent（默认上溯 root）批/驳回；对象有 Bind 时 role 持有者同达（双通道，A35；驳回也产 SessionLog） |
| `auto` | 白名单/Scheme/预算内直跑；Policy 高危仍拦（Policy 与 AUTOLEVEL 正交：级别管"问不问"，Policy 管"许不许"） |
| `all` | 不询问；仅显式授权 + Policy 放行 |

默认（scheme.yaml runtime.autoLevels）：**RootAgent=ask，ServiceAgent=auto**——均为默认值；**RootAgent 与普通 Agent 同一 AUTOLEVEL 机制，autoLevel 均可配置，Root 也可 auto/all**（A64，all 需显式授权）。升级路径：模型变强 → Desc 调 autoLevel（Apply+Policy）→ 自治空间变大，机制不变（P8）。

## 3. 子 agent（机器级进程）

- spawn：父进程经 control plugin `spawn machine-instance` 起独立子 agent 进程（一 agent 一进程；明确不省内存，R2）。**子 agent 运行时不限于 dsh**（A60）：dsh / opencode / 自写 agent 均可，选型与其工具环境在该子 agent 引用的 ConnectorOps 中描述或调用。
- 上下文：子 agent 不继承父会话内存；靠 PlanDoc/SessionLog/引用的 ConnectorOps 描述环境与工具。
- 权限：父权限裁剪（只减不增）；直控三原语（dispatch/interrupt/query）全程 ops DB 留痕。

## 4. Skill 缓存（v0.6，A38）

Agent 会话的工具上下文 = Provider.llmPrompt（出厂说明书）+ **Skill**（工具使用处的缓存：注入提示+成功调用示例）。Session 成功调用后自动沉淀 Skill（阈值见 open-questions）；下次同类任务按需注入，不必重学。规则：**Skill 是缓存不是真相**——与 Provider 契约冲突即失效；provider 版本变更默认作废；示例脱敏。console 资源树把 Skill 列为一类节点。

## 5. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 记录被 Agent "忘了写" | ⚠️ 中 | dsh 宿主在会话收尾强制生成（框架层，不靠自觉）；缺档=drift |
| 会话级粒度太粗 | ⚠️ 低 | 相位级为可选配置；先粗后细 |
| 进程数增长 | ⚠️ 低（已接受） | R2 明确接受；看门狗回收僵尸 |
