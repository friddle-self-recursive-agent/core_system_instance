# 可行性总表

> 评级：✅ 可行（有经典工程解）/ ⚠️ 有条件可行（存在明确约束或依赖）/ ❌ 不可保证（机制上只能兜底不能承诺）。每概念文档的"可行性分析"一节有细节。

## 1. 概念级结论

| 概念 | 评级 | 关键依赖/约束 |
|---|---|---|
| Core | ⚠️ | git 后端无事务/watch → 串行写队列+轮询模拟；单点 v1 接受 |
| Scheme | ✅ | CRD 注册翻版；版本演进纪律 |
| Agent | ⚠️ | LLM 收敛性不可保证（❌级风险已用机制兜底：重试上限+dry-run+undo+Escalate） |
| ServiceDesc | ⚠️ | 自然语言可判定性 → acceptance 必填段+Verifying 判据 |
| ServiceInstance | ⚠️ | ImplDoc 腐化 → "文档过期=drift" 对账 |
| WorkService | ✅ | 最先可落地；适配工程量线性 |
| Connector | ✅ | 适配器模式，无研究性风险；通用驱动权限面要管住 |
| Ref | ✅ | 纯簿记；纪律风险由 TTL+owner 管 |
| Builtin | ✅ | 治理设计；硬规则双层 |
| Event | ✅ | k8s 已验证+去重+巡检兜底 |
| Apply | ⚠️ | v1 整文档归属（SSA 子集）；字段级留 v2 |
| Bind | ✅ | 组织纪律风险，SLA+升级链兜底 |
| Loop | ✅ | 刹车/预算/冷却全是经典解 |
| Status | ✅ | 成熟约定 |
| Scope | ✅ | 目录即 scope，v1 零成本；git 权限绕过 v1 承认 |
| Selector | ✅ | 无风险 |
| Owner | ✅ | 单主简化 |
| Finalizer | ⚠️ | 依赖副作用自动登记+双向对账（最容易被偷懒破坏的机制） |
| DocType | ⚠️ | "结构化骨架+自然语言血肉"的校验分级行不行，要第一个真实系统验证 |
| Policy | ⚠️ | 审批吞吐是运营风险非技术风险 |
| Credential | ✅ | 明文永不入库+扫描双保险 |
| Revision | ⚠️ | git 乐观锁粒度粗，v1 串行队列补 |

## 2. 全局三大硬前提（原稿未覆盖，必须接受）

| # | 前提 | 性质 | 设计回应 |
|---|---|---|---|
| H1 | **LLM 收敛性无法数学保证** | ❌ 不可保证 | P8 机制不假设模型能力；重试上限/dry-run/undo/Escalate 四层兜底；Escalated 是一等终态 |
| H2 | **文件夹没有事务与 watch** | ⚠️ 条件 | Repository 接口封装；v1 git+串行写+轮询；换 DB 是后端替换不是重写 |
| H3 | **必须有文档之外的点火器** | ⚠️ 条件 | Igniter（<1000行预算）+看门狗+3 条硬规则，全部显式化可审计（P9） |

## 3. 原稿中被判定"不可照原样实现"的点

| 点 | 判定 | 替代 |
|---|---|---|
| "一切皆文档"字面义 | ❌ 自举死锁 | H3：显式例外清单 |
| Prometheus 作为文档类型 | ✅ 不可（与 Metrics 冲突） | A1 并入 |
| Agent 内嵌于 ServiceInstance | ⚠️ 双源风险 | A3 全局化+引用 |
| Loop 无限自动修复直至通过 | ❌ 无法承诺 | A6 有界重试+升级 |
| 系统间自由互相 Apply | ⚠️ 提权面 | apply.md 规则 4：默认待审区 |

## 4. 建议落地顺序（可行性从高到低）

1. **Connector + WorkService + Ref + Credential**（纯工程，零研究风险，立即有产出：外部系统纳管）。
2. **Scheme + DocType + Apply + Revision + Policy**（文档面闸门；git 后端即可）。
3. **Event + Loop + Status**（对账骨架；此时已能"只报告不修复"——DriftReport 流起来就有价值）。
4. **Agent + Bind**（引入 LLM 自治；Gate 分档放行）。
5. **Finalizer + Owner 全量级联**（系统开始有生有死）。
6. **Builtin + bootstrap 完整化**（自举闭环，Core 自管）。

每一步都是可停的稳定态：1-3 完成时，系统已经是"会看门/会报警的文档控制面"，LLM 一条没跑也不亏——这与"模型越强机制越赚"的赌注一致：机制先于智能。

---

# v0.2 增补：R1 运行时专项可行性（R1.6 指定放本仓）

## 5. onedev 作为 developer-system 落地选型（A24）

| 项 | 评级 | 说明 |
|---|---|---|
| 既有实例纳管（adopt） | ✅ | WorkService+webhook+凭证四件套即可，不重装 |
| REST API：push/PR/build 状态 | ✅ | 官方 REST 覆盖主链路 |
| REST API：保护分支/红线配置 | ⚠️ 中 | 配置面 API 较薄：v1 只读抽查（gate-status），写侧人工+提案，不阻塞首圈循环 |
| 构建定义双源风险 | ⚠️ 中 | TaskScheme=唯一真相，onedev CI 是投影；对账探针把 onedev 侧漂移当 drift 管（impl/developer-system.md §6） |
| webhook 丢失 | ⚠️ 低 | 巡检兜底（P3 level-triggered） |

**结论：可行。首圈循环（core_system Goal.A4）不被任何 onedev 短板阻塞。**

## 6. NAS + OSS 三层存储

| 项 | 评级 | 说明 |
|---|---|---|
| NAS 作 git remote | ✅ | NFS 挂载点放 bare repo，零新组件 |
| sqlite 文件快照 | ✅ | WAL checkpoint 后文件级拷贝即一致快照 |
| OSS 镜像分发 | ✅ | 分段上传+digest；带宽是唯一变量，NAS 可作局域缓存 |
| 断 NAS 可用性 | ✅ | 权威在本地，sync 挂起重试不阻塞写 |
| 季度恢复演练 | ⚠️ 纪律 | 排进 scheduling.yaml，忘记=drift 可见 |

**结论：可行，无新组件（全部是现成技术拼装）。**

## 7. dsh 基座 + Plugin（A21）

| 项 | 评级 | 说明 |
|---|---|---|
| dsh 已有实现 | ✅ | 用户既有资产；契约五方法是薄抽象 |
| 单进程插件连坐 | ⚠️ 低 | 看门狗重启+任务幂等重入 |
| exec-local 白名单 | ⚠️ 中 | 按系统注册白名单模板；通用执行默认人审 |
| 直控与 Loop 双头指挥 | ⚠️ 中 | 直控只限"已派发/模板库内"任务，审计双轨（runtime/dsh-plugin.md §4） |

## 8. ops DB（SQLite，A23）

| 项 | 评级 | 说明 |
|---|---|---|
| 单写者+WAL 并发 | ✅ | Core 串行队列天然单写 |
| 双写一致性 | ⚠️ 中 | 恢复对账+每日探针；把不一致当 drift 管理正是本系统主场 |
| 可丢弃可重建 | ✅ | DB 非权威（git 才是），这是敢用 SQLite 的根据 |

## 9. console TUI（R1.5）

| 项 | 评级 | 说明 |
|---|---|---|
| 资源树+全量可点 | ✅ | 数据全来自 Scheme/ops DB 元数据，无独立前端状态 |
| 信息流三泳道 TUI | ⚠️ 中 | 表达密集但可行；Web 版（v2）降维 |

## 10. GitHub org 模板生态（R1.4）

| 项 | 评级 | 说明 |
|---|---|---|
| org 搜索+读取 | ✅ | gh API 只读 |
| 恶意模板 | ⚠️ 中 | digest+来源限定本 org+动作白名单+高危人审（runtime/install-service.md §2） |
| 冷启动无模板 | ⚠️ 低 | 官方首批 onedev/prometheus 两件 |

## 11. 三仓拆分的协作面

| 项 | 评级 | 说明 |
|---|---|---|
| 跨仓一致性（Desc↔Instance↔代码） | ⚠️ 中 | Loop 对账天然覆盖（文档过期=drift）；仓间引用全用 `system://` URI |
| 私有仓可见性 | ✅ | 三仓同 org 同权限；模板仓将来单独公开（不影响三仓私有） |

## 13. 用户系统与 IdP 接入（v0.4，A34；R3 指定"未来做可行性的时候看"）

| 项 | 评级 | 说明 |
|---|---|---|
| builtin 本地用户表 | ✅ | 一张表零依赖；对账探针管 Bind 漂移 |
| authentik 接入：OIDC/LDAP 协议面 | ✅ 初判 | 标准协议；WorkService(authentik) + ConnectorProvider(oidc/ldap) + Provider(账号包) 形态天然适配，零新机制 |
| authentik 接入：本地表转投影 | ⚠️ 中 | 权威转移后回退路径要演练（Goal.A4）；syncedFrom 标记+对账 |
| Notification contact 联动 | ✅ | role 持有者→contact 解析，IM 不可达降级 email/webhook |

**结论：初判可行。接入前 builtin 先行，不阻塞任何主线；评估项已列 open-questions（含 authentic/authentik 名称确认）。**

## 14. Workflow 跨权限复杂度（v0.8，A41；R7 指定完整分析）

完整分析在 core_system/concepts/workflow.md §7。结论摘要：复杂度在权限校验完备性而非相位机；五穿越点（事件读/文档读/计划/执行/回写）中执行是核心风险；三出路（权限齐备/跨系统提案/审批提升）+ 委派只减不增不变量。分阶段：v1 出路 1+2（低风险，不阻塞首圈循环）、v2 审批提升全量、v3 委派矩阵。**评级：⚠️ 高复杂度可行。**

## 15. v0.8 其余增补

| 项 | 评级 | 说明 |
|---|---|---|
| Provider 吸收 secret（A40） | ✅ | 簿记简化；明文扫描/轮换规则并入不变 |
| Event Level 化（A42） | ✅ | 标准日志语义；fatal→Notification 必达 |
| Loop 并入 Workflow（A41） | ✅ | 概念数 -1；core-loop 即原 Loop 管线（loop/loop.md） |

## 16. v0.9 增补（R8）

| 项 | 评级 | 说明 |
|---|---|---|
| 权限系统（A45） | ✅ | 标准 RBAC 骨架（role/group/user + scope 域）+ 灵活判定层；复杂度与原 Policy 相当、边界更清 |
| Plugin 概念删除（A43） | ✅ | 减一个概念；dsh=外部依赖（deepseek 运行时），升级节奏进 open-questions |
| 跨系统 B 侧裁判（A45） | ⚠️ 中 | 判定留痕是硬要求；v1 建议默认判定方=role 权限表（最可预测），agent/上级 agent 判定按系统逐个放开 |

## 12. 更新后的落地顺序（覆盖 §4，含 v0.2）

1. workservice 骨架 → igniter+cored 最小可跑（git 后端+ops DB）
2. storage-system 三层（NAS remote+OSS bucket+sync 模板）
3. onedev adopt 纳管 + onedev-driver 五 op → **跑通首圈循环（core_system Goal.A4）**
4. console TUI 两层视角
5. TaskScheme 模板库补全 + install 流程（prometheus-template 首装）
6. Agent 层放开（Bind 分档放行，P8）
