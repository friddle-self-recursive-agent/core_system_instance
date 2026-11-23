# 运行时设计：dsh 跨 agent 调用（R2.2 研究结论）

> 问题：深层 agent 之间跨 agent 调用有没有现成机制？基于 dsh 插件能不能做？
> 结论：**能，dsh 原生支持，无需 fork**。材料：`@deepseek-ai/dsh-agent`（Agent handle / live registry / initiator scope / agent/* 事件词汇）+ `dsh-agent-workflow`（驱动）+ typert 远程协议。

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

## 5. 跨 Agent 协议 v0.1（最简，走 ConnectorOps agent-comm）

> 定位：**本节只定最小信封与四个原语**；真实运行起来后再一层层补设计与 Scheme（见 5.5 分层补充计划）。
> 与 agent-service-protocol.md 的边界：那是 **Agent↔Service**（一个意图=一次 session 的服务调用，envelope 带 catalog/context/grants 整包）；本节是 **Agent↔Agent 对等消息**（无 session 机器）。两者不混用、不互译；人经 console 发起的会话走直控面，不经本协议。

### 5.1 信封（envelope v0.1）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `v` | string | 是 | 协议版本，恒 `0.1` |
| `id` | uuid | 是 | 消息 id（幂等键；inbox 按 id 去重） |
| `ts` | RFC3339 | 是 | 发起时间 |
| `from` / `to` | agent ref | 是 | 格式 `agent/<name>@<scope>`；`to` 必须是已注册 agent（无服务发现，解析失败即拒） |
| `kind` | 枚举 | 是 | 四原语 `dispatch \| query \| interrupt \| inbox`；回执消息复用同一信封，`kind: reply`（见 5.2，非原语） |
| `payload` | object | 是 | 自由对象，**v0.1 不定 schema**（最小信封={v,id,ts,from,to,kind,payload}） |
| `refs` | string[] | 否 | 指向文档面的对象引用（`systems/<s>/path#revN`），接收方按需加载 |
| `token` | string | dispatch 必带 | 权限 token，⊆ 发起方权限面（上级整包下发，workflow.md §7） |

示例：

```yaml
v: "0.1"
id: "0195d8f2-7a3b-7c41-9e2a-51f0c3b8a7d4"
ts: "2026-11-23T10:12:30Z"
from: "agent/dev-delivery@systems/core_system"
to: "agent/ci-repair-agent@systems/developer-system"
kind: dispatch
payload:
  text: "修复 ci 门禁红灯：<run-url>"
  hint: "先看最近一次 verify 失败原因"
refs:
  - "systems/developer-system/impl/developer-system.md#rev12"
token: "tok_…（scope 列表随 token 携带，⊆ from 权限面）"
```

### 5.2 四原语语义

| kind | 语义 | 同步性 | 回执 |
|---|---|---|---|
| `dispatch` | 派任务（一次意图；比 service 协议 envelope 薄——不带 catalog/context/grants 段） | 异步 | 对端回 `kind: reply` 消息，或查其 SessionLog |
| `query` | 只读问询（状态/文档/能力） | 同步语义（发起方等待返回） | 响应即回执（复用信封，kind=reply） |
| `interrupt` | 取消/插话（对应 dsh `cancel`/`steer`） | 异步 | ops 日志留痕即回执 |
| `inbox` | 拉取未消费消息（接收方向；按 id 幂等去重）——对等场景没有共同上级替你翻 SessionLog，拉取是唯一入口 | 同步 | 返回消息列表 |
| `reply`（非原语） | 回执方向消息；失败也用它：`payload.error` + Event，**不自动重试** | — | — |

权限规则：

- 无 token 的 dispatch 一律拒绝（接收侧硬规则，拒绝同样入 ops 日志）；
- token 必须 ⊆ 发起方权限面——**上级一次性全量下发**，workflow.md §7 委派模型原样沿用（缺权限 ask 上级整包重发，不做细粒度裁剪）；
- query/interrupt/inbox 不强制 token（对等面信任已注册发起方），全部经 ops 日志双轨留痕。

### 5.3 传输：一个挂载面，两种底层

| 场景 | 底层 | 说明 |
|---|---|---|
| 同机 | 进程内注册表（dsh `ctx.agents`） | §1-§3 父子机制原样承载四原语 |
| 跨机 | typert 网关 | **显式携带 initiator**（§3 既有结论不变），ops 日志校验来源链 |

**对 agent 而言统一呈现为一个 ConnectorOps 挂载（agent-comm），不暴露两套接口**——同机/跨机差异被挂载面吃掉，agent 只见四个 op：

```yaml
apiVersion: core/v1
kind: ConnectorOps
metadata:
 name: agent-comm
 scope: global
spec:
 workservice: agent-comm # tool 型 WorkService（本机工具也是一种服务）
 workflow: default-task
 ops: [dispatch, query, interrupt, inbox] # 四原语即 op 集
```

### 5.4 v0.1 不做（明确负债清单）

| 不做 | 替代 |
|---|---|
| 事务/重试语义 | 失败=发一条 `kind: reply` 的 error 消息 + Event；重试是 Workflow `onFailed` 的事，不进协议 |
| payload schema | 自由对象；inbox 侧容错（未知字段忽略不拒收） |
| 服务发现 | `to` 必须是已注册 agent ref；解析失败即拒（Event 报未注册） |
| 加密 | 内网信任域；凭据不进 payload（token 字段承载，账号走 Provider） |

### 5.5 分层补充计划

| 阶段 | 补什么 | 落点 |
|---|---|---|
| v0.1（本节） | 信封 + 四原语 + 权限规则 | 本文档 |
| v0.2 | reply 相关性（threadId/correlationId）、token 过期/撤销名单 | 本文档升级 |
| v0.3 | Scheme 化：kind 与必填字段进 core scheme.yaml 准入校验 | core 仓 scheme |
| v1 | 多跳委派链审计（initiator 链全量入 ops 日志并跨机校验） | ops-log.md 扩表 |

### 5.6 可行性

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 信封无 schema 被滥用 | ⚠️ 中（v0.1 接受） | payload 自由对象易堆私货、字段漂移 | v0.1 明确接受；inbox 侧容错 + refs/SessionLog 补可读性；v0.2 correlationId、v0.3 Scheme 准入按期收紧 |
| token 过期/撤销 | ⚠️ 中 | 长任务期间权限被收回，越权继续执行 | 接收侧每次调用校验；撤销走 Event+ops 日志；失效即拒并回 error reply（任务挂起 ask 上级整包重发） |
| 跨机 initiator 丢失 | ⚠️ 中 | 审计断链、责任无法归位 | 既有缓解沿用：网关显式携带 initiator；ops 日志校验来源链（§3 结论不变） |
| 与 agent-service-protocol 混淆 | ⚠️ 低 | 两份协议被实现串线 | 边界写死（见本节开头）：service 协议=一意图一 session 的服务调用；本协议=对等最小信封；实现上后者只是一个 ConnectorOps 挂载，无独立通信栈 |
| reply 无相关性字段时错队 | ⚠️ 低 | 多会话并发时 error 归错任务 | v0.1 靠 SessionLog 顺序归档；v0.2 threadId/correlationId 偿还 |

**结论：可行。v0.1 用"最小信封+四原语+一个挂载面"把跨 agent 通道立起来，全部简化都是列在账上的有意负债，按分层计划偿还——先跑通，再收紧。**

### 5.7 dsh 映射决定（0.2.2-rc.5 实测，2026-11-23）

> 研究源：宿主包 docs（subagent/terminal/typert/web-client）、node_modules `@deepseek-ai/dsh-agent` 等全套 .d.ts（0.1.5-rc.2）、npm 包 dsh-subagent/-claude-code/-dsh-sdk/agent-presets/api-session-controller/api-terminal-controller/api-remote-access/client-ui-agent-team（0.0.1-0.2.2 rc/alpha）。事实表与决策过程略，此处只落终态。

| # | 决定 | 依据 |
|---|---|---|
| 1 | **Agent 身份=SessionId**（dsh 原生不变量）。ServiceInstance.agentRefs 存 dsh sessionId；`agent/<name>@<scope>` 是文档面地址，由 console 解析成 (host, sessionId) | typert wire 身份=SessionId（TypertLookupMap.agent=Lookup<Agent,SessionId>）；无名称 URI 语法 |
| 2 | **「与 Service Agent 对话」=** agentRefs 有 sessionId → `session.prompt(sessionId, requestId, queue\|steer)`（离线自动 cold-resume）；无 → `session.create({cwd: 该 Service 工作目录, agentPreset: <service-preset>})` 后回填 sessionId。浏览器不直接 spawn 子 agent（session.create 无 parent 字段）；需要真父子拓扑时再加控制面插件自定义 @Remote `services.spawnAgent(instanceId)`（内部 ctx.agents.create） | session-controller 生成 remote 面；SubagentRuntime 的 `subagents.prompt` 是 rc.5 补上的浏览器投递通道 |
| 3 | **Service agent 身份载体=preset 基座+setup 注入实例态**：preset（agent.cordis.yml 文件，随部署分发）承载该类 Service 的静态工具面；实例级文档面/权限由控制面插件在 `ctx.agents.create({setup})` 里 `mount(preset)` 后注入。preset 创建时锁定（agent-preset-locked），实例态变更=新会话 | preset 无插件内联注册 API（仅目录发现）；setup 是唯一合法挂载点；dsh-subagent 权威注释要求工具集可从日志重建 |
| 4 | **四原语 ↔ dsh 原语对照**：dispatch↔`followup`（或 subagents.prompt delivery:queue）；query↔`inject`/只读查询；inbox↔`subagents.prompt` delivery 语义+SessionLog 投影；interrupt↔`cancel`/`interruptByUser`（user authority 恰好对应 trusted-host 通道）。信封增可选 `dsid`（目标 dsh SessionId）字段，v0.1 兼容不加版本 | 一一对应且语义无损 |
| 5 | **token 不落消息通道映射**：dsh 授权=Peer Principal + remote-access 每资源角色 + 连接级凭证（trusted-host/BasicAuth/piko token）。信封内 token 仅作我方端到端校验保留；通道安全借 dsh 既有层 | remote-access principal kind→policy→role→resource(session id)→action |
| 6 | **终端面=dsh 内置优先**：`remote.terminal.*`（真 PTY，每 session ≤8 路，scrollback 1000，进程活过浏览器 reload 不活过 owner disposal，TERM=xterm-256color）承载 opencode/claude-code 等 TUI；**gotty 降级为跨机场景**（ServiceInstance 在别的机器、或终端要独立分享给无 console 权限者时经 piko 暴露），不再作 console 默认终端 | dsh terminal 与会话同生命周期同鉴权，单机全面占优；gotty 价值在独立鉴权/跨机暴露 |
| 7 | **agent-team 是纯展示**（共享任务板+成员导航）：console 拓扑图数据源=subagentCatalog projection + listDescendants（pre-order，行带 parentId/depth/path），我方文档面拓扑与之并存（§3.7 裁决） | client-ui-agent-team README；无 lifecycle 控制面 |

> **console 解析落点（E5a 补注，2026-11-24）**：#1 的「文档面地址→(host, sessionId)」解析源=Agent 文档面 `status.currentSession.id`（console 在 `#/chat/:agent` 新建会话后经既有 apply 通路回填，fieldManager=`console:chat-backfill`）；agentRefs 的显式 `session://<id>` 形同样在册可解析。实现=console-adoption.md §1.11。
