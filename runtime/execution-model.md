# 运行时设计 1：四层执行模型（R1.2.3）

> 概念依据：core_system/concepts/task-scheme.md。本文件是运行时落地形态。

## 1. 层级与职责

```
┌─ 意图层 intent ────────────────────────────────┐
│ Goal.acceptance / 用户命令 / Event             │  说清"要什么"（全是文档）
├─ Agent 层 ─────────────────────────────────────┤
│ LLM agent（运行时不限于 dsh，A62：opencode/自写均可）│  理解意图→选 Scheme→异常兜底→升级
│ 唯一允许"智能"的层——智能属于 LLM agent 这个本质，  │
│ 与载体无关；binding 询问（ask 上级/人）也只在这层   │
├─ Scheme 层 ────────────────────────────────────┤
│ TaskScheme（确定性步骤图，已入库、已过审）        │  触发→步骤→失败策略→预算
├─ 代码层 code ──────────────────────────────────┤
│ Connector（get/plan/apply/verify/undo）+ Plugin│  幂等执行，无判断
└────────────────────────────────────────────────┘
```

**为什么**（R1.2.3 原文）：长时间运行系统肯定不能依赖 Agent 自定义。LLM 的不确定性被限制在 Agent 层的"选择与兜底"，一切重复发生的动作最终都沉淀为 Scheme（可审、可重放、可预算）。

## 2. 执行路径

```
Event/命令 ──► Agent（分析，读 L0/L1 上下文）
                │ 有匹配 TaskScheme（trigger.match 命中）──► 执行 Scheme ──► 代码层
                │ 无匹配：
                │   ├─ 一次性小事（Policy 白名单内）──► 兜底执行 + DriftReport 留痕
                │   └─ 会重复发生/高危 ──► 提案新 TaskScheme（Apply 入库，过审后用）
                └─ 失败/超预算 ──► onFailure（retry/escalate/rollback）
```

规则（来自 task-scheme.md §5）：连续同类兜底 N 次（默认 3）→ 必须提案 Scheme，否则 Workflow 拒绝继续兜底（防"永远即兴"）。

## 3. 基础调度（常见任务，可配置）

builtin 任务模板库（`global/templates/task/`，参数化；四操作=用/调/import/delete，见 task-scheme.md §4——**import 导入现有系统编排**是最重要的扩充通道）：

| 模板（origin=builtin，不可删；可 fork 调整副本，含提示词段） | 触发 | 步骤骨架 |
|---|---|---|
| `build` | push/手动 | checkout → build(dsh exec) → gate → artifact(oss) → report |
| `verify` | 定时/手动 | 探针集（ConnectorOps.verify + Metrics 查询）→ DriftReport |
| `sync` | 定时 | gitfs push NAS remote → 校验 → report |
| `report` | 定时（日/周） | 聚合 DriftReport/Event → 周报文档（现实压缩回文档） |
| `install` | InstallRequested | 模板发现 → asks 询问 → 三段安装 → 纳管登记 |

调度配置（Instance 级，可配置=改这里，不改代码）：

```yaml
# systems/<s>/instances/<i>/scheduling.yaml
schedules:
  - {task: verify, cron: "0 */2 * * *", params: {depth: full}}
  - {task: sync,   every: 10m}
  - {task: report, cron: "0 9 * * 1", params: {window: 7d}}
```

## 3.1 Workflow 与 TaskScheme 的分工（v0.3，A26）

- **Workflow 管相位**：Analyzing→Planning→…→Reporting 的态机（builtin default-task/simple-shot）；ConnectorOps 必绑一个。
- **TaskScheme 管步骤**：Executing 相位内跑的确定性步骤图。
- Agent 任务态机=default-task（不再单独定义）；每次运转落 SessionLog（见 runtime/agent-session.md）。

## 4. 与 Workflow 的关系

Workflow（v0.8 吸收 Workflow，A41）管"何时对账+整个循环"，TaskScheme 管"任务怎么跑"。Workflow 的 Plan/Execute 相位优先派发 TaskScheme；Agent 层只在无匹配时兜底。见 runtime/workflow-runtime.md（=core-workflow 管线）。

## 5. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 模板参数化不够表达 | ⚠️ 中 | overlay 覆盖段 + 新 Scheme 提案通道（设计意图：显式沉淀而非即兴） |
| Agent 兜底边界漂移 | ⚠️ 中 | N 次强制沉淀规则 + 兜底留痕 + Policy 白名单 |
| 调度配置与 Workflow 触发重复触发 | ⚠️ 低 | 调度也是触发源之一，dedupKey 含 task+params 哈希 |
