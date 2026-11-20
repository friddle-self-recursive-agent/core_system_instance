---
name: impl-developer-system
docType: ImplDoc
scope: builtin-developer-system
ownerRefs: [{kind: ServiceDesc, name: builtin-developer-system}]
---
# ImplDoc — builtin-developer-system 设计（非实现）

> R1.6 指定的首个设计对象：**如何利用现有 onedev、如何开发、如何满足开始的循环**。
> 原则：onedev 是既有资产（WorkService 纳管，能不重装就不重装）；build 默认本地（R1.3）。

## 0. 现状盘点

| 已有 | 在本设计中的位置 |
|---|---|
| onedev 实例（git 托管 + CI 定义） | WorkService `onedev`（capabilities: scm, ci；adopt 模式纳管，不重装） |
| 本机（dsh 宿主） | 唯一 build executor（exec-local） |
| storage NAS/OSS | 产物与归档 |

## 1. 架构

```
push ──► onedev(scm) ──webhook──► Event(ExternalChanged)
                                        │
              core dispatch（selector domain=devtools）
                                        ▼
   Loop(developer-system-main) → Agent(dsh基座)
                                        │ 选 TaskScheme build-and-verify
        ┌───────────────────────────────┼──────────────────────────┐
        ▼                               ▼                          ▼
  onedev-driver.checkout         dsh exec-local               oss-driver.put
  (clone/取ref)                  ./gradlew build+test          产物入库(digest)
        └───────────────────────────────┴──────────────────────────┘
                                        ▼
              onedev-driver.build-status（回写构建结果到 onedev）
                                        ▼
              verify（重跑探针+Metrics 复测）→ Status 追平 → Event(DriftFixed)
```

要点：**onedev 只做 scm + 状态看板 + webhook 源**；构建执行在本机 dsh（"默认本地 build"，R1.3）。onedev 自带的 CI 执行器不启用（或仅留作 fallback），避免两套构建真相。

## 2. onedev-driver（Connector）契约

| op | onedev 侧 | 幂等性 |
|---|---|---|
| `watch` | REST/webhook：push、PR、build 状态 → Event | dedupKey=repo+ref+sha |
| `checkout` | git clone/fetch（onedev=git 服务，凭证走 Credential） | 同 ref 重复=no-op |
| `build-status` | REST：上报构建结果（关联 commit） | 同状态重复=no-op |
| `gate-status` | 保护分支/红线状态读写 | 读比写 |
| `verify` | 服务健康（/api/server-info）+ 版本探测（VersionSupported 条件） | — |

**不做的**：不用 onedev 内置 CI 配置面当"构建定义的唯一真相"——**构建定义的唯一真相是 TaskScheme 文档**（buildspec 文件由 TaskScheme 渲染生成/对账，onedev 里的是投影）。这是"意图在文档、现实在外部、Loop 拉齐"的直接应用。

## 3. 如何开发（落地顺序）

1. **onedev 纳管**：onedev-template（mode: adopt）→ 安装即登记 WorkService + webhook 注册（finalizer 记副作用）。
2. **onedev-driver**：实现 §2 五 op（REST+git），契约测试先行（conformance：每 op 三例——首跑/重跑幂等/失败路径）。
3. **TaskScheme `build-and-verify`**：先手工跑通五步（execution-model.md §3 模板），再入库过审。
4. **Loop(developer-system-main)**：watch push 事件 + 2m 巡检；预算 20min/轮。
5. **产物链路**：oss-driver.put + digest 回写；红线=gradle test+lint 全绿才 put。
6. **验收对账**：Goal.A1–A5 每条挂一个探针（A1=pickup p95 指标；A2=gate-status 抽查；A3=产物 digest 抽验；A4=通知演练；A5=本循环自身）。

## 4. 如何满足"开始的循环"（首圈走查）

冷启动后的第一个完整 Loop（loop/loop.md §5 同构，换成 onedev）：

```
1. 开发者 push → onedev webhook → onedev-driver.watch → Event(ExternalChanged, source=onedev)
2. core dispatch → Loop(developer-system-main) → Agent(dsh)
3. 装配 L0：Goal.A1(p95<3min)/A2(红线100%)/A3(产物入库)
4. Analyze：新 commit 未构建 → DriftReport{d1: commit-unbuilt}
5. Gate：动作=clone+build+put（白名单内）→ 放行
6. Plan：build-and-verify 五步 dry-run
7. Execute：checkout→build→gate→artifact→report（actionLog 落盘）
8. Verify：产物 digest 在 OSS 可查 + build-status=success + p95 实测
9. Report：Status.conditions[Ready=True]、DriftReport 归档、Event(DriftFixed)
10. CoolDown→Idle；console 信息流层全程可见
```

这一圈跑通 = core_system Goal.A4 验收 = "开始的循环"成立。**此前不引入任何第二个系统**（防贪多）。

## 5. guarantees

- 红线不可旁路：gate-status 探针抽查保护分支配置，发现宽松化=drift 自动收紧或升级。
- 本地 build 不私扩：executor 数/规格写在 Desc，Instance 侧改动=drift。
- 构建可复现：产物带 commit+digest，任一产物可回溯源码与 TaskScheme 版本。

## 6. 可行性（摘要，全文见 feasibility.md）

| 项 | 评级 | 说明 |
|---|---|---|
| onedev REST 覆盖 | ⚠️ 中 | push/PR/构建状态 API 齐；保护分支配置面 API 较薄——gate-status 只读抽查起步，写侧人工+提案 |
| webhook 可靠性 | ⚠️ 低 | 丢失由 2m 巡检兜底（P3） |
| 单机 build 吞吐 | ✅ | 本地无队列远端；并发=1 起步（Desc 声明） |
| buildspec 单一真相策略 | ⚠️ 中 | 双源风险（TaskScheme vs onedev CI）——对账探针把 onedev 侧漂移当 drift 管 |
