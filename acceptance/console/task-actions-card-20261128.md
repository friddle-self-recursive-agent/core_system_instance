# 验收报告 — 任务详情「最近动作」结构化卡（2026-11-28）

> 2026-11-28 用户报障「self-recursive-core%2Falign-docs-reality-20261127 展示的最近动作没有结构化。暂时为空」。浏览器经门活体验收（CT116 core_agent，双服务重启后新 bundle，dist sha256 双端一致 console.js=e9b0bb8e… / console.css=7e0be7ae…）。

## 结论：结构化卡三源全过，零阻塞遗留

| # | 病 | 修后 | 活体证据 |
|---|---|---|---|
| 1 | 最近动作=单 kv 行 200 硬截断（本任务 lastAction≈900 字全文被腰斩成一段墙） | **结果注记块**：lastAction 全文 `pre-wrap` 折行渲染（上限 4000 防病态长文，title 携全文）+ lastError 红 chip 独立位 | 截图：900 字对账结论完整折行可读 |
| 2 | 无结构化动作清单（结构化列表恒空——不存在） | **生命周期时间线**：`GET /v1/events?involved=Task/<scope>/<name>` 归档直查异步注水（非快照 50 行窗——历史任务同样可查）；行=级别点+类型+相位词 chip（TaskStateChanged dedupKey 词尾 `task:<id>:<phase>`）+ dedup 副行 + relAge 时刻 | 截图：DocApplied×1 + TaskStateChanged 6 行（正在做/待启动 相位词活体，17h/18h 前） |
| 3 | 关联会话动作无现势面 | **关联会话现势行**：快照心跳行（state/phase/lastAction/lastBeat）会话已终结不在册=诚实词形「不在心跳在册」+ 对话深链恒在 | 截图：不在心跳在册 chip + self-recursive-core/align-… 会话 id |

任务列表行同步修：`lastAction` 100 截断（原先无截断——900 字全文糊满列表行）。

## 实现账

- workservice@be3cca4：`fix(console)` 任务详情·最近动作结构化卡——tasks.js taskDetailScreen 重构（结果注记+会话现势+时间线注水器 hydrateTaskTimeline/taskEvRow/taskPhaseOf）+ api.events 增 params 六参透传 + i18n 补词 + 列表行截断；npm 119 pass（新增 taskPhaseOf 机械测试）
- plugin@557e6f7：submodule pin bump
- 部署：CT116 plugin pull→submodule checkout be3cca4→dist sha 双端一致→dsh-core-system→dsh-kube-inner 顺序重启（active，cored addr 轮换 :43547；零在途会话窗口内操作）

## 诚实注记

1. **done 相位事件缺档（既有语义非本轮病）**：本任务 done 由会话直接 apply 回写 Task.status（fieldManager=task:…，DocApplied 佐证），不经调度器 writeStatus→publishState——时间线无「已完成」相位 chip，以 DocApplied 行如实收尾。调度器 session-receipt 路（会话终结判 done）才有 TaskStateChanged:done。如需全路相位事件，属调度器发布面扩展（另单）。
2. 快照 events 仍是 50 行窗（welcome/事件流页口径不变）；任务详情时间线走归档直查不受此限。
3. 截图：`img/task-actions-card-20261128.png`。
