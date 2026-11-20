# 运行时设计 2：dsh 基座与 Plugin（R1.2.1 / R1.5.1）

> 概念依据：core_system/concepts/plugin.md。

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
- **root 直控**：root 的 control plugin 对子 agent 有 dispatch（派发）/interrupt（中断）/query（查询）三原语；子 agent 之间不互控。直控全程写 ops 日志（审计），高危直控过 Policy。

## 2. 首批四插件

| 插件 | 住哪 | 职责 | 权限 |
|---|---|---|---|
| `control` | root | 直控通道三原语、子 agent 生死（HeartbeatLost→重启） | 写：agent 任务区 |
| `console` | root | 总控界面（见 console-ui.md）：资源树/信息流/对象详情 | 只读全库 + 写审批动作 |
| `exec-local` | 各子 | 本机命令执行（build/install 的执行手） | 命令白名单模板 |
| `reporter` | 全部 | Status/Event/DriftReport 上报 | 写：status 区 |

插件契约五方法（init/onEvent/dispatch/report/shutdown）见 concepts/plugin.md §1。

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
