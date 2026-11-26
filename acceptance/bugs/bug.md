---
name: architecture-and-runtime-bugs
docType: VerifyDoc
scope: core_system
ownerRefs: [{kind: ServiceDesc, name: core_system}]
---
# Bug 与架构矛盾清算基线（bug.md · 临时文档）

> **[临时文档 / R-DOC-10 生命周期约定]**：正式设计中不一致的地方就是这些 Bug，本文件是驱动修复与验收的**中间临时产物**。当某项任务完成并经 Verify 验证 OK 后，该 Bug 条目即刻删除；**当全部条目验证 OK 后，本文件（含 `bug.md.metadatainfo` 侧车）直接 `git rm` 删除**，不保留永久历史 Bug 台账。
> 概念依据：core_design [rule/rule.md](../../../core_design/rule/rule.md)（R-DOC-6/7/8/9/10、R-CTX-1..8、R-ENG-4）与本仓 [runtime/acceptance.md](../../runtime/acceptance.md)。
> 定位：本文件汇总系统概念与运行时对账中检出的 **14 项架构矛盾、机制不足与后期隐患（BUG-001 ~ BUG-014）**、裁决修复方案及**机读验收判据**，作为 workflow loop 验收报告（`acceptance/loop-<seq>.md`）的验证基线（验证 OK 后即消）。

## 1. 缺陷与架构矛盾总表

| 编号 | 模块 | 矛盾 / 缺陷现象 | 后果（若不修复） | 裁决修复方案 | 验收判据 ID |
|---|---|---|---|---|---|
| **BUG-001** | Session / Context | **上下文机制「三代同堂」**：`agent.md`（按需自取）、`agent-service-protocol.md`（Catalog 预插）、`context.md`（两段式 RAG）三套说法并存互斥 | Agent 启动行为分裂，无法统一审计上下文来源 | 统一为**三段式逻辑 Session**：①第一段侦察（预插基础命令+目录 Index，按 Tag 触发 `TagCtxShard`，仅对差量 Tag 拉取 Tag/TagRule/四族/Event/**近期相关 Session**）→ ②第二段执行（会话自复用+JIT 增量更新）→ ③第三段**异步**总结演化（提 Proposal / 归因补缓存 / 防刷分 Rerank + **独立审核 Agent 裁决**） | `B1` / `C6..C11` |
| **BUG-002** | Scoring / Metadata | **打分标度三套混用**：文档 `importance` 用 `0–100`、事件与会话 `importance` 用 `1–5`、`tagRelevance` 与 `affinity` 用 `0–1`，且缺全局相关性公式 | 跨族检索排序失真，阈值与权重无法对齐 | 全系统一切分值（`importance`、`tagRelevance`、`affinity`、`humanScore`、事件 `importance`）**统一为 `0–100` 标度**；建立唯一全局相关性基元 **`Relevance(A, B) ∈ [0, 100]`** | `B2` / `C1..C3` |
| **BUG-003** | LLM Inference / KV Cache | **每轮新建侦察重排头部击穿 Prefix KV Cache**：每次交互都重新拼装头部 ContextPack，破坏前缀字节一致性 | LLM Prefill 延迟与 Token 成本飙升 5~10 倍 | **会话本身跨轮自复用**（多轮对话复用本 Session）；`CtxCache` 分片按规范字典序定序拼装并在会话内按需触发任务缓存；**`CtxCache` 容量与每次拿到的 `takeBudget` 均可动态调整** | `B3` / `C4` / `C8` |
| **BUG-004** | CtxCache / Retrieval | **离散 Tag 空间整包 `Cosine ≥ 0.9` 高漏判与高误判**：10~20 个 Tag 绑成整包，差 2 个 Tag 即整包 miss | 缓存命中率极低，几乎每轮退化为全量侦察 | 改为**按单 Tag 细粒度分片触发缓存（`TagCtxShard[tagType:tag]`）** + **非对称加权覆盖率（Tversky Recall `TagCoverage(Task, Cache) ≥ 90`）**；第一段仅差量侦察未命中 Tag | `B4` / `C6` |
| **BUG-005** | DocIndex / Storage | **`DocApplied` 触发全量索引重建与缓存失效写放大雪崩** | 频繁 Apply 或 Rerank 回写引发 O(N) 级联重建风暴 | 变更文档仅增量更新自身 chunk；对关联文档与缓存分片计算 `Relevance(UpdatedDoc, B)`，**仅当 `≥ rebuildThreshold`（缺省 75，可通过调整相关度算法与阈值控制）时才标 stale 并触发重建**；侧车仅在定时导出 Git 时刷新 | `B5` / `C7` |
| **BUG-006** | Rerank / Evolution | **连续同质任务刷分导致 `Importance` 分数通胀（Score Inflation）& 自总结直接 Apply 失控** | 连续 5 个同域小任务把边缘文档刷到 100 挤出 L0 宪法；Agent 自总结自写库易强化错误 | ① 局部高频只调 `tagRelevance`；② 全局 `Importance` 乘以**跨任务多样性折扣** $w_{\text{div}}(T_i)=1-\max_{j<i}\text{Relevance}(T_i,T_j)/100$ + **L0 刚性保底 95** + **界面人类评论因子（`humanScore` 0–100）**；③ 第三段**异步执行**，实行**正向归因裁剪**（`used_effective / queried_irrelevant / missed_in_phase1`）与 **Proposal 查重门槛（`Relevance ≥ 85` 合并）**，且**必须经另一独立审核 Agent（Judge Agent）裁决通过**后方可 Apply | `B6` / `C10..C12` |
| **BUG-007** | BusinessSystem / EventBus | **业务系统混入最外层根项目 & 把控制面带去重的 Event Bus 当成财务账本（Ledger）** | 单 `cored` 仅挂单 `docsRoot` 导致多仓冲突；控制面 `dedupWindow` 会吞没同金额并发财务分录导致烂账 | ① `business-system` 不在最外层根项目中，单独设计，业务实例（如 `sybran`）运行**第二个独立的 `cored` 与独立 `docs DB`**；② **高频业务流、财务会计分录与逐笔对账由业务代码承接，自己走自己的内部事件与账本**；外层控制面只收**系统级事件、报警事件、对账失败事件** | `B7` |
| **BUG-008** | Scheme / Engineering | **单文件多 Scheme 耦合 & 改 Scheme 值与触发代码改动边界不清** | 单文件膨胀难维护；每次简单编排若都重编译代码则架空 TaskScheme，反之契约变了不改代码则运行时 unbound | ① **R-DOC-8**：Scheme 按 `aspect: <xxx>` 细粒度拆分；**禁止多 Scheme 在一个文件**（仅 `import` 导入包例外，落库必拆单文件单 Scheme，checker=`lint/single-scheme.sh`）；② **R-ENG-4**：只改已支持 Scheme 的值与行为描述免改代码；值不支持或改 Scheme 契约必自动触发代码改动 | `B8` |
| **BUG-009** | Storage / Git | **Git 文件树作运行时主存储的锁竞争与提交噪音** | 高频 Apply 与并发读写受限于 git 锁 | **R-DOC-7**：默认权威切换为 **SQLite `docs DB`**（`--docs-backend sqlite` 缺省，root 禁选 git）；Git 退回**定时按规则导出并 push 远程的公开/备份载体** | `B9` |
| **BUG-010** | Event / Agent Scope | **底层 `Heartbeat` 等事件缺一等建模或混入默认界面 + Event 缺 `scope` 与 Agent `eventScopes` 约束** | 高频心跳淹没人类与 Agent 视野；Agent 可能越界消费其他 Service scope 的事件导致串台 | **event.md 规则 18–19 / agent.md 规则 8**：① 注册 `Heartbeat` 事件（与 `ReconcileTick` 等同属 `tier: infra` + **`visibility: default-hidden` 默认不展示**）；② Event 强制带四层 `metadata.scope`，Agent 声明 `spec.eventScopes`，派发与消费双侧强制校验 `event.metadata.scope ∈ agent.spec.eventScopes` | `B10` |
| **BUG-011** | Traceability / Docs | **`ServiceDesc` 设计文档与 `ServiceInstance` 实现文档 `1:N` 缺 `[metadata 关联]` 追踪** | 1 篇设计对应多篇 `ImplDoc`/`VerifyDoc` 时，设计更新无法自动标记下游 N 篇实现过期（文档腐化说谎） | **R-DOC-9**：在 frontmatter `metadata.trace` 与 `<doc>.md.metadatainfo` 建立双向 `1:N` 关联（`ImplDoc/VerifyDoc` 声明 `trace.implements`/`verifies` + `designRev`，`DocIndex` 自动反向聚合 `trace.implemented_by`/`verified_by`）；设计更新自动标下游 N 篇实现 `stale` | `B11` |
| **BUG-012** | Rollback / Undo | **回滚未区分「要不要回滚 + 四类回滚方式 + 回滚文档描述」** | 不可逆操作被错误尝试回滚，或需人/Agent 介入的半成品缺少回滚文档描述 | **workservice.md 规则 8 / task-scheme.md 规则 8**：声明 `rollback: {policy: never\|auto\|ask\|optional, type: irreversible\|code\|agent\|human, description, docRef?}`，明确要不要回滚、回滚类型（无法回滚/代码/Agent/人）及回滚文档描述 | `B12` |
| **BUG-013** | Apply / Concurrency | **两个并发冲突任务在 Apply 关口缺明确二选一询问裁决** | 冲突任务后台盲目重试或静默覆盖 | **apply.md 规则 7 / task-scheduler.md 规则 11**：两个冲突任务在 `Apply` 关口被乐观锁拦下（最终一致）；第一个 Apply 后，第二个判断有无冲突，有冲突**直接询问「暂停第一个任务 (`pause-first`) 还是放弃当前任务 (`abort-current`)」** | `B13` |
| **BUG-014** | Security / TrustLevel | **外部系统 `Provider`/`ConnectorOps` 缺 `trustLevel` 与 Workflow 级内容检验门** | 外部不可信内容未经检查直入 Context 引发注入或污染 | **provider.md 规则 9 / connector.md 规则 10 / workflow.md 规则 21**：默认内部系统均为 `trustLevel: trusted`；外部系统 `Provider`/`ConnectorOps` 添加 `trustLevel: external`；Workflow 级可配置 `trustGate`（`mode: code \| agent`）判断一遍内容是否 OK | `B14` |

---

## 2. 详细根因与修复契约

### BUG-001 & BUG-003 & BUG-004：三段式 Session + 按 Tag 细粒度触发 `TagCtxShard` + 会话自复用
- **根因**：早期设计分别在不同阶段引入了按需查询 Skill、Service Catalog 预插入和两段式整包 RAG，未统一生命周期；且整包 `Cosine(tagSig) >= 0.9` 在离散 Tag 空间极其脆弱，每次重排头部又破坏 LLM Prefix KV Cache。
- **修复契约**：
  1. **第一段（获取上下文侦察段）**：预插基础命令规范 + 顶层目录 Index；按任务 Tag 细粒度触发 `TagCtxShard[tagType:tag]`（或 `TagCoverage >= 90` 的组合缓存），**仅对未命中/stale 的差量 Tag** 调用命令拉取完整 Tag/TagRule、四族对象、近期 Event、**近期相关 Session** 及 `importance / Relevance(A,B)`。
  2. **第二段（任务执行段）**：多轮对话始终复用本 Session（前缀按 `tag_type:tag` 规范定序不抖动，保 Prefix KV Cache），中途按需触发任务缓存并支持 JIT 增量更新；`CtxCache` 容量与每次拿到的 `takeBudget` 均动态可调。
  3. **第三段（异步总结与演化段）**：第二段结束即返回结果，后台由 `SessionClosed` 异步拉起第三段。

### BUG-002 & BUG-005 & BUG-006：0–100 全局相关性公式 + 防同质刷分算法 + 独立审核 Agent + 阈值控重建
- **全局相关性公式**：
  $$\text{Relevance}(A, B) = \text{clamp}_{0..100}\Big( 0.45 \cdot S_{\text{tag}}(A,B) + 0.20 \cdot S_{\text{aff}}(A,B) + 0.25 \cdot S_{\text{kw}}(A,B) + 0.10 \cdot S_{\text{scope}}(A,B) \Big)$$
- **防同质刷分 Importance 公式**：
  $$\text{Importance}(B) = \text{clamp}_{\text{Floor}(\text{level})..100}\Big( \alpha_L \cdot I_{\text{base}}(\text{level}) + \alpha_H \cdot I_{\text{human}}(B) + \alpha_E \cdot \Delta_{\text{emp}}(B) \Big)$$
  其中经验项每笔任务增益乘以**跨任务多样性折扣**：
  $$w_{\text{div}}(T_i) = 1 - \max_{j < i} \frac{\text{Relevance}(T_i, T_j)}{100}$$
  5 个高度相关的同质任务只提升局部 `tagRelevance`，不刷高全局 `Importance`；L0 宪法刚性保底 `95`；Console 审核界面提供**人类评论因子 `humanScore (0-100)`**；且第三段产出的 Rerank / 缓存归因（`used_effective / queried_irrelevant / missed_in_phase1`）/ Proposal（`Relevance >= 85` 查重合并）**必须经另一独立审核 Agent（Judge Agent）裁决通过**后才可 Apply。
- **按相关性阈值抑制重建**：`DocApplied` 仅对 $\text{Relevance}(D_{\text{updated}}, B) \ge \theta_{\text{rebuild}}$（缺省 75）的条目触发失效与重建。

### BUG-007：业务系统独立设计与账本/控制面事件严格分离
- **根因**：支付与财务工程（Payments Engineering Book / Tensor Labs 复盘）证明，因果通知流（Event Bus，允许去重与合并）绝不能充当会计分录账本（Ledger，要求逐笔 ACID、零去重、借贷相等）。
- **修复契约**：
  1. `business-system` 不在最外层 `core_system` 根项目中，单独设计；`sybran` 运行自己独立的第二个 `cored` 与独立 SQLite `docs DB`。
  2. 业务高频流、财务分录与逐笔对账由**业务代码承接，自己走自己的内部事件与账本**。
  3. 外部控制面 Event Bus **只承接系统级别事件、报警/越限事件、以及对账失败事件**。

### BUG-008 & BUG-009：Scheme 细粒度 `aspect` 与单文件单对象 + SQLite 默认权威与定时 Git 导出
- **Scheme 铁律（R-DOC-8 / R-ENG-4）**：
  - 按 `spec.aspect` 细粒度拆分；**自己保存的权威文件严禁多 Scheme 在一个文件**（仅 `import` 导入包允许输入多 Scheme，落库必拆单文件，由 `lint/single-scheme.sh` 机械校验）。
  - 只改已支持 Scheme 的值与行为描述 → 免改代码即刻生效；Scheme 值不支持或 Scheme 契约改动 → 必触发代码仓库改动与构建。
- **SQLite 默认权威（R-DOC-7）**：
  - `--docs-backend sqlite` 为默认权威（root 部署禁选 git）；Git 仓作为定时按规则导出（含 `.md.metadatainfo` 侧车）并 push 远程的公开/备份格式。

---

## 3. 验收报告必检探针清单（加入 Workspace 验收报告基线）

每轮 `acceptance/loop-<seq>.md` 验收报告的 `probes` 区必须包含以下 `B1–B9` 回归验证项：

- **`B1`（三段式 Session 闭环）**：第一段包含基础命令+目录 Index+近期相关 Session 检索，第三段由 `SessionClosed` 异步触发且不阻塞主会话返回。
- **`B2`（0–100 标度统一）**：`lint/metadatainfo.sh` 全绿；文档、事件、亲和矩阵与 `/v1/context/relevance` 分值全在 `0–100`。
- **`B3`（会话自复用与缓存双可调）**：多轮对话复用同一 Session 保 Prefix KV Cache；`CtxCache` 容量与 `takeBudget` 动态调整生效。
- **`B4`（按 Tag 细粒度触发缓存）**：任务命中已缓存 Tag 时直接触发 `TagCtxShard[tagType:tag]`，第一段仅差量侦察未命中 Tag。
- **`B5`（按相关性阈值抑制重建）**：更新单篇文档后，仅 `Relevance >= rebuildThreshold` 的高相关分片标 stale 重建。
- **`B6`（防刷分 + 人类评论因子 + 独立 Agent 裁决）**：同质高相关任务经 $w_{\text{div}}$ 折扣不刷高全局 `importance`；L0 保底 $\ge 95$；UI `humanScore` 可评；演化草案未经独立 Judge Agent 审核不落库。
- **`B7`（业务系统双 `cored` 与账本/事件分离）**：业务系统独立 `cored` 运行；控制面 `event_log` 仅收系统级/报警/对账失败三类事件，零逐笔财务流水。
- **`B8`（单文件单 Scheme 与代码触发边界）**：`lint/single-scheme.sh` 全绿；改已支持 Scheme 值免改代码，改契约触发代码构建。
- **`B9`（SQLite 默认权威与定时 Git 导出）**：root `cored` 默认挂载 SQLite `docs DB`（无 `--docs-backend git`），定时导出 Git 工作树与侧车幂等可推。
- **`B10`（底层 `Heartbeat` 默认隐藏与 Event/Agent Scope 隔离）**：`Heartbeat` / `ReconcileTick` 等 `tier: infra` 事件默认 `visibility: default-hidden` 不出现在默认事件流/关注报告/第一段侦察；Event 必带 `metadata.scope`，且越出 `agent.spec.eventScopes` 的事件被派发/消费闸门拦截。
- **`B11`（`ServiceDesc` ↔ `ServiceInstance` 1:N `[metadata 关联]` 追踪）**：`ImplDoc` / `VerifyDoc` 的 `trace.implements` / `verifies` 在 `DocIndex` 与 `.md.metadatainfo` 中正确反向聚合为设计文档的 `trace.implemented_by`（1 对 N）；上游设计 `resourceVersion` 推进时自动将下游 N 篇实现文档标为 `stale`。
- **`B12`（回滚策略、四分类与回滚文档描述）**：`WorkService.tools` 与 `TaskScheme.steps` 支持 `rollback: {policy: never|auto|ask|optional, type: irreversible|code|agent|human, description, docRef?}`；凡需回滚的操作必带文档描述并按 `irreversible / code / agent / human` 正确分派。
- **`B13`（并发冲突任务在 Apply 关口拦截并直接询问）**：两个同时改同一对象的任务在 `Apply` 关口（乐观锁 `409`）被拦截；第二个任务检测到与第一个任务冲突时，直接触发询问「暂停第一个任务（`pause-first`）还是放弃当前任务（`abort-current`）」。
- **`B14`（外部系统 `trustLevel` 与 Workflow 级 `trustGate` 内容检验）**：内部系统默认 `trustLevel: trusted`；标记 `trustLevel: external` 的 `Provider` / `ConnectorOps` 返回内容进入 Workflow 时，按 Workflow 级可配置的 `trustGate`（`mode: code | agent`）执行内容校验。
