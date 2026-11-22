---
name: mvp-concept-audit
docType: VerifyDoc
scope: core_system/default
ownerRefs: [{kind: ServiceInstance, name: core_system/default}]
labels: {tier: mvp}
---
# 概念符合性审计 — dsh-core-agent MVP（2026-11-20，基于运行证据）

> 依据：core_design/core/scheme.yaml v0.13 + concepts/ 全部 + principles.md P1–P10。
> 方法：对运行中的 dsh-core-agent 取运行证据（API/文档面/SessionLog/死信），逐条判定 **实现正确 / 裁剪(已标注) / 偏差(本次已修或后补)**。

## 1. P1–P10 原则流转判定

| 原则 | 判定 | 运行证据 |
|---|---|---|
| P1 一切皆文档 | ✅ | Goal/PlanDoc/SessionLog/DriftReport 全是 frontmatter 对象；state/ 是引擎写区非文档对象（A52 约定） |
| P2 Spec/Status 分离 | ✅ | docs/（人+generator 经 Apply 写）与 state/（引擎独写）物理分区；人改 state/ 无效（tick 重算覆盖） |
| P3 Level-triggered | ✅ | 每 tick 对当前 Goal **全量复测** probes（TickAnalyzed 事件 dedupKey=goal:tickN，实测连续 5 轮全量）；timer resync=5m 兜底 |
| P4 幂等 | ✅ | mkdir -p/printf> 修复步骤幂等（PlanDoc 实证）；Apply 幂等=同名查重（含 done/）→422；exec 命令幂等白名单 |
| P5 收敛非成功 | ✅ | 无"完成即终态"：InSync 后循环继续对账（req-version-note-004 连续 5 tick InSync）；终态只有 Escalated 等人 |
| P6 意图不可私改 | ✅ | generator 产物只进 proposals/，过 Apply 校验才入 queue/，晋升才成 current；全程未就地改已生效 Goal |
| P7 权限随文档走 | ⚠️ 裁剪 | 权限系统未实现（admin 唯一）；**但文档=权限面已实证**：exec 白名单校验在 Apply 前置（本次审计修正），危险 Goal 在文档入口即拒 |
| P8 机制不假设模型 | ✅ | LLM JSON 非法→重试≤2→Escalated（实测两次 fetch failed 全部诚实停机）；exec 白名单+危险令牌守卫双保险 |
| P9 最小自举 | ✅（演示版） | 人扮演 Igniter：装服务→人给种子 Goal→自持；自动 Igniter 后补 |
| P10 单一职责 | ✅ | store/apply/probes/llm/generator/workflow/console 各一职；tools 只做执行手无判断 |

## 2. 对象类型（kinds）判定

| kind | 判定 | 说明 |
|---|---|---|
| Scheme | ✅ | mvp/scheme.yaml 启动装载；未注册类型拒收（规则在 apply 校验） |
| ServiceInstance | ⚠️ 裁剪 | status.json 即实例 Status（conventions.status 子集：phase/conditions/drift）；instance.yaml 对象文件未物化（后补） |
| Agent | ⚠️ 裁剪 | dsh-core 自身未建对象文件；phase 态机在 status.json（后补） |
| Workflow | ⚠️ 裁剪 | core-workflow-mvp 内嵌 scheme 声明，未对象化；**本次审计已补 enabled/services/llm 字段声明**（对齐 A61 概念） |
| TaskScheme | ❌ 后补 | **最大缺口**：Plan 相位是 LLM 生成步骤直接执行，未沉淀 TaskScheme 对象；"同类兜底 N 次→必须提案 Scheme"（task-scheme.md §5）未实现。缓解：SessionLog 记录全部步骤可审计，DriftReport 记录失败防重 |
| WorkService/ConnectorOps | 后补 | tools 内置（exec/probe），无外部 WorkService |
| Provider | ✅ 子集 | GLM coding plan 绑定（env key，明文禁 ✅ .env 0600 不入库） |
| Ref/Role/User/Group/Notification | 后补 | MVP 单机单角色，未及 |
| Skill | ❌ 后补 | agent 默认 skill（查本系统命令）R3.1 未实现——MVP 循环直调 API 无 agent 会话层 |
| WorkServiceTemplate | 后补 | install 流程未及 |

## 3. 文档类型（docTypes）流转实证

| docType | 必填段校验 | 写者纪律 | 实证 |
|---|---|---|---|
| Goal | ✅ intent+acceptance+probe 引用全查（422 实测×3：无 probe/危险 cmd/同名重复） | 人+generator 经 Apply | 5 个 Goal 全生命周期 current→done 归档 |
| PlanDoc | ✅ intent/steps | agent（每次 Plan 必落档） | plans/ 6 份，步骤带白名单前缀（budget 段为 MVP 本地保留；scheme R17 已删预算） |
| SessionLog | ✅ phases/docsLoaded/outcome | agent（每 tick 一份） | sessions/ 32+ 份，含 probe 原始结果与 llmCalls |
| DriftReport | ✅ drifts/actions | engine（Escalated 必产） | drift-*.md 2 份（LLM fetch failed 与 plan 无步骤各一） |

## 4. 事件与路由判定

| 项 | 判定 | 说明 |
|---|---|---|
| Level 五级 | ✅ | debug 只进内存；error/fatal 落死信可见（3 条 Escalated 实测在 deadletter.json） |
| dedupKey | ✅ | 类型:键 60s 窗口；TickAnalyzed/InSyncReached 键含 tick 序号不被误吞 |
| dispatch 死信兜底 | ✅ | unroutable → state/deadletter.json |
| **定时巡检（TickDue）不进事件队列** | ⚠️ 裁剪 | **含义**：概念里"定时巡检到点"是事件来源之一（event.md 五来源，type=TickDue）；MVP 的 timer **没往事件队列发 TickDue，而是直接调 workflow tick**——少一跳但事件流里看不到定时轮。处置：mvp/scheme.yaml 如实改注"TickDue 未发射，timer 直触发"，保留注册；正式版要 tick 审计时再事件化 |
| **DocApplied 事件口径（R17 修正）** | ⚠️ 裁剪 | **设计口径**：文档修改默认=Agent 代改代审，改动先进**草稿缓存**（不经 Apply、不发事件）；人确定后调 **apply 命令**落库——**apply 必发 DocApplied**（apply=确认动作，事件是回执）。MVP 无草稿层、直接 apply，每次发事件与"apply 必发"一致，不算偏差；后补的是**草稿缓存层**（空草稿拒绝也随草稿层做，不再做 apply 侧内容级 no-op 检测） |

## 5. 审计发现并已修复的缺陷（这正是审计的价值）

1. **done/ 归档覆盖**（已修+数据恢复）：归档曾统一用 `current.md` 文件名互相覆盖 → 已完成清单残缺 → 生成器重复派生已需求（002/003 后缀假象）。修复：按 `<name>.md` 归档；历史数据已恢复（done/ 现 5 份全档）。
2. **危险 Goal 校验未前移**（已修）：exec 白名单只在执行期守卫，`rm -rf` 类 Goal 会白耗 3 轮重试才 Escalated。修复：guardExec 前移进 Apply 校验，422 拒收（实测）。
3. **需求派生尽后 LLM 被迫编造**（已修）：全部需求完成后生成器仍让 LLM 选"下一个"→编造无验收 Goal→被校验拒→Escalated。修复：prompt 增加 `{"done":true}` 诚实出口（实测 `insync-no-more-requirements`）。
4. **LLM 网络瞬断重试无退避**（已修）：3 次重试挤在 1.5s 内全失败。修复：4s/10s 退避。
5. **file 探针读目录报错**（已修）：exists 检查改用 stat，内容检查才 readFile。

## 6. 结论

- **概念主链（P1–P6/P8/P10 + Goal 四类型流转）实现正确且有运行证据**。
- 裁剪均有标注且后补路径明确（见 design.md 裁剪表）；唯一结构性缺口是 **TaskScheme 沉淀机制**（第 2 节）——它是四层执行模型的第三层，MVP 用 PlanDoc+SessionLog 顶住可审计性，正式版必须补。
- 本审计产出的 5 项修复已全部部署验证；service 稳态：InSync / Ready=True / done 全档。
