# 运行时设计 1：四层执行模型（R1.2.3）

> 概念依据：core_system/concepts/task-scheme.md。本文件是运行时落地形态。

## 1. 层级与职责

```
┌─ 意图层 intent ────────────────────────────────┐
│ Goal.acceptance / 用户命令 / Event             │  说清"要什么"（全是文档）
├─ Agent 层 ─────────────────────────────────────┤
│ dsh 基座上的 LLM agent                         │  理解意图→选 Scheme→异常兜底→升级
│ 唯一允许"智能"的层                              │
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

规则（来自 task-scheme.md §5）：连续同类兜底 N 次（默认 3）→ 必须提案 Scheme，否则 Loop 拒绝继续兜底（防"永远即兴"）。

## 3. 基础调度（常见任务，可配置）

builtin 任务模板库（`global/templates/task/`，参数化）：

| 模板 | 触发 | 步骤骨架 |
|---|---|---|
| `build` | push/手动 | checkout → build(dsh exec) → gate → artifact(oss) → report |
| `verify` | 定时/手动 | 探针集（Connector.verify + Metrics 查询）→ DriftReport |
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

## 4. 与 Loop 的关系

Loop 管"何时对账"，TaskScheme 管"任务怎么跑"。Loop 的 Plan/Execute 阶段优先派发 TaskScheme；Agent 层只在无匹配时兜底。见 loop/loop.md §2 状态机中 Plan/Execute 的实现注记。

## 5. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 模板参数化不够表达 | ⚠️ 中 | overlay 覆盖段 + 新 Scheme 提案通道（设计意图：显式沉淀而非即兴） |
| Agent 兜底边界漂移 | ⚠️ 中 | N 次强制沉淀规则 + 兜底留痕 + Policy 白名单 |
| 调度配置与 Loop 触发重复触发 | ⚠️ 低 | 调度也是触发源之一，dedupKey 含 task+params 哈希 |
