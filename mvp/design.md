---
name: mvp-goal-generation
docType: ImplDoc
scope: core_system/default
ownerRefs: [{kind: ServiceInstance, name: core_system/default}]
labels: {tier: mvp}
---
# MVP 设计：支持生成 Goal 的最小自循环（dsh-core-agent）

## 1. 定位与 mapping

core 的第一版可运行形态 = **dsh-core-agent**：跑在机器 inner-service（10.10.32.12，DNS `dsh-core-agent.service.code27.cn` 已指向本机）上的 dsh 宿主 + core plugin，npm 分发。目标只有一个——**跑通最小自循环**：

```
Goal(种子) → 对账(acceptance probes 全量复测)
   ├─ 有 drift → Plan(PlanDoc) → Execute → Verify → Status
   └─ InSync   → Generate(生成下一个 Goal 提案) → Apply 入库 → 下一轮
```

| 上游条款 | 本 MVP 落点 |
|---|---|
| Goal A2 冷启动闭环 | 人装好服务+人给种子 Goal，此后自循环自持（Igniter 自动化的最小演示） |
| Goal A4 一次真实 Workflow 走通 | core-workflow-mvp 态机（本文 §3），每轮留 SessionLog |
| Goal A3 acceptance 可数据判定 | acceptance 强制引用已注册 probe（本文 §2 规则 3） |
| P6 意图不可私改 | generator 只产提案区文档，过 Apply 管线才生效 |
| A39/A43 core=dsh plugin | dsh-core-agent 即一个 dsh plugin（架构文档 §1） |

## 2. Goal 生成（本 MVP 的核心能力）

| 来源 | 触发 | 说明 |
|---|---|---|
| 人种子 | `POST /api/goals` 或手放 docs/goals/ | 第一个 Goal 必须由人给（点火）：内容="把自循环跑起来" |
| 自生成 | 上一 Goal acceptance 全过 → generator | 依据 requirements 存档条目 + 最近 DriftReport 产出下一个 Goal 提案 |
| requirements 派生 | generator 的输入之一 | requirements/*.md 的 acceptance 条目逐条转 Goal（可验证的先转） |

规则（机制保证，不靠模型自觉）：

1. **生成≠生效**：generator 产物先落 `docs/goals/proposals/`（提案区），过 Apply 管线（frontmatter 校验 + acceptance 必须引用已注册 probe）才进 `docs/goals/` 生效区。agent 永远不就地改已生效 Goal。
2. **一次一个当前 Goal**：`state/pointers.json` 指向当前 Goal；自生成 Goal 入队排队，不并发多意图（MVP 无优先级）。
3. **acceptance 必须可判定**：每条 acceptance 必须带 `probe: <probe-id>`（http/exec/file 三类内置探针，见架构文档 §4）；无 probe 引用的条目 Apply 直接 422 拒绝。验收数据化，无"凭感觉验收"。
4. **自生成上限**：每 tick 最多生成 1 个新 Goal。requirements 派生队列空且当前 Goal InSync 时循环进 Idle——诚实停下，不编造工作。

## 3. 最小自循环状态机（core-workflow-mvp）

```
 Seed(无 Goal：等种子/派生) ─► Analyze(probes 全量复测)
                                  │
              ┌────── drift ─────┤ InSync ──────┐
              ▼                                 ▼
        Plan(PlanDoc 落档)               Generate(提案→Apply)
              ▼                                 │
        Execute(exec 白名单工具)                 │
              ▼                                 │
        Verify(probes 复测)                     │
              ├─ 过 ──┐                          │
              └─ 不过 ─► Backoff(≤3) ─► Escalated(停机+标红,等人)
                      │                 │
                      ▼                 ▼
        Report(Status 回写 + SessionLog 归档) ◄┘
                      ▼
        CoolDown(间隔) ─► 下一 tick
```

相对完整 core-workflow（runtime/workflow-runtime.md）的显式裁剪，每条都标注后补路径：

| 完整设计 | MVP | 后补 |
|---|---|---|
| 触发五源（watch/metric/定时/Apply/人工） | 仅 timer(resync) + Apply 触发 | Connector watch 随首个真实 Connector |
| Gate/审批（权限系统） | 无审批点；autoLevel=auto，admin 唯一角色 | 权限系统接入时启用 Gate |
| Event 独立队列+dedupKey | 内存数组+去重键，落 SessionLog | dsh core plugin 事件面 |
| ops DB（SQLite WAL） | state/ JSON + 每轮 SessionLog md | 每日对账探针后补 |
| 预算（minutes/tokens/mutations） | 每 tick maxMinutes 单闸 | 预算三闸全量 |
| Escalate 通知链 | Console 标红 + DriftReport 落档 | Notification 接入 |
| workflow 规则面（enabled/services/llm 配置、上游 global 汇聚、默认 skill 查文档命令） | MVP 固定 core-workflow-mvp 单实例 | 按 concepts/workflow.md R3 批次接入 |

## 4. 验收（本 MVP 自己的 acceptance，自指示范）

- M1. `dsh-core-agent.service.code27.cn` 可达：`GET /api/status` 返回 200。
- M2. 种子 Goal 一轮走通：Analyze→Execute→Verify→Status.conditions Ready=True，全程 SessionLog 留痕。
- M3. 自生成：当前 Goal InSync 后，产出一个新 Goal 提案并通过 Apply 入库（frontmatter + probe 引用校验全过）。
- M4. 非法 Goal 被拒：acceptance 无 probe 引用的 Apply 返回 422 且不入库。
- M5. `systemctl status dsh-core-agent` active；服务重启后循环从 state/ 恢复继续（幂等重入，P4）。
