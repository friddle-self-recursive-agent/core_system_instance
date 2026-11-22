# Runtime — 内置 Event 扩展：Kafka 分发 + 飞书通知到账号（R14.8.4）

> 设计，不实现。A59：零新概念——Kafka=Notification 的传输通道实现，飞书=Provider，"通知落到账号"=user-system 的账号映射数据。

## 1. 定位（概念边界）

内置 Event 的真相在 core plugin 的 dsh 队列（concepts/event.md），**不变**。本设计只扩展**分发面**：

```
内置 Event（dsh 队列，真相）
   │  按 Notification 规则订阅（minLevel/scope 过滤）
   ▼
Notification 实例（一 Scheme 一 Instance，A28 不变）
   ├── channel: feishu  ──Provider: feishu──► 飞书 IM，路由到账号（user-system 映射）
   └── channel: kafka   ──► Kafka topic（集群 middleware）──► 下游订阅者
                              （其它机器的 core plugin / 外部观测面板 / 归档）
```

要点：
1. Kafka **不是**事件真相源，是"通知分发总线"：内置队列照常工作，Kafka 不可达只影响分发（Event(warn)），不丢真相。
2. 飞书 channel 的目标路由 = Event 的 involved/owner → user-system 账号映射（LDAP uid ↔ 飞书 userid）→ 私聊/群；无映射的处理默认上溯 root 的映射（A35 双通道精神）。
3. ApprovalNeeded/Escalate 默认接飞书 channel（A28 既有规则）；debug 级不进任何分发（A42）。

## 2. 功能图（一条 error 事件的分发路径）

```
Event(level=error, involved=某业务系统)
  │ Notification 规则命中（minLevel≥warn）
  ├─► kafka channel：序列化 → topic: core-events.<scope>（key=dedupKey，分区按 involved）
  │      └─ 下游：其它 agent_pool 机器的 core plugin 订阅 → 本地 Event 入队（跨机协同）
  └─► feishu channel：involved → 账号映射 → 飞书卡片（含 console 链接）
         ├─ 映射命中 → 私聊该账号（"上 account"）
         ├─ 无映射 / owner 是 root → 飞书群（挂载 role 的持有者）
         └─ ApprovalNeeded → 卡片带 批准/驳回 深链（回到 console plugin 页面完成动作）
```

## 3. Kafka 落位与约束

| 项 | 设计 |
|---|---|
| 部署位 | 集群 middleware 命名空间（与 mariadb/redis/rabbitmq 同域） |
| 安装路径 | 受限部署 SA **无 create 权限** → 安装走公司既有发布管道（deploy-system C3 渠道登记状态），不做直装 |
| topic 规划 | `core-events.<scope>`（scope=global/system-x）；保留与分区按量起步（3 分区/7 天） |
| 凭据 | SASL/ACL 凭据 → Provider.auth.secret（A40），不入库 |
| 可靠性 | 内置队列是真相：Kafka 发布失败重试→失败降级为本地分发+Event(warn)；不阻塞事件主路径 |

## 4. 落地顺序

| 阶段 | 范围 | 退出条件 |
|---|---|---|
| N0 | feishu Provider + userid-lookup（依赖 impl/user-system.md U3 映射） | 测试事件私聊送达指定账号 |
| N1 | ApprovalNeeded/Escalate 接飞书卡片（深链回 console） | 一次真实审批在飞书完成 |
| N2 | Kafka 安装（走公司管道）+ kafka channel 发布 | 内置事件在 topic 可见，宕机重放无丢序 |
| N3 | 跨机订阅（第二台机器消费） | 两机事件面一致 |

## 5. 可行性分析（逐组件）

| 组件 | 评级 | 风险/约束 | 缓解 |
|---|---|---|---|
| feishu Provider 发消息 | ✅ | 既有应用与凭据侧已就绪；API 限流 | 限流令牌桶+聚合（同类事件 5m 窗口合并，A28 通知聚合） |
| 账号映射路由 | ⚠️ 有条件 | 映射覆盖率<100%（花名/英文名不一致） | 未映射→群兜底+warn；映射修正走 user-system 人工绑定 |
| Kafka on 集群 | ⚠️ 有条件 | 受限 SA 不能 create → 依赖公司发布管道排期；middleware 资源余量 | C3 渠道登记+运维协作；先单机版（KRaft）小资源起步 |
| 深链回 console | ⚠️ 有条件 | 飞书外链→浏览器→dsh token 信任门 | 已配域名转发（tokened URL 模式）；卡片链接带一次性 token |
| 事件风暴 | ⚠️ 有条件 | 大面积故障时飞书轰炸 | ingest 聚合（dedupKey 分组 max）+ minLevel 门槛 + 渠道级熔断（≥N 条/分切群摘要） |

## 6. 审阅标注区

| 标记 | 位置 | 说明 |
|---|---|---|
| | | |
