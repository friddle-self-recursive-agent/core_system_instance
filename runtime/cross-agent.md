# 运行时设计：dsh 跨 agent 调用（R2.2 研究结论）

> 问题：深层 agent 之间跨 agent 调用有没有现成机制？基于 dsh 插件能不能做？
> 结论：**能，dsh 原生支持，无需 fork**。材料：`@deepseek-ai/dsh-agent`（Agent handle / live registry / initiator scope / agent/* 事件词汇）+ `dsh-agent-loop`（驱动）+ typert 远程协议。

## 1. 机制盘点（dsh-agent 0.1.5-rc.2 实测接口面）

| 能力 | API | 说明 |
|---|---|---|
| 建 agent | `ctx.agents.create({sessionId, agentOptions, setup, parentAgent})` | 返回 `AgentHandle`（唯一能 dispose 该 agent 的对象）；**`parentAgent` 一填即成 runtime child，不填是 runtime root**——父子关系是原生概念 |
| 恢复 agent | `ctx.agents.resume()` | 从持久化 session 重建（session 由 dsh-session 管） |
| 注册表 | `ctx.agents.list() / get(id) / roots() / isOwnedBy(id, parent)` | 本进程存活 agent 的查询面 |
| 驱动对话 | `handle.agent.followup()` / `steer()` / `inject()` / `cancel(cause)` / `whenIdle()` | followup=排下一轮、steer=插下一步、inject=只进上下文不唤醒 |
| 作用域组装 | `setup(agentCtx, agent)` | 给该 agent 挂 scoped tools/prompt sections/listeners，发布前完成（composition-only） |
| 跨进程 | typert 协议（`dsh-typert-protocol` Host/Client adapter）+ `dsh-api-gateway` + `dsh-api-remote-access` | initiator 归属是 process-local，跨 worker/进程/持久队列要**显式携带**；web profile 已带 gateway/remote-access 插件 |

## 2. 与本系统概念的对齐

| 本系统概念（concepts/agent.md） | dsh 机制 | 备注 |
|---|---|---|
| 子 agent=机器 instance 级独立进程（A31；**运行时不限于 dsh**，A60） | typert 远程通道 / 或对端机器上独立 agent 进程 | A31 是**部署形态**（崩溃隔离、可直控）；子 agent 运行时可为 dsh/opencode/自写 agent，选型经 ConnectorOps 描述；进程内 `ctx.agents` 父子注册表是同一台机上的第一实现步骤，两者不冲突：同机=进程内注册表，跨机=独立进程+显式 initiator 携带 |
| root 直控三原语 dispatch/interrupt/query | `followup`（≈dispatch）/ `cancel`（≈interrupt）/ `get/list`（≈query） | 原语一一对应，control plugin 可直接薄封装 |
| 派发简单任务 simple-shot | `create` + `followup` + `whenIdle` + dispose | 一次性问答即建即毁 |
| SessionLog 可审计（A29） | dsh-session 持久日志 + session-projection（inbox/turn 边界折叠） | 会话态机天然可回放 |

## 3. 落地路径（谁在什么时候用什么）

1. **MVP（现在）**：core plugin 内不起子 agent——循环引擎直调 provider HTTP（mvp/architecture.md §5）；跨 agent 面只留 console 的"开对话"入口（见 console-ui.md §服务关注区）。
2. **console 对话（下一步）**：服务详情页"与该 service agent 对话"= 在宿主内 `ctx.agents.create({parentAgent: rootHandle, setup: 挂该 service 的 tools/docs})` + `followup`；session 列表= `ctx.agents.list()` + dsh-session 记录。全部经插件可行。
3. **多系统/多机**：每系统一个独立 dsh 进程（A31），经 typert gateway/remote-access 互调；initiator 链显式进 ops 日志（审计双轨，dsh-plugin.md §4 的规则继续有效）。

## 4. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| rc 期 API 变动（dsh-agent 0.1.5-rc.2） | ⚠️ 中 | 只在插件层薄封装这组接口；fork dsh 仅当插件做不到时启动（R2.3 兜底，当前不需要） |
| 跨进程 initiator 归属丢失 | ⚠️ 中 | 网关转发显式携带 initiator；ops 日志校验来源链 |
| 父子 agent 连坐崩溃 | ⚠️ 低 | 跨系统仍按 A31 独立进程隔离；进程内父子仅限同机信任域 |
