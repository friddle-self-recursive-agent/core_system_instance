---
name: impl-developer-system
docType: ImplDoc
scope: builtin-developer-system
ownerRefs: [{kind: ServiceDesc, name: builtin-developer-system}]
---
# ImplDoc — builtin-developer-system 设计（非实现；本地内置，与部署目标无关）

> **builtin 就是 builtin（2026-11-26 用户裁决）**：内置开发系统=**本地目录 + 本地 git 仓库（可配置 push 远程）+ 本地部署**，
> 零外部依赖起步，**与 sybran（或任何部署目标）无关**。部署实例（如公司 OneDev adopt）= workflow 节点绑定替换，
> 设计落 `sybran-developer-system` 仓（private）。
> R1.6 的原问题（如何利用 onedev）由此降格为**一个可插拔变体**，不再是前置条件。

## 0. 通用抽象：workflow 节点可配置不同 service + connectorOps

开发能力=一条 workflow（developer-main），**每个节点的 service 与 connectorOps 都是绑定声明**——换绑定=换部署形态，workflow 文档不变：

| workflow 节点 | builtin 绑定（缺省，零外部依赖） | 变体绑定示例 |
|---|---|---|
| scm / watch | gitfs（本地 git 仓；本地 commit→Event，本地 hook/巡检兜底） | onedev-driver（远程 SCM adopt：webhook+2m 巡检） |
| checkout | 本地 git fetch（同机路径） | onedev-driver.checkout（REST+git） |
| build | exec-local（本机 dsh，命令白名单） | exec-local（目标机）/ 其他 executor |
| artifact | storage-system（本地目录/OSS） | oss-driver（远程归档） |
| gate / notify | 本地红线脚本 + 本地通知 | 公司渠道（build-status 回写、gate-status 抽查） |

**这是"意图在文档、现实在外部、Workflow 拉齐"的节点级应用**：service/connectorOps 绑定写在节点声明里
（对齐 workflow.md 节点流转实现面=ConnectorOps），deployed 实例=另一组绑定值，不是另一份设计。

## 1. 架构（builtin 缺省形态）

```
本地 git commit（工作区内仓；origin 可选配置 push 远程）
        │  hook/巡检 → Event(ExternalChanged)
        ▼
   core dispatch（selector domain=devtools）
        ▼
   Workflow(developer-main) → Agent(dsh 基座) → TaskScheme(build-and-verify)
        ├─ checkout：本地 git fetch（同机）
        ├─ build：exec-local ./gradlew build+test（本机）
        ├─ artifact：storage-system 本地目录/OSS put（digest）
        └─ gate/notify：本地红线（test+lint）+ 本地通知
        ▼
   verify（重跑探针+Metrics 复测）→ Status 追平 → Event(DriftFixed)
```

要点：**构建执行在本机 dsh（"默认本地 build"，R1.3）；源码真相=本地 git 仓；红线=本地 test+lint**。
远程 SCM/CI 不启用时整条链零外部依赖——"开始的循环"不等待任何外部系统。

## 2. 本地 git 仓库（builtin 缺省 scm）

- 工作区内目录即仓（gitfs connector）：commit/push/branch 全本地；**origin 是可配置项**（github org / onedev / 任意远程），配了就 push，不配不阻塞任何环节；
- 凭据走 Provider（引用式）；本地仓的 Event 源=本地 hook（post-commit）+ 巡检对账（丢 hook 不丢事）；
- 产物带 commit+digest，任一产物可回溯源码与 TaskScheme 版本（可复现红线）。

## 3. scm connector 五 op 契约（可插拔；onedev 是首个实现）

| op | 语义 | 幂等性 |
|---|---|---|
| `watch` | scm 事件（push/PR/构建状态）→ Event | dedupKey=repo+ref+sha |
| `checkout` | clone/fetch 取 ref | 同 ref 重复=no-op |
| `build-status` | 上报构建结果（关联 commit） | 同状态重复=no-op |
| `gate-status` | 保护分支/红线状态读写 | 读比写 |
| `verify` | 服务健康+版本探测 | — |

**不做的**：不用外部 CI 配置面当"构建定义的唯一真相"——**唯一真相是 TaskScheme 文档**（buildspec 是投影，
对账探针把外部侧漂移当 drift 管）。onedev-driver（含 REST/git 实测契约）的实例绑定见
`sybran-developer-system` 仓 `docs/developer-variant.md`（private）。

## 4. 如何开发（落地顺序；builtin 先行）

1. **本地链路**（builtin 首圈，零外部依赖）：gitfs 本地仓 + exec-local build + storage 本地/OSS + 本地通知——先跑通 §5 走查。
2. **TaskScheme `build-and-verify`**：先手工跑通五步（execution-model.md §3 模板），再入库过审。
3. **Workflow(developer-main)**：watch 事件 + 2m 巡检。
4. **scm connector 契约测试**：五 op conformance（首跑/重跑幂等/失败路径）；builtin=gitfs 本地实现先行。
5. **变体接入**（可选升级）：onedev/远程渠道按节点绑定替换接入，绑定值与实测契约落 `sybran-developer-system` 仓。
6. **验收对账**：Goal.A1–A5 每条挂一个探针（A1=pickup p95；A2=红线 100%；A3=产物 digest 抽验；A4=通知演练；A5=本循环自身）。

## 5. 首圈走查（"开始的循环"；builtin 形态）

```
1. 开发者本地 commit → hook → Event(ExternalChanged, source=gitfs-local)
2. core dispatch → Workflow(developer-main) → Agent(dsh)
3. 装配 L0：Goal.A1(p95<3min)/A2(红线100%)/A3(产物入库)
4. Analyze：新 commit 未构建 → DriftReport{d1: commit-unbuilt}
5. Gate：动作=fetch+build+put（白名单内）→ 放行
6. Plan：build-and-verify 五步 dry-run
7. Execute：checkout→build→gate→artifact→report（actionLog 落盘）
8. Verify：产物 digest 在 storage 可查 + 红线=success + p95 实测
9. Report：Status.conditions[Ready=True]、DriftReport 归档、Event(DriftFixed)
10. CoolDown→Idle；console 信息流层全程可见
```

这一圈跑通 = core_system Goal.A4 验收 = "开始的循环"成立。**此前不引入任何第二个系统**（防贪多）；
onedev 等远程 SCM 是这一圈跑通**之后**的节点绑定替换。

## 6. guarantees

- 红线不可旁路：gate-status 探针抽查红线执行，发现宽松化=drift 自动收紧或升级。
- 本地 build 不私扩：executor 数/规格写在 Desc，Instance 侧改动=drift。
- 构建可复现：产物带 commit+digest，可回溯源码与 TaskScheme 版本。
- builtin 零依赖：断网/无远程 SCM 时整条链照常（origin 未配置只影响分发，不影响构建与验收）。

## 7. 可行性（摘要，全文见 feasibility.md）

| 项 | 评级 | 说明 |
|---|---|---|
| 本地 git 事件源 | ✅ | 本地 hook+巡检双通道，无外部依赖；丢事件由巡检兜底 |
| 单机 build 吞吐 | ✅ | 本地无队列远端；并发=1 起步（Desc 声明） |
| buildspec 单一真相策略 | ⚠️ 中 | 接入外部 CI 后出现双源风险——对账探针把外部侧漂移当 drift 管 |
| 变体绑定漂移 | ⚠️ 低 | 绑定在节点声明里（可 lint 校验 op 存在性）；实例值在 private 仓，公开面零锚点 |

**结论：可行。builtin=本地目录+本地 git+本地构建，一条 workflow 走天下；部署实例=节点绑定替换，设计与实现双分离。**
