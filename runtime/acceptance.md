# Runtime — 验收与验证流程（acceptance）

> 概念依据：Goal.acceptance 必须可验证（doctypes/README.md）、Verify 相位（concepts/workflow.md）、执行留痕（ops-log.md）。本文回答三个问题：**一次 workflow loop 怎么验收、验收报告放哪、系统自身的收敛怎么判定**。规则来源：core_design rule.md R-PUB-3（运行时验收产物不入公开仓）。

## 1. 验收在闭环里的位置

```
dev-delivery loop：… → Execute（build/test/lint）→ Verify → Report
                                                          └─ 验收 = Verify 相位的固化输出
```

- 机械验收：build/test/lint 退出码 + R-PUB-1 lint（core_design `lint/personal-info.sh` 扫全部公开仓）——全部可判定，失败即 loop 失败；
- 语义验收：Goal.acceptance 探针逐条复测（agent 执行，结果入报告）；判不准的条目如实标 `unverified`，不伪造通过；
- 回归验收：本 loop 之前所有已通过探针重跑（收敛要求：不回退）。

## 2. loop 版本记录

每次 workflow loop 执行结束（Report 相位）产出一条**带版本**的执行记录：

| 项 | 约定 |
|---|---|
| 版本号 | `loop-<seq>`，seq 全局单调递增（持久于 ops DB，Report 相位分配） |
| 内容 | 触发源、相位轨迹、文档 commit（core_design/core_system_instance）、代码 commit（workservice/plugin）、构建产物 digest、探针结果表、偏差清单、下一轮建议 |
| 去向 | `acceptance/loop-<seq>.md`（**运行时临时文档，gitignore，永不提交**，R-PUB-3）+ ops DB 相位流水 |
| 语义 | 版本记录是对账锚点：按版本可复查"这轮改了什么、验了什么、过没过" |

## 3. 收敛判定（系统自身验收）

dev-delivery 自举循环的终止不是"跑完一轮"，是**收敛**：

1. 文档→实现对账：core_design 声明的概念/规则，在 workservice/plugin 代码里均有落点（对账表全绿或明确标 declared-deferred）；
2. 连续 N 轮（默认 3）loop 无新偏差、全探针绿 → 判定收敛，loop 转 watch-only；
3. 收敛报告（终版 loop 记录）是人批 Resume/验收的唯一交接物。

## 4. 验收报告模板（acceptance/loop-<seq>.md）

```
# loop-<seq> <date>
trigger: <事件/点火/人工>
docs: core_design@<sha> core_system_instance@<sha>
code: workservice@<sha> plugin@<sha>
build: <结果>  test: <n passed / n total>  lint: <R-PUB-1 结果>
probes:
  - <Goal.acceptance 条目>: pass|fail|unverified（证据一行）
deviations:                       # 与设计文档不一致处
  - <现象> → <处置：修代码 | 改文档（已提交 <sha>）| 挂起>
next: <下一轮建议>
```

## 5. 设计偏离回写（运行时改文档）

运行时发现设计不合理 → **改设计文档并提交**（core_design / core_system_instance），方向约束：**解耦、通用性、扩展性**。改动走同一条 git 历史（终态制，无版本号标注）。报告 deviations 区记录"现象→处置"，改文档的处置必须给出 commit。

## 6. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 报告造假（unverified 标 pass） | ⚠️ 中 | 机械项退出码不可伪造；语义项 R-PUB-1 lint + 人抽查终版报告 |
| 版本号断档/重放 | ✅ 低 | seq 持久于 ops DB，重启不重置 |
| acceptance/ 目录膨胀 | ✅ 低 | 运行时临时文档；保留策略由 metrics 摘要 workflow 收（默认 7 天，终版除外） |
## 7. 探针无副作用（硬性要求，KI-001）

验收探针**不得携带外部副作用**：不得真实外发邮件/消息、不得写外部系统、不得修改集群。理由：探针会重跑且逐轮复制继承，带副作用的验收会线性放大噪声（KI-001 邮件风暴）并使验收不可重放。

- 外部通道一律本地桩：SMTP → 本机 sink 进程（断言收到报文而非真实投递）；HTTP 外部依赖 → 本机 stub；真实链路 E2E 仅在显式开关下执行（`CORE_MAIL_E2E=1` 等），且不计入回归基线。
- 默认 `go test`/探针运行的**外发连接数必须为 0**（可机读断言：strace/ss 采样或桩计数）。
- 探针模板逐轮继承，因此该要求对**新轮继承的基线同样生效**：发现继承基线含真实外发时，修复基线而不是照跑。

## 8. 验收报告标准（workflow override 默认，含页面截图）

里程碑型验收报告统一格式（例：`[core-system] console v2 全收口 E0–E7（loop-43）`）：

- **标题**：`[<scope>] <里程碑一句话>（loop-<seq>）`——人一眼知道"哪个系统、成了什么、哪轮"；
- **结论段**：结论 + 关键证据指针（探针脚本/日志/查询面路径）；不写"应该/大概"，只写机械证据；
- **页面截图**（UI/交互/渲染类验收**必须**）：简单几张即可（主屏 + 关键流 1-2 张），由内置 Skill `acceptance-screenshot`（Provider=`browser-headless`，工具=`chromium-headless`）在验收节点经 agent 调用产出；截图存 `acceptance/shots/loop-<seq>-*.png`（gitignore，R-PUB-3 永不入公开仓）；截图失败=该项标 unverified，不得用文字替代；
- **偏差与余量**：deviations 区逐条"现象→处置"；declared-deferred 余量清单显式列出；
- **产物与提交**：代码/文档提交号、验收产物路径。

workflow override 的默认验收报告标准=本节：dev-delivery override 尾节点（notify-report）产出的报告必须满足以上格式与截图要求。

## 9. 人工接管判定（handoff gate，2026-11-24 用户裁决）

目的：该用户决策/改需求/定稿文档时，**系统不代做**——在对应循环收尾处显式判定并移交，用户在 core-agent 控制台上执行需求与更新文档。

- **判定条件**（任一命中即挂起该分支并移交）：①需要需求决策（新需求/需求变更/范围取舍）；②需要文档定稿或人工改写；③需要权限提升（超出 auto 级）；④需要外部凭据/账号；⑤需要跨系统人工动作。
- **产物**：`NeedsHuman` 事件（level=error，走通知；未配置通道=仅页面展示，通知口径见 notification.md 规则 6）+ console「待你处理」收件箱条目 + 本轮验收报告必含「待人接管项」清单（无则显式写 none）。
- **移交方式**：通知按 bind 用户通道（默认 email 若已配置），正文含**固定入口链接**与接管清单；loop 暂停该分支，不代替用户执行。
- **回链**：用户在 console 完成操作后产事件回链（Proposal approved / DocApplied / ApprovalGranted）→ loop 自动续跑对应分支。
- **判据**：命中条件的轮次必须有 NeedsHuman 在账且报告含接管清单；用户操作后事件回链可查；无接管项轮次显式 none。
