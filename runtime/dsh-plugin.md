# 运行时设计 2：dsh 运行时（实现说明，非系统概念）

> **v0.9（A43）：系统本身没有 Plugin 概念**——本文件是"我们如何用 dsh（deepseek 插件机制的外部运行时）实现系统"的说明。core 以 dsh plugin 实现（A39）。

## 1. 拓扑

```
builtinRoot（root agent）
  │  dsh + [control, console, reporter]
  │  control plugin ──直控通道──┐
  ▼                            │
dsh agent（每系统/实例一个基座）◀┘
  dsh + [exec-local, reporter, console-client]
```

- **基础 agent 是 dsh**：Agent 运行时=dsh 进程+插件集；不引入第二个 agent 框架。
- **子 agent 是机器 instance 级独立进程**（A31，R2 明确"不要管浪费内存"）：dsh agent 派发子 dsh agent 时 spawn 独立进程，**不是 dsh 内部 subagent**——崩溃隔离、可直控、无共享状态。简单任务派发走 simple-shot Workflow；子 agent 用什么（工具/环境）在其引用的 ConnectorOps 中描述（v0.3 拆分）。
- **root 直控**：root 的 control plugin 对子 agent 有 dispatch（派发）/interrupt（中断）/query（查询）三原语；子 agent 之间不互控。直控全程写 ops 日志（审计），高危直控过 Policy。
- **AUTOLEVEL 默认（A30）**：RootAgent=ask（无上级→问 Bind 的人）、ServiceAgent=auto（Scheme+预算内自动）；all 需显式授权。级别写在 Agent.spec.autoLevel，变更走 Apply+Policy。
- **文档按需加载**：Agent 自己按需加载文档，由 dsh 本次会话自实现（docsPolicy.onDemand）；Loop 只注入 L0 最低必载（Goal.acceptance+Rule 摘要）。SessionLog 记录 docsLoaded，可审计"读了什么"。

## 2. 首批四插件

| 插件 | 住哪 | 职责 | 权限 |
|---|---|---|---|
| `core` | dsh 宿主 | **承接 Core 控制面**（A39）：Apply/Event 分发/Loop 引擎/Scheme/Policy/ops DB；界面=console | 文档面读写（唯一写路径） |
| `control` | root | 直控通道三原语、子 agent 生死（HeartbeatLost→重启） | 写：agent 任务区 |
| `console` | root | 总控界面（见 console-ui.md）：资源树/信息流/对象详情 | 只读全库 + 写审批动作 |
| `exec-local` | 各子 | 本机命令执行（build/install 的执行手） | 命令白名单模板 |
| `reporter` | 全部 | Status/Event/DriftReport 上报 | 写：status 区 |

dsh 侧的模块（core/console/exec-local/reporter 等）按 dsh 自身的插件机制组织，契约以 dsh 生态为准——不是我们系统的概念。

## 3. 交互序列（一次派发）

```
Loop引擎 ─dispatch(task)─► root.control ─dispatch─► sub.exec-local
   ▲                                          │
   └────────────report(result)────────────────┘   (reporter 上报，ops DB 留痕)
失败：sub.reporter → root.control(interrupt) → Loop 走 onFailure
```

## 4. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| dsh 单进程插件连坐崩溃 | ⚠️ 低 | root 看门狗重启；任务幂等重入 |
| exec-local 白名单维护成本 | ⚠️ 中 | 白名单模板按系统注册（developer 的 gradle/maven 常用集），Policy 审新增 |
| 直控与 Loop 双头指挥 | ⚠️ 中 | 规则：直控只能下发/中断"Loop 已派发或模板库内"的任务；新任务必须走 Loop（审计可见双轨） |
