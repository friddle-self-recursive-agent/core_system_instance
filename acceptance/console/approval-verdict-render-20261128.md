# 验收报告 — 审批卡 Diff 判决文档渲染（2026-11-28「审批为空」纠偏批）

> 用户 2026-11-28「还是审批为空。上次说了。来一个小LLM做diff了？」+「do it」。浏览器经门活体验收（CT116 core_agent，新 cored 二进制+新 dist，dist sha 双端一致）。

## 结论：三层病根全修，run 审批卡判决正文活体可见

截图：`img/approval-verdict-final-20261128.png`（8 张 run 卡判决正文同屏）+ `img/approval-verdict-card-20261128.png`（首轮验证）。

| 层 | 病（活体取证） | 修 |
|---|---|---|
| ① 幂等域 | `/tmp/approvaldiff.log` 显示 run82–86 全 `idempotent-skip docdiff-workflow-gh-issue-trigger`——判决名一对象一份，后续挂起永远读首份陈旧判决 | 后端 `diffDocNameForRun`=docdiff-<kind>-<name>-run<N>，幂等域=run（workservice@696cc46）；单测 `TestDiffDocNameForRun`+Distinct 回归闸（@8f1fd93，CT116 go test ok） |
| ② 容器 | run 审批卡（批准继续/驳回终止）此前**无判决容器**——判决片只挂在稿批准卡（data-apdiff→hydrateDiff→hydrateVerdict）路径 | itemHtml run 分支补 `<div data-apverdict>`；items.filter(kind=run) 注水调用（@f9b06d7） |
| ③ 锚错位 | console 404 取证：前端用卡头 `r.workflow=core-workflow`（编排器）构造判决名，后端 Generator 权威键 `run.Involved=Workflow/global/gh-issue-trigger`（实际挂起对象）——必然 404 | `verdictAnchorOf(r)` 从 involved 三段解析实际挂起对象；`apVerdictKeyOf(r)` per-run 唯一容器键（同对象多 run 不撞首卡）；hydrateVerdict 支持 apVerdictKey 精确注水（@9354992）；130 pass |

## 活体证据

- `#/approvals` 8 张 AwaitingApproval run 卡：7 张显示 `Diff 判决 · ops_core_inner_agent` 完整正文（真实 LLM diff：新增验收探针注释 / resourceVersion:3 删除 / 关键配置保留 / 截断诚实注记），1 张（run#87 待批稿缺席）显示「（待批稿缺席——本对象可能走对象直写面，判决文档仅留锚）」诚实词形。
- run#78（旧档 involved=core-workflow，无对应 DocumentDiff）走诚实缺席词形「判决文档尚未生成……缺席=未到生成窗口，不编造」——不冒充。
- console errors 仅剩历史 404（旧档 + 稿 draft 缺席），无新错。

## 提交/部署账

- workservice@696cc46 后端 per-run 命名 → @f9b06d7 run 卡判决容器+per-run 名 → @9354992 锚错位纠偏（130 pass）→ @8f1fd93 per-run 单测；plugin@37ae813→@86ba7f8 pin bump（loop 并发批 rebase 到其上：91e7e5c modal / f020e8f scheme 纯文本 / 1000a27 R-UX-10 / b433184 dist / 3745b44 relatedTasksOf，双方改动 dist 齐含，零丢失）。
- CT116：新 cored 二进制 go1.27 构建（含 per-run 命名）原子换装→双服务顺序重启（addr 轮换 :45121→:33747）→dist 双端一致（5b702a7a→75f4a50c loop 重建版，含 verdictAnchorOf）。

## 诚实注记

1. 历史挂起 run（80–86）由旧 cored 生成、无 per-run 判决文档；前端靠旧名回退 `docdiff-workflow-gh-issue-trigger` 命中在册判决显示——新 per-run 判决需**下次自然挂起 run** 才生成（幂等域=run 单测+代码路径已验证，不动运行面伪造挂起）。
2. 单对象多 run 挂起时 per-run 容器键唯一，互不覆盖。
3. 并发会话纪律：独立 workservice 克隆里 loop 在制 modal.js/workflows.js 改动原样未碰（我的提交只含指定文件）。
