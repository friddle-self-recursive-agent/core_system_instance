# Runtime — 多任务并发调度（TaskScheduler）

> 概念依据：core_design `concepts/task-scheduler.md`（R-ENG-5 / R-UX-9）。本文定义调度器、宿主 spawn 桥、工作区隔离、状态回写与任务中心数据面；**并发上限/依赖/写集/租约全部由 Scheme+Task 声明驱动**，不硬编码。

## 1. 拓扑

```
Task 对象（docs DB / sqlite）
  → cored TaskScheduler tick（依赖 DAG + touches 写集 + 上限）
  → ready 集 + 租约（leaseTtl）
  → 宿主 plugin POST /task/spawn {taskId, taskPath, workspace, agent}
  → 每任务一个 dsh core-headless session（独立 worktree/branch）
  → Task.status 回写（phase/agentSession/lastAction/lastError）+ TaskStateChanged 事件
  → 任务 Verify（code→connectops-code-audit；agent→agent）
  → 落地：文档=Apply；代码=合并队列（worktree → rebase/merge）
  → done / failed → 解锁依赖任务
```

- 调度器只做**选任务 + 限并发 + 拉起 + 状态**；执行/验证/落地全部复用既有 Agent/Apply/Verify。
- 宿主 spawn 桥与 `LoopRequested` wake 桥同族：固定命令/参数、载荷不进 shell、单飞、租约；`/task/spawn` 只监听 loopback。

## 2. Task 对象与状态写面

- Task 是文档对象（`kind: Task`，scheme 已注册）；`spec` 人写/上游写，`status` **只由调度器/执行体写**（P2）。
- `status.phase` 闭合集：`queued | ready | blocked | running | verifying | done | failed | canceled`。
- 每次状态迁移：写 Task.status（repository 系统写，fieldManager=`task-scheduler`）+ 发 `TaskStateChanged`（dedup=`task:<id>:<phase>`）。
- `status.agentSession` = 宿主会话 ID（用于任务中心 `#/session/:id` 深链）；spawn 受理后回填，会话结束/失败回调更新。
- `status.lastAction` = 一句话（人看）；`lastError` = 阻塞/失败原因（人看）。

## 3. 调度算法（每拍）

```
1. 读所有 Task（跨 scope；status.phase ∈ queued/ready/blocked/running）
2. 维护依赖：dependsOn 全 done → ready；有未完成依赖 → blocked（reason=依赖）
3. 冲突图：touches.repos/paths/objects 相交 ∨ exclusive 同值 → 互斥边
4. 选 ready 且与运行中任务无冲突、未超上限（global/perService/perRepo）的任务
5. 按 priority/等待时长排序，取 N 个 → 租约 → spawn
6. 租约过期/心跳停 → 回收（幂等重派，attempts+1；超 maxAttempts → failed）
```

- 默认 `maxConcurrent=4 / perService=2 / perRepo=1`；配置来自 `scheme.runtime.taskScheduler`，Apply 即时生效（调度器热读）。
- 同 repo 默认串行；放开 `perRepo` 需 worktree/合并队列同时满足。
- 队列积压与阻塞原因必须可见（任务中心/`/v1/objects/Task`），不静默等待。
- **孤儿租约认领（v0.67，loop-84）**：租约起点=进程内本轮拉起时刻——cored 重启后进程内租约清零，而 `status.phase=running` 留在仓库：只扫进程内租约会让孤儿 running 永不回收也永不重拉（attempts 恒 0、lastAction 恒「拉起中（spawn）」），且 running 计入现势占额阻塞全部后续派单（loop-82/83 活体实证：console-audit-20261126 自 14:13 running 悬挂 2h+，cored 14:21 换代 34643→38307）。补口=本进程首拍扫 `event_log` 归档取每任务最近一次 `TaskStateChanged` running 事件（dedup=`task:<id>:running` 机械键），在册视图仍 running 的认领为租约起点 → 走既有租约回收路（TTL 到点 ready+attempts+1 / failed 超上限）。审计事实=归档事件（可回查非凭空推断）；归档读口未装配=认领关断（既有行为面零翻转）；回归锚=workservice `internal/scheduler/orphan_lease_test.go`（L84-01，`-race` 绿）。

## 4. 宿主 spawn 桥

- 插件侧新增 `mountTaskSpawnBridge`（与 `mountWakeBridge` 同族）：
  - 端点：`POST /task/spawn`（127.0.0.1，随机端口；cored env `CORE_SYSTEM_TASK_SPAWN_ADDR` 回填）。
  - 载荷：`{taskId, taskPath, workspace:{mode,path,branch}, agent}`；**不拼 shell**，只把 `taskPath` 作为 stdin 输入给固定命令。
  - 单飞：`pgrep -f` 任务标识或锁文件；同任务不重复拉起。
  - 拉起：`dsh --profile <p> --permission-mode <mode> --approval-policy <ap> - < taskPath`——**权限档=显式配置非宿主脚本隐式全权**（2026-11-27 用户裁定）：mode 取值优先级=**Task.spec.permissionMode 覆写 > scheme `runtime.dshAgent` 缺省（scheme 作为配置修改 dsh-agent 行为，改 scheme 零代码）> default-dsh-agent/v1 契约声明（danger-full-access）**；调度器按 scheme 缺省写任务文件 `permissionMode` 字段，宿主 spawn 桥读字段+`runtime.dshAgent.allowedModes` 同源白名单校验（白名单外回落缺省）；approvalPolicy 缺省 never（headless 无人值守）；部署侧配置命令模板，公开仓只写机制。
  - 回执：`{ok,status:spawned|already-running,sessionHint}`；会话 ID 由执行体心跳/`Task.status.agentSession` 回填。
- 任务文件 `taskPath` 由调度器生成（Task.spec + acceptance + touches + worktree + 验证要求 + permissionMode），落部署侧临时目录；不进入公开仓。

## 5. 工作区隔离与落地

| 模式 | 适用 | 规则 |
|---|---|---|
| `worktree`（代码默认） | 代码/多文件任务 | 每任务独立 git worktree + `task/<name>` 分支；不得写 main；完成走合并队列（rebase→gate→merge）；冲突=blocked + 人可见 |
| `inplace` | 只读/文档/写集明确不相交 | 需写集互斥且 `perRepo` 允许；文档任务优先走 Apply |
| 文档 | 对象修改 | 直接 Apply（第一个任务 Apply 后，第二个任务在 Apply 关口 409 拦截 → 判断有无冲突 → 有冲突直接询问 **`pause-first` 暂停第一个任务** 还是 **`abort-current` 放弃当前任务**，严禁循环互踩） |

- 合并队列串行；同一写集的 task 永不并行；`touches.exclusive`（如 `deploy/prod`）同值互斥。
- 验证失败不得 done；重试上限后 failed + Escalate/通知，不拖垮无关任务。

## 6. 验证与任务完成

- Task 完成前必须过 Verify（R-TYPE-3）：
  - `mode: code` 规则 → `connectops-code-audit`；
  - `mode: agent` 规则 → 规则原文（ref+hash）+diff 丢给 agent，verdict+证据；
  - `human` 规则 → 审批/Gate。
- Verify 失败：`failed`/重试/升级；不得跳过、不得默认通过。
- done 判定：验证通过 + 落地成功（Apply/合并完成）+ `lastAction` 写清结果。

## 7. 数据面与页面

- Task 读面：`GET /v1/objects/Task`（list/get；status 投影）；任务中心 `#/tasks`、详情 `#/task/:id`（console-ui §16）。
- 会话：`Task.status.agentSession` → `#/session/:id`；会话头显示 Task/Workflow/节点/Run（或显式「会话型任务」）。
- 并发控制：任务中心顶部调整 `maxConcurrent/perService/perRepo`、暂停/恢复=Apply；排队原因显式。
- CLI（下一段）：`corectl tasks` / `corectl task <name>` / `corectl task submit -f` / `corectl task cancel`。

## 8. 判据（机读）

- 两个无依赖、touches 不相交的 Task → 同时 `running`，各自独立 session；
- 同 repo 两个 Task（默认 perRepo=1）→ 一个 running、一个 blocked/ready，原因可见；
- 依赖未完成的 Task → blocked（reason=依赖）；依赖 done 后自动 ready；
- 调整 `maxConcurrent` 后新任务并发数按新值生效（Apply 留痕）；
- 任务失败 → 仅依赖者 blocked，无关任务继续；重试上限后 failed+Escalate；
- 每任务 `agentSession` 可点进完整会话；TaskStateChanged 事件与状态迁移同拍；
- 代码任务 worktree/branch 隔离，main 无并发写；合并冲突=blocked 可见。

## 9. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 调度器与执行体状态双源 | ⚠️中 | Task.status 单一写者=调度器；会话状态只作证据 |
| spawn 桥会话关联 | ⚠️中 | 任务文件带 taskId；执行体首拍回填 agentSession；单飞+租约 |
| worktree/合并队列实现成本 | ⚠️中 | 复用 developer-system git 能力；合并队列串行；先做 worktree 模式 |
| 写集漏声明导致冲突 | ❗高 | 默认 perRepo=1 保守；touches 强制；冲突 blocked 可见 |
| 资源打满 | ⚠️中 | 全局/服务/仓库上限 + 配额 hold + 背压 |
| 任务中心性能 | ⚠️低 | 只拉摘要/分页；详情按需拉会话 |

**结论：可行。调度器是薄组件，执行/验证/落地全部复用既有能力；先落地 worktree+perRepo=1 的保守并发，再按实测放开。**
