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
