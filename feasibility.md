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
| Workflow | ✅ | 刹车/预算/冷却全是经典解 |
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
| H3 | **必须有文档之外的点火器** | ⚠️ 条件 | Igniter（无常驻；单文件≤800 行质量约束）+看门狗+3 条硬规则，全部显式化可审计（P9） |

## 3. 原稿中被判定"不可照原样实现"的点

| 点 | 判定 | 替代 |
|---|---|---|
| "一切皆文档"字面义 | ❌ 自举死锁 | H3：显式例外清单 |
| Prometheus 作为文档类型 | ✅ 不可（与 Metrics 冲突） | A1 并入 |
| Agent 内嵌于 ServiceInstance | ⚠️ 双源风险 | A3 全局化+引用 |
| Workflow 无限自动修复直至通过 | ❌ 无法承诺 | A6 有界重试+升级 |
| 系统间自由互相 Apply | ⚠️ 提权面 | apply.md 规则 4：默认待审区 |

## 4. 建议落地顺序（可行性从高到低）

1. **Connector + WorkService + Ref + Credential**（纯工程，零研究风险，立即有产出：外部系统纳管）。
2. **Scheme + DocType + Apply + Revision + Policy**（文档面闸门；git 后端即可）。
3. **Event + Workflow + Status**（对账骨架；此时已能"只报告不修复"——DriftReport 流起来就有价值）。
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

## 6. 本机目录存储（2026-11-27 裁定：builtin 无 NAS/OSS）

| 项 | 评级 | 说明 |
|---|---|---|
| 本机目录+git（docs/files/snapshots/templates） | ✅ | workservice gitfs+sqlite 已有实现形态，零新组件、零外部依赖 |
| sqlite 文件快照 | ✅ | WAL checkpoint 后文件级拷贝即一致快照 |
| digest 校验链 | ✅ | 写入/取件两端各算一次比对，纯代码 |
| 远端外接（nas/oss connector） | ✅ | connector 模式已验证（onedev-driver 同构）；接与不接都不改内置契约，sync/归档=部署的 Task/Workflow |
| 季度恢复演练 | ⚠️ 纪律 | 排进 scheduling.yaml，忘记=drift 可见 |

**结论：可行，无新组件（全部是现成技术拼装）。**

## 7. dsh 基座 + Plugin（A21）

| 项 | 评级 | 说明 |
|---|---|---|
| dsh 已有实现 | ✅ | 用户既有资产；契约五方法是薄抽象 |
| 单进程插件连坐 | ⚠️ 低 | 看门狗重启+任务幂等重入 |
| exec-local 白名单 | ⚠️ 中 | 按系统注册白名单模板；通用执行默认人审 |
| 直控与 Workflow 双头指挥 | ⚠️ 中 | 直控只限"已派发/模板库内"任务，审计双轨（runtime/dsh-plugin.md §4） |

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
| 跨仓一致性（Desc↔Instance↔代码） | ⚠️ 中 | Workflow 对账天然覆盖（文档过期=drift）；仓间引用全用 `system://` URI |
| 私有仓可见性 | ✅ | 三仓同 org 同权限；模板仓将来单独公开（不影响三仓私有） |

## 13. 用户系统与 IdP 接入（v0.4，A34；R3 指定"未来做可行性的时候看"）

| 项 | 评级 | 说明 |
|---|---|---|
| builtin 本地用户表 | ✅ | 一张表零依赖；对账探针管 role 挂载漂移 |
| authentik 接入：OIDC/LDAP 协议面 | ✅ 初判 | 标准协议；WorkService(authentik) + ConnectorProvider(oidc/ldap) + Provider(账号包) 形态天然适配，零新机制 |
| authentik 接入：本地表转投影 | ⚠️ 中 | 权威转移后回退路径要演练（Goal.A4）；syncedFrom 标记+对账 |
| Notification contact 联动 | ✅ | role 持有者→contact 解析，IM 不可达降级 email/webhook |

**结论：初判可行。接入前 builtin 先行，不阻塞任何主线；评估项已列 open-questions（含 authentic/authentik 名称确认）。**

## 14. Workflow 跨权限复杂度（v0.8，A41；R7 指定完整分析）

完整分析在 core_system/concepts/workflow.md §7。结论摘要：复杂度在权限校验完备性而非相位机；五穿越点（事件读/文档读/计划/执行/回写）中执行是核心风险；三出路（权限齐备/跨系统提案/审批提升）+ 委派=一次性全量下发（子 ⊆ 父只减不增不变量不变；运行时缺权限 ask 上级整包重发）。分阶段：v1 出路 1+2（低风险，不阻塞首圈循环）、v2 审批提升全量、v3 ask-上级重发链路完善。**评级：⚠️ 高复杂度可行。**

## 15. v0.8 其余增补

| 项 | 评级 | 说明 |
|---|---|---|
| Provider 吸收 secret（A40） | ✅ | 簿记简化；明文扫描/轮换规则并入不变 |
| Event Level 化（A42） | ✅ | 标准日志语义；fatal→Notification 必达 |
| Workflow 并入 Workflow（A41） | ✅ | 概念数 -1；core-workflow 即原 Workflow 管线（runtime/workflow-runtime.md） |

## 16. v0.9 增补（R8）

| 项 | 评级 | 说明 |
|---|---|---|
| 权限系统（A45） | ✅ | 标准 RBAC 骨架（role/group/user + scope 域）+ 灵活判定层；复杂度与原 Policy 相当、边界更清 |
| Plugin 概念删除（A43） | ✅ | 减一个概念；dsh=外部依赖（deepseek 运行时），升级节奏进 open-questions |
| 跨系统 B 侧裁判（A45） | ⚠️ 中 | 判定留痕是硬要求；v1 建议默认判定方=role 权限表（最可预测），agent/上级 agent 判定按系统逐个放开 |

## 12. 更新后的落地顺序（覆盖 §4，含 v0.2）

1. workservice 骨架 → igniter+cored 最小可跑（git 后端+ops DB）
2. storage-system 本机目录（docs/files/snapshots/templates；nas/oss=部署方可选外接）
3. onedev adopt 纳管 + onedev-driver 五 op → **跑通首圈循环（core_system Goal.A4）**
4. console TUI 两层视角
5. TaskScheme 模板库补全 + install 流程（prometheus-template 首装）
6. Agent 层放开（Bind 分档放行，P8）

## 17. R14 增补：反馈闭环 / 内网集群 / agent_pool 机器

> 详见 impl/feedback-workflow.md、impl/kube-inner-integration.md、runtime/agent-pool-machine.md（公司实物信息只在公司 git 的 agent_pool 报告仓，A55）。

| 项 | 评级 | 关键约束 |
|---|---|---|
| 反馈闭环 workflow（feedback-remediation） | ⚠️ | 零新概念（A56）；高风险面集中在"发布正式环境"，机制上强制审批+分批+回滚；事件源 API 覆盖不齐以巡检兜底 |
| 事件源 watch（反馈/工单/监控三源） | ⚠️ | 能 API 的 watch、不能的页面探针；P3 巡检兜底丢事件 |
| 内网集群 Connector（受限部署 SA） | ⚠️ | ops 上界=SA RBAC（workload 读写，无 create/delete）；patch 幂等=比较后写+dry-run |
| 90 项页面功能模块划分 | ✅ | 注册表=数据非文档（A58）；运维 UI 与背后系统合一注册；对账主键待定 |
| 双 dsh profile 分工（core-system / kube-inner） | ⚠️ | 自举依赖 core plugin v0；验收探针="第二个 profile 能跑通一次最小 core-workflow" |
| 跳板通道（跳板→入口宿主→集群 API） | ⚠️ | 多一跳；凭据全走 Provider.auth.secret；断链=Event(warn) 非静默 |

## 18. R14.8 四项接入（user-system / developer-system / deploy-system / event 扩展）

> 详见 impl/user-system.md、impl/developer-system.md §7、impl/deploy-system.md §5-6、runtime/event-bus.md。A59：零新概念，全部为既有概念的实例化。

| 项 | 评级 | 关键约束 |
|---|---|---|
| user-system 接 LDAP（认证走管理面 API + 同步走 LDAPS 双通道） | ⚠️ | 目录真相在 LDAP，本地表=投影；组→role 映射表声明式；凭据全 secret |
| user-system 接飞书（账号映射） | ⚠️ | LDAP↔飞书 userid 映射覆盖率<100%（花名差异）→ 未映射走群兜底+warn |
| developer-system 接公司 OneDev | ✅ | API/git 通道已实测；端点差异以实测快照为契约，conformance 兜底 |
| deploy-system 三渠道（kube / ssh-host / onedev-ci），每业务 DeployDesign 声明 | ⚠️ | kube 渠道受 SA 上界；ssh 渠道每业务自带容器名+健康命令声明；验收统一走 Verifying 相位 |
| event 扩展 Kafka 分发 | ⚠️ | Kafka=通知总线非真相源（内置 dsh 队列不变）；安装走公司发布管道（SA 无 create） |
| event→飞书→账号 | ⚠️ | 依赖账号映射（user-system U3）；限流+聚合+熔断防事件风暴 |

---

## 19. MVP 实证（dsh-core-agent 上线，2026-11-20）

§2 的三个硬前提第一次拿到**运行数据**，MVP（goal 生成最小自循环，跑在 inner-service）实测：

### 19.1 三硬前提的实证更新

| 硬前提 | 预测 | 实测 | 结论 |
|---|---|---|---|
| LLM 收敛性无法数学保证 | 重试上限+升级+回滚兜底 | GLM 两次网络瞬断、一次编造非法 Goal：全部走 重试≤2→Escalated→人 resolve 恢复，零静默错误 | **兜底链有效**；"诚实停下"（{"done":true} 出口）是必要设计——需求派生尽时 LLM 必然编造 |
| 文件夹无事务与 watch | 单写者队列+轮询 | 单进程 running-flag 串行 + 5m resync 全量复测，32 轮 tick 无竞态 | MVP 规模下成立；git 后端/对账仍按 §2 计划 |
| 必须有文档外点火器 | Igniter 三步 | 人装服务+人 POST 种子 Goal→此后自持（5 个 Goal 全自动完成归档） | 成立；自动 Igniter 仍是后补第一项 |

### 19.2 实测新风险（原可行性未覆盖）

| 风险 | 实测 | 对策（已落地/计划） |
|---|---|---|
| 归档命名冲突 | done/ 曾按 current.md 覆盖→已完成清单残缺→生成器重复派生 | 按 `<name>.md` 归档（已修）；正式版 apply 查重含全部分区 |
| 外部 LLM 网络瞬断频率 | 内网机器到外部 LLM provider 偶发 fetch failed | 重试带 4s/10s 退避（已修）；Escalated 人 resolve 是正确出路不是缺陷 |
| 推理模型 token 预算 | 所选 flash 档是推理模型，reasoning 先吃 max_tokens | maxTokens 预算按 reasoning 模型给足；flash 档够用（P8） |
| 危险意图白耗重试 | `rm -rf` 类 Goal 通过 Apply，3 轮后才 Escalated | exec 白名单校验前移进 Apply（已修，422 实测） |
| 机器级子 agent 需求 | MVP 单进程够用；console 对话/多系统时才需要 | 按 runtime/cross-agent.md（ctx.agents 原生父子）走，无需 fork dsh |

### 19.3 落地顺序修正（覆盖 §12 的 MVP 段）

MVP 已交付：goal 生成自循环 ✅ → 下一优先序调整：**① TaskScheme 沉淀机制**（concept-audit §2 唯一结构缺口）→ ② console 服务关注区+agent 对话（ctx.agents）→ ③ git 后端+每日对账 → ④ 权限系统+Gate 审批 → ⑤ 自动 Igniter。概念符合性总账见 mvp/concept-audit.md。
