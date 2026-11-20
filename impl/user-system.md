---
name: impl-user-system
docType: ImplDoc
scope: builtin-user-system
ownerRefs: [{kind: ServiceDesc, name: builtin-user-system}]
---
# ImplDoc — builtin-user-system 接入 LDAP 与飞书（R14.8.1）

> 设计，不实现。公司实物（LDAP 管理面地址、同步通道、飞书应用凭据）见公司 git 报告仓 evidence（A55）。

## 0. 已验证现状（泛化表述）

| 事实 | 对设计的影响 |
|---|---|
| 公司有 ldap 管理面（HTTP API：认证/当前用户两组端点，门户客户端在用） | user-system 的**认证**可走该 API（Provider 形态），不必直连 LDAP 协议 |
| 公司有 LDAP 同步通道（389/636 端口的中转容器在入口宿主） | **目录同步**（用户/组全量+增量）走 LDAP 协议直连该通道 |
| 飞书已在使用（lark-cli 等工具在现有机器装好，应用凭据存在既有配置侧） | 飞书 Provider 的凭据来源=既有应用，不新造应用 |

## 1. 架构

```
             ┌────────────── user-system（builtin ServiceDesc） ──────────────┐
             │  Kind: User / Group（builtin 本地表，SQLite）                    │
             └───┬──────────────────────────────────────┬─────────────────────┘
                 │ 同步（L0/L1 归 DirSync Workflow）        │ 认证（Authn Workflow）
        ┌────────▼────────┐                     ┌────────▼────────┐
        │ Provider: ldap   │                     │ Provider: ldap-  │
        │  （LDAPS 直连，    │                     │  authn（管理面    │
        │   目录=真相源）     │                     │   HTTP API）     │
        └────────┬────────┘                     └────────┬────────┘
                 │ 组→role 投影                            │ token 发放
   ┌─────────────▼──────────────────────────────────────▼─────────────┐
   │ Account Mapping（数据，非文档）： LDAP uid ↔ User.name ↔ 飞书 userid │
   └──────────────────────────────────────┬───────────────────────────┘
                                          │ 供 Notification 路由（R14.8.4）
        ┌─────────────────────────────────▼────────┐
        │ Provider: feishu（既有应用凭据，secret 引用）│
        └──────────────────────────────────────────┘
```

要点（P10 单一职责）：
- **目录真相在 LDAP**，user-system 本地表只是投影 + 缓存（Spec=同步规则，Status=上次同步水位）；本地不再造第二个真相源。
- **认证走管理面 API、同步走 LDAPS** 两通道分立：认证是人的交互路径（复用门户同款 API，用户体验一致）；同步是机器对账路径（全量可比对）。
- 飞书不在 user-system 内：user-system 只产出**账号映射数据**；发消息是 Notification 的职责（A28/A59）。

## 2. 对象与映射

| 对象 | 内容 |
|---|---|
| Provider `ldap-dir` | 连接面：LDAPS 地址/BindDN（auth.secret 引用）；Ops：search(page)、diff(since) |
| Provider `ldap-authn` | 连接面：管理面 API base+token（secret）；Ops：auth(uid,pwd)→token、me(token) |
| Provider `feishu` | 连接面：应用 app_id/secret（secret）；Ops：userid-lookup、im-send（供 Notification 用） |
| Workflow `user-dir-sync` | watch-only+timer：每日全量 diff → User/Group 对象增改 → 漂移即 Event |
| Rule | 组→role 映射表（声明式数据，如 `ops→role-admin`）；映射变化=文档变更走 Apply |
| Account Mapping | **数据不是文档**（Q1）：LDAP uid ↔ User ↔ 飞书 userid 三元组，入本地 DB；文档面只存查询入口声明 |

## 3. 落地顺序

| 阶段 | 范围 | 退出条件 |
|---|---|---|
| U0 | ldap-authn Provider：管理面 API 认证打通（拿现有账号实测） | 用现有账号换取 token 成功 |
| U1 | ldap-dir Provider + user-dir-sync：全量同步 → User/Group 落库 | 本地库人数=LDAP 人数，diff 抽查为零 |
| U2 | 组→role 映射 Rule：权限系统 role 持有者=LDAP 组投影 | 改 LDAP 组 → 一轮同步 → role 变化可观测 |
| U3 | feishu Provider：userid-lookup 打通（映射率统计） | 映射覆盖率 ≥95%（未映射=Event warn） |

## 4. 可行性分析（逐组件）

| 组件 | 评级 | 风险/约束 | 缓解 |
|---|---|---|---|
| 认证（管理面 API） | ✅ | API 已被门户客户端长期使用（行为可预期）；token 语义需确认 | U0 用现有账号实测；token 失效路径进 VerifyDoc |
| 目录同步（LDAPS） | ⚠️ 有条件 | 同步通道容器的可用性与证书；增量同步水位 | 全量 diff 兜底（每日）；水位丢失即全量 |
| 组→role 投影 | ⚠️ 有条件 | LDAP 组语义 vs 权限系统 role 语义不完全对齐（如组嵌套） | 映射表扁平化，嵌套组展开规则写死在 ConnectorOps（幂等、可对账） |
| 飞书 userid 映射 | ⚠️ 有条件 | 飞书账号与 LDAP 账号名不一致（英文名/花名） | 映射表允许人工绑定修正；未映射不阻塞，只 warn |
| 凭据管理 | ✅ | 全部 secret 引用（A40），管理面 token/LDAP BindDN/飞书 secret 不入库 | Provider 明文扫描内置 |

## 5. 审阅标注区

| 标记 | 位置 | 说明 |
|---|---|---|
| | | |
