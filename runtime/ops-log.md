# 运行时设计 4：git 管文档 + DB 管 ops 日志（R1.5.4 / A23）

> 概念依据：core_system/concepts/revision.md（v0.2 修订）。

## 1. 双轨分工

| 轨 | 载体 | 管什么 | 不管什么 |
|---|---|---|---|
| 文档轨 | 本地文件夹 git（权威） | 对象/文档的**内容版本**（谁改了哪份文档的什么） | 高频操作流水 |
| ops 轨 | DB（v1 SQLite，单文件，随 Core 部署） | **操作流水**：Apply 判定、Event 收发、直控三原语、审批、Escalate | 文档内容 |

一句话：**git 回答"系统长什么样（第 N 版）"，DB 回答"谁在何时对它做了什么操作"**。

### 1.1 三库分工（v0.34 storage 增量收口段：docs 走 sqlite 后端 + 秘密库独立）

文档存储后端可换（scheme.yaml runtime.storage.docs 双后端单权威，cored `--docs-backend git|sqlite`）后，部署侧的库分工从双轨变三库——**权威归属是关键，可丢弃性与之一一对应**：

| 库 | 装配 | 权威面 | 可丢弃？ | 理由 |
|---|---|---|---|---|
| docs DB | `--docs-backend sqlite --docs-db <path>`（**缺省 sqlite**） | 文档内容权威（doc 表；git 布局=导出/公开格式——种子导入=迁移路径） | **否** | 丢库=丢文档内容（权威面本体） |
| ops DB | `--ops-db <path>` | 操作流水（apply_log/event_log/…六表+draft 写穿） | **是** | 非权威可重建（从文档面+审计重建大部分）——本文件 §1 既有口径不变 |
| 秘密库 | `--secrets-db <path>` | 凭据真实值（secret: 引用的解析源；0600 独立文件） | **否** | 秘密=权威运行时值非缓存，丢库=丢凭据；**独立文件最小暴露面**——不随可丢弃的 ops DB 走（丢上库连坐丢凭据），也不进 docs DB（文档库有查询/导出/备份面，脱敏红线：值只进不出） |

三库任何查询/导出/备份口径互不携带对方内容；秘密库读面只出名称与更新时刻（provider.md 规则 2 脱敏红线——值只经引用式取值 `secret:<name>` 在实现侧进程内解析，永不跨进程边界）。

**默认存储口径（2026-11-26 用户裁决，core_design R-DOC-7）**：

- **默认=sqlite + 本地 storage**：新建部署与 root（core_system）固定 sqlite docs DB，root 启动参数不得出现 `--docs-backend git`；
- **git=导出/公开（output/public）**：不再作为写路径权威。按规则**定时**从 sqlite 导出 git 工作树 → commit → push 远程；git 历史=导出快照，**不是逐次写账本**；导出失败只告警，不回滚 sqlite 写；频率/分支/远程目标=部署侧配置；
- **迁移**：`--docs <旧 git 布局根>` 对空库一次性种子导入，保留各对象 `resourceVersion`；非空库不导入（幂等）；
- **兼容期**：非 root 部署可显式 `--docs-backend git`（kube-inner 等），迁移后同上；root 不允许；
- **逐次正文历史**：sqlite 后端当前无逐次内容快照，`GET /v1/rev-content` 返回 503 诚实降级；`apply_log` 仍有操作流水（谁/何时/rv/结果）。`doc_history` 或等价读面为下一段（不得用周期 git 快照冒充逐次历史）。

## 2. ops DB 表（v1）

```sql
apply_log    (ts, field_manager, subject, obj, resource_version, result, policy_decisions, reason_ref)
             -- subject：判定主体标识（v0.9 请求级主体，permission.md §3）——denied 行必带
             -- （user 优先，无 user 记断言 roles/groups，全空=anonymous）；ok/noop/conflict 行由
             -- repository 双写落（Write 契约冻结不携主体），归属看 field_manager
             -- v0.55（R-9 构建生效链判别面）：apply_log 升为「构建生效链对账」的数据源——
             -- field_manager=workflow:bind ∧ reason_ref 前缀 workflow-bind: 的行=绑定器流水
             -- （ok=落库后版本/noop=幂等重入照落现值），`GET /v1/workflows` 行集 reconcile 键
             -- 消费（skeletonRv↔lastBindRv 对账 chain 三词——cored-bridge.md §2 v0.55；
             -- 账本不删=对象键跨生命周期复用时旧 rv 高位如实参与判定=divergent 真实历史词形）
event_log    (ts, event_id, type, source, involved, dedup_key, severity, routed_to)
control_log  (ts, root_agent, primitive, target_agent, task_id, result)   -- 直控审计
approval_log (ts, approval_id, obj, decision, judged_by, field_manager, resource_version, reason_ref)
             -- v0.46：审批判定独立账（v0.9 权限系统判定 A44 声明收编落地——permission_rule 列并入
             -- field_manager（判定来源面）与 reason_ref（判定理由引用），A44 权限系统落地后随行具体化）。
             -- decision ∈ {granted, rejected}（闭合集，扩展走迁移行不重写语义）；
             -- obj="kind/scope/name"（与 apply_log.obj 同构）；judged_by=判定主体（permission.md §3
             -- 请求级主体 ID 口径，全空=anonymous）；approval_id=判定流水键（现口径
             -- "draft:<kind>/<scope>/<name>"——同键覆盖=最新判定；A44 落地后承审批 dedup 键）。
             -- 现落地面=console 审批屏两判定：批准=fromDraft apply（fieldManager=console:approve）非
             -- dry-run 成功→granted 行（resource_version=落库后 rv；noop 幂等重入照落，rv=面上现值
             -- ——判定发生了，只是零变更可落）；驳回=DELETE 弃稿成功→rejected 行（resource_version=0
             -- ——弃稿零文档面动作，判定仍落账）。apply_log 双账并存不互斥（apply_log=落库流水，
             -- approval_log=审批判定流水——审计问"谁批了什么何时决"不再靠 field_manager 字符串考古）。
             -- 账面非权威：落账失败不翻转写路径结果（stderr 注记，DB 可重建）；不参与 §3 对账不变量。
escalate_log (ts, from_workflow, reason, chain_depth)
draft        (kind, scope, name, content, field_manager, reason_ref, base_rv, created_at, updated_at)
             -- PRIMARY KEY (kind, scope, name)；v0.10：草稿缓存持久化面（apply.md §1 编辑与
             -- 发布分离）——随 --ops-db 持久化部署决策一并注入：给定 --ops-db=落稿/弃稿写穿
             -- 本表 + cored 启动恢复；缺省内存语义不变（重启即清，草稿可重放）
 session_heartbeat (session_id PK, ts, phase, last_action, task_name, long_task, heal_attempts, healed_at, state, updated_at)
              -- v0.54（KI-003 会话活性账面，agent-session.md §7/§8）：心跳=upsert 即续租（watchdog
              -- 扫描键=updated_at < now-阈值=停滞候选）；state ∈ {live, suspected-stall（判定态词=
              -- SuspectedStall 的 DB 词形，event.md 规则 14b 判定/事件词分立）, long-task, healed,
              -- escalated}（闭合集）；task_name/long_task=长任务显式化字段（LongTaskRunning 判据：
              -- 声明长任务或有进展心跳=不判停滞）；heal_attempts/healed_at=自愈链留痕（第一动作=
              -- 注入固定 prompt「继续」，连续无效达 --heal-retry-limit 升级 Escalate）；**状态迁移不写
              -- updated_at**（租约=活性推进——watchdog 自身翻转不算心跳，停滞行不逃扫描池）。
              -- 注册面=POST /v1/sessions/heartbeat（写面门控同 --allow-apply）；读面=GET /v1/sessions
              -- （恒开）；账面非权威（活性租约=运行时观测面），不参与 §3 对账不变量。
```

> 预算/成本流水（budget_log 类）**不在 ops DB v1 内**：budget 是 metrics 关注的东西，不是核心循环内容——暂不做，日后随 metrics 默认 workflow 落。

> **draft 表的两点边界**：① 它不是操作流水，是「待发布稿」缓存（apply.md §1：草稿不是文档面——无 Revision、零提交零事件，git 权威不受碰），落 DB 是部署决策：DB 可丢弃可重建 ⇒ 丢草稿=丢待确认编辑（可重放），不违反「DB 不管文档内容」（草稿尚不是文档面）。② 它**不参与 §3 对账不变量**（对账对象=apply_log(ok) ≙ DocApplied；草稿是缓存非账），恢复语义=整表替换内存（确定性：恢复后内存态=表现态；单行非法跳过并计数——草稿非权威，坏行不拖垮进程）。

## 3. 双写与对账

- Apply 成功 = 同一事务语义的两笔：先 DB（apply_log）后 git commit；Core 崩溃恢复时对账：有 DB 无 git → 回放该 commit；有 git 无 DB → 补记（带 recover 标记）。
- 每日自动对账任务（TaskScheme `verify` 模板的一个探针）：`apply_log.count ≈ git log count`，差异生成 DriftReport（这就是 self-recursive-core Goal.A3）。
- ops DB 自身备份：随 storage-system 的 NAS 层（每日快照）；DB 不是权威——**可丢弃可重建**（从 git+审计重建大部分），这是它敢用 SQLite 的原因。

## 4. 查询入口

- console 信息流层直接读 ops DB（事件/状态变迁/审批泳道）。
- v0.46 读面落点：`GET /v1/approvals`（审批判定账面查询——decision/obj 精确过滤+rv 降序+limit 收敛防拖库；face 缺席=503 装配防御面，ops DB 恒装配；旧构建路由未注册经兜底 handler 405=代际判别器）。应用史=`GET /v1/history/{kind}/{name}`（v0.38 apply_log 读面）。
- MetricsInfo 不入 ops DB（数据在 TSDB；DB 只记"查询发生过"级别不记结果——保持 DB 轻）。

## 5. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| SQLite 写并发 | ⚠️ 低 | 单写者（Core 串行队列已保证）；WAL 模式 |
| 双写不一致窗口 | ⚠️ 中 | 恢复对账 + 每日对账探针（把不一致本身当成 drift 管理——本系统主场） |
| DB 膨胀 | ⚠️ 低 | 分区滚动（90d 热数据）+ 冷数据归档 OSS |
