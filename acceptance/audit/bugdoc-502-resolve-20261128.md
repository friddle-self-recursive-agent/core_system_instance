# 两份 502 BugDoc 解决与删除验收（task/self-recursive-core/bugdoc-502-resolve-delete-20261128）

日期：2026-11-28　判据：Task summary 1–4 + R-TYPE-3（verify 字段）+「确认解决后删除 BugDoc」用户指令。

## 结论

`Agent/global/bug-workflow-agent-502-20261127` 与 `Agent/global/bug-gh-issue-3-502-retry-20261127`（docType=BugDoc）
两份同病族文档对应的缺陷已按各自 `spec.fix` 落地并经机械+活体+agent 三路验证；随后经 delete face 删除（doc face 回查 404、
DocDeleted 两行留痕）。本任务 `Task.status` 已回写 `phase=done`，`lastAction` 含完整解决/删除留痕
（fieldManager=`task:self-recursive-core/bugdoc-502-resolve-delete-20261128`，rv=4→5）。
`gh-issue-trigger` 巡检运行面零改动。

## 1. 修复落点（三份 fix 逐项对应）

| fix 项 | 落点 | 机制 |
|---|---|---|
| ① code=0 空 reply 的 502 归一可重试瞬态 + 指数退避 + 上限 Escalate | `core_system_dsh_plugin/plugin/src/bridges/task-agent-runner.mjs`（headless 执行监护 runner）；`core_system/internal/approvaldiff/approvaldiff.go`（审批小 agent LLM 内核） | runner `classifyExit` 严格判据=`502 ∧ (code=0\|"code":0) ∧ (empty reply/stream\|did not stream)`；裸 502/exit 0 历史日志不误判。退避 `base×2^(n-1)`；approvaldiff `3s→6s`，上限产「Escalate / 判决不编造」失败词形 |
| ② headless 退出 → spawn 桥/Task watchdog 回收 | runner 监护 `dsh` 子进程 `close/error`；`bin/task-spawn.sh` 改走固定命令 runner（stdin 仍只递 taskPath，零 shell 拼接） | 重试上限或不可重试异常 → `POST /v1/apply` 写 `Task.status=failed + lastError`；`POST /v1/events` 发 `TaskStateChanged(failed)` + `Escalate`；单飞锁由调度器下一拍清，running 不再悬挂 |
| ③ `Task.lastAction` 细粒度心跳 | runner 每次拉起/退避/成功/失败均经 `/v1/apply`（`fieldManager=task-scheduler`，P2 status 单一写者）回写「第 N/M 次拉起」「退避 Xms」「headless 正常退出」等；409/rv 漂移重读一次 | 任务中心/控制台与 `GET /v1/tasks` 同源，可见逐次进度与失败原因 |

代码落地（本地合并队列语义，未直接 push 远端 main）：
- submodule `core_system` HEAD=`df81762`（基于最新 `1207924` cherry-pick；父仓 gitlink 一致）。
- plugin repo main=`1d66580`（`1d66580` 只改 gitlink；runner/测试实体在 `123ff3b` 收紧后字节不变）。
- 部署侧任务 spawn 脚本（不在公开仓，R-PUB-1 不适用）已切到 runner。

## 2. 机械验证

- plugin `npm test`（`env -u CORE_SYSTEM_SCHEME`）：**99/99 pass / 0 fail**（新增 `taskrunner.test.ts` 5 项：严格瞬态分类三反例、退避 1s→2s、上限 failed+两事件、非瞬态不重试+重跑成功）。
- Go `CORE_SYSTEM_SCHEME=<core_design/core/scheme.yaml> go test ./...`：**全包 ok**（新增 `approvaldiff_chat_test.go` 4 项：502 两次后成功、上限 Escalate、HTTP 200 body `code:0` 空 reply 也重试、403 不重试）。
- `connectops-code-audit/audit` 活体：`target=<部署根目录>/core-docs`、`schemePath=<部署根目录>/core-docs/core/scheme.yaml`、
  checks=R-PUB-1+R-ENG-7（cored-lint）→ `ok=true, findings=[], unbound=[]`，`auditId=audit-20261128T095357Z-5041c5b0`。
  诚实边界：docsRoot scheme 镜像与权威 scheme 当前字节漂移，本次用镜像自身作 schemePath，因此 mirror 闸属自比；
  新增 Go/TS 代码另由 `personal-info.sh` + `max-file-lines.sh` 直跑通过（均 exit 0，文件 99/171/400/99 行 ≤800）。
- agent 规则（R-TYPE-3 §6）：规则原文（`rule_pub.md#R-PUB-1`、`rule_eng.md#R-ENG-7/#R-ENG-8`、`task-scheduler.md §2/§4/§6`）+ 完整 diff 交独立 verifier；
  两轮 FAIL→修正→复核，终局 **VERDICT: PASS / FINDINGS: none**（证据：严格分类七组探针、字节一致 SHA、99/99 + Go 全绿、lint pass）。

## 3. 活体验收（mock 502）

临时 Task `Task/global/bugdoc-502-mock-probe-20261128` 经 Apply 落库；runner 注入 `node -e` 假命令输出
`dsh: SERVER: 502 ZCode did not stream: unexpected reply code=0/empty` 并 exit 1：

- 三次尝试 `class=transient-502`，退避 20ms/40ms（探针缩窗），上限后 `statusWritten=true`；
- `corectl task global/bugdoc-502-mock-probe-20261128` 读回 `phase=failed`、`lastError` 含 502 现场、`lastAction` 写明回收+告警；
- `corectl events --type TaskStateChanged` 命中 `dedupKey=task:global/bugdoc-502-mock-probe-20261128:failed`；
  `--type Escalate` 命中 `dedupKey=task-502:global/bugdoc-502-mock-probe-20261128:3`（level=error）——一个 lease 周期内失败且告警成立；
- 重跑（同 runner 注入 exit 0）→ `phase=running`、`lastAction=headless 正常退出`，无新增 Escalate；探针对象随后 delete face 清理（DocDeleted 留痕）。
- 控制台与 `GET /v1/tasks` 同源读面，失败态/`lastError` 可见（经 corectl 同 API 实测）。

## 4. 关联处置与边界

- developer-loop run 44（`workflow=core-workflow`，由 bug-gh-issue-3 触发、挂 AwaitingApproval）与本任务 fix①重复：
  `POST /v1/events {type:ApprovalRejected, involved:Workflow/global/core-workflow, run:44,
  dedupKey:"approval:Task/self-recursive-core/bugdoc-502-resolve-delete-20261128:takes-over:bug-gh-issue-3-502-retry-20261127"}`
  → run 44 `phase=Failed, status=failed`，history 末行 `AwaitingApproval --ApprovalRejected--> Failed`；
  本任务 run 92 与其他挂起 run 未受影响（定向 run=44）。事件无字段携带备注，接管说明落在 dedupKey + 本 Task.lastAction + 本档。
- `gh-issue-trigger` 巡检运行面（Workflow/ConnectorOps/巡检命令）零改动；仅消费其既有 BugDoc 结论，不重跑九节点。
- 已知边界（如实注记）：cored 事件去重窗 5s，同名 `task-502:<id>:<attempt>` 重复上报会聚合（本路径每次终态仅发一次）；
  scheme 镜像漂移未在本轮同步（不属本任务写集）；代码本地提交未 push，push 由部署侧决定。

## 5. 删除留痕

| 对象 | fieldManager | 结果 |
|---|---|---|
| `Agent/global/bug-workflow-agent-502-20261127` | `task:self-recursive-core/bugdoc-502-resolve-delete-20261128` | `deleted=true, rv=1`，回查 404，DocDeleted 事件在账 |
| `Agent/global/bug-gh-issue-3-502-retry-20261127` | `task:self-recursive-core/bugdoc-502-resolve-delete-20261128` | `deleted=true, rv=1`，回查 404，DocDeleted 事件在账 |

删除动作已写入本任务 `status.lastAction`（见 §结论），满足「删除动作写进本任务 lastAction 留痕」。
