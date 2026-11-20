# 运行时设计 4：git 管文档 + DB 管 ops 日志（R1.5.4 / A23）

> 概念依据：core_system/concepts/revision.md（v0.2 修订）。

## 1. 双轨分工

| 轨 | 载体 | 管什么 | 不管什么 |
|---|---|---|---|
| 文档轨 | 本地文件夹 git（权威） | 对象/文档的**内容版本**（谁改了哪份文档的什么） | 高频操作流水 |
| ops 轨 | DB（v1 SQLite，单文件，随 Core 部署） | **操作流水**：Apply 判定、Event 收发、直控三原语、审批、Escalate、预算消耗 | 文档内容 |

一句话：**git 回答"系统长什么样（第 N 版）"，DB 回答"谁在何时对它做了什么操作"**。

## 2. ops DB 表（v1）

```sql
apply_log    (ts, field_manager, obj, resource_version, result, policy_decisions, reason_ref)
event_log    (ts, event_id, type, source, involved, dedup_key, severity, routed_to)
control_log  (ts, root_agent, primitive, target_agent, task_id, result)   -- 直控审计
approval_log (ts, approval_id, permission_rule, judged_by, decision)   -- v0.9：权限系统判定（A44）
escalate_log (ts, from_loop, reason, chain_depth)
budget_log   (ts, loop, task, tokens, mutations, wall_ms)
```

## 3. 双写与对账

- Apply 成功 = 同一事务语义的两笔：先 DB（apply_log）后 git commit；Core 崩溃恢复时对账：有 DB 无 git → 回放该 commit；有 git 无 DB → 补记（带 recover 标记）。
- 每日自动对账任务（TaskScheme `verify` 模板的一个探针）：`apply_log.count ≈ git log count`，差异生成 DriftReport（这就是 self-recursive-core Goal.A3）。
- ops DB 自身备份：随 storage-system 的 NAS 层（每日快照）；DB 不是权威——**可丢弃可重建**（从 git+审计重建大部分），这是它敢用 SQLite 的原因。

## 4. 查询入口

- console 信息流层直接读 ops DB（事件/状态变迁/审批泳道）。
- MetricsInfo 不入 ops DB（数据在 TSDB；DB 只记"查询发生过"级别不记结果——保持 DB 轻）。

## 5. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| SQLite 写并发 | ⚠️ 低 | 单写者（Core 串行队列已保证）；WAL 模式 |
| 双写不一致窗口 | ⚠️ 中 | 恢复对账 + 每日对账探针（把不一致本身当成 drift 管理——本系统主场） |
| DB 膨胀 | ⚠️ 低 | 分区滚动（90d 热数据）+ 冷数据归档 OSS |
