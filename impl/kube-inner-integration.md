---
name: impl-kube-inner-integration
docType: ImplDoc
scope: builtin-deploy-system
ownerRefs: [{kind: ServiceDesc, name: builtin-deploy-system}]
---
# ImplDoc — 内网集群（kube-inner）接入设计

> R14.3 指定设计对象：把公司内网 K8s 集群承载的全部内部管理系统纳入文档面（WorkService 纳管 + 页面功能模块划分）。
> 本文档只做设计，不实现。**公司实物信息（域名/地址/凭据/系统实名）只存公司 git 的 agent_pool 报告仓（A55/R14.6）**，本文档一律用泛化称谓。
> **部署实例（sybran 侧渠道绑定与实锚点）见 `sybran-developer-system` 仓 `docs/deploy-channels.md`（private，2026-11-26 用户裁决：sybran 内容出公开仓）；本篇保留为 deploy-system 的集群接入设计蓝本。**

## 0. 已验证现状（事实，非设计）

| 事实 | 验证方式 | 对设计的约束 |
|---|---|---|
| 内网集群为多环境结构（prod / preview / pubtest + 中间件/监控/网关系统命名空间） | 部署 SA 列举 deployments 可见 | WorkService 六面体的运行状态面按环境分 Instance |
| 集群访问账号=受限部署 SA：deployments/pods/replicasets/events 可 get/list/watch/patch/update；nodes/namespaces/ingress 等**不可列** | RBAC selfsubjectrulesreview | 集群 Connector 的 ops 集合以此为上界；建/删资源类 op 不存在 |
| 集群网关双层：传统 ingress-nginx + envoy-gateway（HTTPRoute） | 命名空间与 deploy 清单 | 流量面纳管按两套网关分别声明 |
| 中间件命名空间含 mariadb / redis / rabbitmq（及对应 exporter） | deployments 清单 | DataDesign/DataMetrics 的数据面挂这里；凭据一律 secret 引用 |
| 管理链：跳板机 →(SSH)→ 集群入口宿主 → 集群 API | 已实测连通 | Provider.auth + Connector 连接面的通道设计依据 |
| 门户客户端的服务注册表 90 项（六类），即"所有页面功能"的第一手清单 | 注册表文件已取证 | 模块划分底稿（§2） |
| 公司 OneDev API 可用：182 项目、token 鉴权通过、分页查询正常 | REST API 实测 | developer-system 的 SCM/CI 纳管无新前置 |

## 1. 架构（纳管拓扑）

```
 文档面（ServiceDesc/Instance）
 ─────────────────────────────────────────────
  WorkService: kube-inner（capabilities: k8s, deploy, observe）
   ├── Connector: kube-driver（deployments/pods/events 读写）
   ├── Provider: 部署SA（auth.secret=引用，凭据不入库）
   └── Ref: resolve{system=kube-inner, type=deployment, params:{ns,name}}
  WorkService: onedev（capabilities: scm, ci）——已有设计（impl/developer-system.md）
  WorkService: 反馈/工单/监控等外部系统 → 各自六面体（观测面产 Event）

 执行面
 ─────────────────────────────────────────────
  deploy-system（ServiceInstance）
   ├── kube-inner ConnectorOps：get/patch/rollout-status/logs（幂等：比较后写）
   └── 通道：跳板 SSH → 集群入口宿主 → API（Provider.auth.secret 承载跳板凭据）

 观测面
 ─────────────────────────────────────────────
  kube-driver.watch(events) + 监控栈 watch → Event → feedback-remediation
```

**边界判定**（architecture.md 决策树）：集群=外部常驻系统 → WorkService；每环境的工作负载=该 WorkService 被观测到的现实 → Status/MetricsInfo，不是文档；"把某系统部署到 prod"这类意图 → 各业务系统 ServiceDesc 的 DeployDesign，经跨系统提案（互相 Apply）落到 deploy-system。

## 2. 页面功能模块划分（subagent 梳理结果）

门户服务注册表 90 项，按注册表原生分类（模块→文档面归属）：

| 模块类 | 数量 | 代表系统 | 文档面归属 |
|---|---|---|---|
| 业务管理系统 | 46 | 用户中心（SSO 底座）、AI 通道管理、设备与运营后台、BI 报表、技术支持/社区后台 | 每系统=WorkService；每环境实例=Instance 或 Ref |
| 运维系统 | 21 | 日志/指标/链路追踪、K8s 管理面板、缓存/DB 管理入口 | 多数并入 kube-inner/监控栈的六面体（它们是同一批外部系统的 UI），**不重复注册** |
| 账号与存储 | 14 | LDAP/SSO/Keycloak、网盘、NAS | 账号类=权限系统/user-system 的对接 IdP（WorkService）；存储类=storage-system 的既有纳管 |
| 内部业务系统 | 6 | 订单/激活码/售后、Bug/工单、反馈中心、版本管理 | 每系统=WorkService；反馈中心与工单=feedback-workflow 的事件源（第一优先） |
| 开发工具 | 3 | 跳板机、公司 git（OneDev）、网盘聚合 | 跳板=通道基础设施（Provider 连接面）；OneDev=developer-system 既有设计 |

划分规则：
1. **注册表是数据不是文档**（Q1）：90 项实物清单存公司 git；文档面只存模块分类注册（A58）。
2. 运维 UI 与其背后系统**合一注册**，防"一个系统两个 WorkService"（Scheme 唯一注册）。
3. 环境变体（dev/test/prod/…）= 同一 WorkService 的多 Instance，不是多个 WorkService。
4. 模块清单与集群 deployments 清单**对账**：注册表有而集群无 → 未部署（Ref/下线）；集群有而注册表无 → 未纳管系统（进待注册队列）。

## 3. 凭据与通道（R14.6 硬规则的落地）

| 凭据类别 | 存放 | 文档面表达 |
|---|---|---|
| 集群部署 SA token | Provider.auth.secret（source 引用） | 不出现明文 |
| 跳板 SSH 私钥/口令 | 同上 | 不出现明文 |
| 中间件（DB/缓存/队列）账号密码 | 部署侧 secret；文档面只声明 DataDesign 的"哪个系统用哪个库" | 只报库别名与字段引用 |
| OneDev 访问 token | Provider.auth.secret | 不出现明文 |

明文扫描规则沿用 Provider 内置（A40）；公司 git 的 agent_pool 报告仓同样执行"证据可以截图/输出摘要，凭据必须打码"。

## 4. 落地顺序（不开做）

| 阶段 | 范围 | 退出条件 |
|---|---|---|
| K0 | kube-driver 契约测试（对受限 SA：get/patch deployment、rollout 状态、events watch） | conformance 三例全绿（首跑/重跑幂等/失败路径） |
| K1 | 集群 WorkService 纳管 + 环境清单对账（注册表 vs deployments） | 对账表产出，差异可解释 |
| K2 | 反馈/工单系统 watch 源接入（feedback-workflow P0 前置） | 测试错误 5m 内成 Event |
| K3 | preview 环境发布链路（feedback-workflow P3 对接） | 一次真实预发发布验收 |

## 5. 可行性分析（逐组件）

| 组件 | 评级 | 风险/约束 | 缓解 |
|---|---|---|---|
| 集群 Connector（受限 SA） | ⚠️ 有条件 | RBAC 只覆盖 workload 读写，无 create/delete、无 ingress/node | ops 集合=SA 能力上界；安装类需求走公司既有发布管道，不伪造 |
| patch 幂等 | ✅ | 比较 spec 后 patch，天然幂等（P4） | 写前 dry-run（server-side dryRun）+ 写后 verify |
| 多环境对账 | ⚠️ 有条件 | 注册表（90 项）与集群清单口径不一（域名 vs workload 名） | 对账表以"系统实名"为主键人工确认一次，之后机器比对 |
| 跳板通道稳定性 | ⚠️ 有条件 | 多一跳 SSH，断链即失联 | Provider 连接面健康探针；断链=Event(ExternalChanged, warn) 而非静默 |
| 90 项全量纳管 | ⚠️ 有条件 | 逐系统六面体建档工作量大 | 分级：事件源 3 个先纳管，其余按模块类批量 adopt（骨架+观测面先行，数据面缓建） |
| 双网关（ingress+envoy） | ✅ | 只是观测面数据源差异 | kube-driver 不感知网关，流量面由各网关系统自己的六面体承担 |

## 6. 待决问题

见 open-questions.md#kube-inner（受限 SA 是否扩权、跳板凭据的轮换策略、90 项对账主键）。

## 7. 审阅标注区

| 标记 | 位置 | 说明 |
|---|---|---|
| | | |
