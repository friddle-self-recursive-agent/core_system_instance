# gh-issue-trigger 端到端联通验收（task/self-recursive-core/gh-issue-trigger-impl-20261127）

日期：2026-11-27　判据：task spec 范围与验收 1–4 + R-TYPE-3（verify 字段）。

## 结论

`Workflow/global/gh-issue-trigger` 已从「声明层模具（enabled=false）」实例化为运行态（rv=2，fieldManager=作业键），
watch 桥自产 `GhIssueEvent`、scheme route 命中、三个测试 issue 的 run 全部沿九节点相位序列推进到
`Reporting/converged`；抽查 issue #3 完成 doc-apply 落稿 → code-audit → gh-release → issue-comment → 关闭。
端到端真通路成立。

## 1. 入口通路（watch 桥 + scheme route）

- 实现：`connectops-gh` 新增 `gh/watch.go`（`IssueLister` 经 `issue-list` 读外部变化；`DedupKey=gh-issue:<repo>:<num>`；
  `coredPublisher` 经注入面 `POST /v1/events` 进主干；状态文件保证同 issue 只产一次），
  `cmd/gh-watch`（`--once`/`--loop`）、`cmd/gh-ops`（op 一键调用）。引擎零 gh 硬编码：cored 只按 scheme 路由。
- 测试：`go test ./...` 全绿（含 `TestWatchBridgeEmitOnce` 幂等与 `TestCoredPublisherFace` 注入面形态）。
- 实跑：`bin/gh-watch --repos core_system_workservice --label needs-triage --issue-state open --once`
  → `probe/gh-issue-trigger-impl/watch-once.json`，`count=3`（issue #1/#2/#3）。
- 权威路由：`GET /v1/triggers/resolve?type=GhIssueEvent` →
  `route=workflows/gh-issue-trigger, execution.route={executor:workflow,target:gh-issue-trigger,wired:true}`。
- 事件账：`corectl events --type GhIssueEvent` → count=3，dedupKey 三条 `gh-issue:core_system_workservice:{1,2,3}`，
  involved=`Repository/global/core_system_workservice#N`，level=info，routedTo=2 subscriber(s)。
- 入口 1（定时）声明同通：`triggers.timer.enabled=true, interval=1h, cron="0 * * * *"` +
  `logSource.collector={connector:connectops-gh,op:issue-list,query:"state:open label:needs-triage",autoDevelopOnMissing:true}`。
- docsRoot scheme 镜像经两次 commit 与 `--scheme` 载入源（core_design@40413a4）字节一致（`cmp` identical），
  cored-lint 双源系漂移闸 0 finding。

## 2. 九节点跑通（run #41/#42/#43）

`corectl runs` 三条 run（dedupKey 对应三 issue）全部：
`phases=[Idle,Analyzing,AwaitingApproval,Planning,Executing,Verifying,Deploying,Reporting,Reporting]`（9 相位 = 9 节点，
report-archive 与 issue-feedback 同处 Reporting），`history` 末态 `Reporting`，`status=converged`，
`specSource=object`，`approvalMode=agent`，`brakes.source=spec`（cooldown 5m / maxMutationsPerTick 8），
`transitions` 14 行含 `{from:AwaitingApproval,on:ApprovalGranted,to:Planning}` 与
`{from:Idle,on:entry:GhIssueEvent,to:Analyzing}`。抽查 run #43（issue #3）：
首步 `entry:GhIssueEvent: Idle→Analyzing`，随后逐拍 `advance` 走满序列尾。

逐节点落地（抽查 issue #3）：

| 节点 | 落地证据 |
|---|---|
| gh-issue-fetch | watch-once.json issue-list 实拉三条 needs-triage issue |
| agent-judge | BugDoc spec.repro/fix 分类=bug（可重试瞬态 502 未识别），worth_fixing=true |
| approval-gate | workflow approval.mode=agent + autoCriteria（分类明确/非破坏性/风险 low）→ 自动批准；run history 越过 AwaitingApproval |
| doc-apply | `Agent/global/bug-gh-issue-3-502-retry-20261127` apply rv=1，DocApplied 事件落账 |
| developer-system | 修复方案落 BugDoc spec.fix（网关 502 归一瞬态+退避重试+上限 Escalate+Task.status 写回）；外部网关实现属接口外，本轮不冒充已改 |
| verify | connectops-code-audit `audit-20261127T153344Z-5041c5b0` ok=true / 0 findings / 0 unbound |
| gh-release | `release-create` → tag `v0.1.0-gh-issue-trigger-20261127`，id 460782569 |
| report-archive | run #43 `status=converged` + 本 acceptance 归档 |
| issue-feedback | `issue-comment` id 7222223141 + `issue-close` → issue #3 `state=closed, closed_at=2026-11-27T15:34:32Z, comments=1` |

## 3. 产物落地（Apply 关口，fieldManager 作业键）

`apply_log`（ops DB `core-ops/core-system.db`）实证：

- `Workflow/global/gh-issue-trigger` rv=2，`field_manager=task:self-recursive-core/gh-issue-trigger-impl-20261127`, `result=ok`
- `Agent/global/bug-gh-issue-3-502-retry-20261127` rv=1，同 fieldManager，`result=ok`
- Task 自身 status 回写见下节（同键）。BUG-013 冲突行归因键一致。

代码提交（合并队列前本地提交，未 push——push 由部署侧决定）：

- `connectops-gh`：`420fdce` watch 桥 → `0323b6e` subject 形态修复 → `4991845` gh-ops CLI
- `core-docs`：`8a9c3cb` + `3d42b58` scheme 镜像同步（R-DOC-5 双仓同步）

## 4. R-TYPE-3 验证

- **code**：`connectops-code-audit/audit` 两路实证——
  ① docsRoot 目标（cored-lint checker，R-PUB-1 + R-ENG-7）→ `ok=true, findings=0, unbound=0`；
  ② connector 仓目标 → 6 条 finding 均为**存量** `objects/*.yaml` 未落 storage 模板路径（声明源文件非 docsRoot 对象），
  本轮新增 5 文件零 finding，不冒充通过也不掩盖存量。
  另：`go test ./...` 全绿（gh 包）。
- **agent**：独立 verifier 收 rule 原文（R-ENG-8/R-PUB-1/R-ENG-7）+ diff，回报
  `VERDICT: PASS` / `FINDINGS: none`；证据含 `git status --short` 空、`.gitignore` 含 `tmp/`、
  新增文件 43–281 行（<800）、敏感词 grep 仅回环地址 `127.0.0.1`（设计内）、token 引用式取值。
- **human**：本任务即用户授权（high priority Task + 明确九节点/关闭 issue 验收）；本轮无越权/高危配置动作需新增弹窗审批。
  结论按 R-TYPE-3 三段齐备记 pass，未出现验证失败。

## 5. 已知边界（诚实口径）

- 事件注入面 `POST /v1/events` 的 source 由服务侧判定恒 `human`（event.md 规则 8）；watch 桥是 cored 外进程，
  故三条 GhIssueEvent 的 `source=human`。scheme 声明行 `source: connector` 描述的是设计归属，
  真实 connector 自产源（cored `--watch-source` 驱动契约）尚未注册驱动，属后续段。
- 三个 issue 的网关/插件侧代码修复不在本仓（外部 LLM 网关 + dsh 插件运行时）；本轮交付的是**通路与 triage 落稿**，
  issue #3 关闭口径=联通验收样本关闭，修复项由 BugDoc/发版说明继续跟踪，不冒充代码已修。
- 测试探针产物位于仓外 `/home/friddle/probe/gh-issue-trigger-impl/`（不入公开仓，R-ENG-8）；清场不删权威证据。

## 6. 证据文件

`probe/gh-issue-trigger-impl/`：watch-once.json、workflow-enabled.yaml、bugdoc-issue3.yaml、
audit-request*.json + code-audit*.json、release-create.json、issue3-comment-params.json、
issue3-comment.json、issue3-close.json。
