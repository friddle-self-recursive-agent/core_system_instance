# 运行时设计 4：git 管文档 + DB 管 ops 日志（R1.5.4 / A23）

> 概念依据：core_system/concepts/revision.md（v0.2 修订）。

## 1. 双轨分工

| 轨 | 载体 | 管什么 | 不管什么 |
|---|---|---|---|
| 文档轨 | 本地文件夹 git（权威） | 对象/文档的**内容版本**（谁改了哪份文档的什么） | 高频操作流水 |
| ops 轨 | DB（v1 SQLite，单文件，随 Core 部署） | **操作流水**：Apply 判定、Event 收发、直控三原语、审批、Escalate | 文档内容 |

一句话：**git 回答"系统长什么样（第 N 版）"，DB 回答"谁在何时对它做了什么操作"**。

## 2. ops DB 表（v1）

```sql
apply_log    (ts, field_manager, subject, obj, resource_version, result, policy_decisions, reason_ref)
             -- subject：判定主体标识（v0.9 请求级主体，permission.md §3）——denied 行必带
             -- （user 优先，无 user 记断言 roles/groups，全空=anonymous）；ok/noop/conflict 行由
             -- repository 双写落（Write 契约冻结不携主体），归属看 field_manager
event_log    (ts, event_id, type, source, involved, dedup_key, severity, routed_to)
control_log  (ts, root_agent, primitive, target_agent, task_id, result)   -- 直控审计
approval_log (ts, approval_id, permission_rule, judged_by, decision)   -- v0.9：权限系统判定（A44）
escalate_log (ts, from_workflow, reason, chain_depth)
draft        (kind, scope, name, content, field_manager, reason_ref, base_rv, created_at, updated_at)
             -- PRIMARY KEY (kind, scope, name)；v0.10：草稿缓存持久化面（apply.md §1 编辑与
             -- 发布分离）——随 --ops-db 持久化部署决策一并注入：给定 --ops-db=落稿/弃稿写穿
             -- 本表 + cored 启动恢复；缺省内存语义不变（重启即清，草稿可重放）
```

> 预算/成本流水（budget_log 类）**不在 ops DB v1 内**：budget 是 metrics 关注的东西，不是核心循环内容——暂不做，日后随 metrics 默认 workflow 落。

> **draft 表的两点边界**：① 它不是操作流水，是「待发布稿」缓存（apply.md §1：草稿不是文档面——无 Revision、零提交零事件，git 权威不受碰），落 DB 是部署决策：DB 可丢弃可重建 ⇒ 丢草稿=丢待确认编辑（可重放），不违反「DB 不管文档内容」（草稿尚不是文档面）。② 它**不参与 §3 对账不变量**（对账对象=apply_log(ok) ≙ DocApplied；草稿是缓存非账），恢复语义=整表替换内存（确定性：恢复后内存态=表现态；单行非法跳过并计数——草稿非权威，坏行不拖垮进程）。

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
