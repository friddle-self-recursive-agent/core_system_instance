# 概念可见性审计（2026-11-26 用户裁决批）

## 〇、指令与判据

用户指令（2026-11-26）：「分析下所有已经实现了概念。有没有在界面上合理的用人能理解直觉看到的方式展示或者点击详情页能看到。且在不同页面中只要相关就应该展示。然后展示后可以跳转相应详情页。另外 tag 之类的页面？」

口径=双侧实况对账：后端（scheme v0.13：19 kinds / 21 docTypes / 23 eventTypes / 25 dispatch + apiserver 全部 /v1 端点）× 前端（web/src 4113 行逐屏扫描，全部结论带 file:line 证据）。判定三条：

- **K1 直觉可见**：概念在首屏或相关屏以人话词形展示，不是只有工程词裸奔；
- **K2 详情可达**：展示处可点击进入对应详情页——纯文本死链冒充链接=不合格；
- **K3 相关即展示**：凡与当前屏对象相关的概念，当前屏也应有入口，且**双向**（不只列表→详情单向）。

## 一、总体结论

做得好的：①诚实空态纪律一致（几乎每屏显式空态/降级词形，零假装）；②单向深链（列表→详情）覆盖良好；③工程词人话化机制已建立（FIELD_GLOSS / PHASE_VIEW / 空态词形）。

三类缺口：
- **A 后端已实现、前端零落面**（6 概念）：code-audit findings、doc-history 真账、bug 生命周期、Template 真对象、通知送达投影、tag 聚合页；
- **B 展示了但不可点/词形残缺**（10 处死链/伪链接/死代码，file:line 见 §四 V-A）；
- **C A 屏 B 屏相关不互链**（8 处单向断头，file:line 见 §四 V-B）。

**tag 类页面回答**：现状**无**聚合 tag 页（全路由无 `#/tags`）。仅两处入口：docs 屏 tag 过滤输入框（misc.js:133，数据=客户端 frontmatter 解析，仅覆盖预取 24 篇、有诚实注脚）+ 对象工作台标签片（objects.js:91-99）。且 tag 点击丢过滤=伪链接（objects.js:216-218 承诺「看同 tag 对象」实际 `go('docs')` 丢参）；tagType 分组函数 tagGroups 支持词表但唯一调用点不传 vocab → 恒显「未分组」。V-16 补齐（设计草案 §五）。

## 二、kind × 界面矩阵（19 kinds）

| kind | 界面落点 | K1 | K2 | K3 | 缺口→销项 |
|---|---|---|---|---|---|
| ServiceDesc | 树叶→designdoc goal、service/:name 大屏 | ✅ | ✅ | ⚠️ | designdoc 无导航入口→V-22 |
| ServiceInstance | obj 工作台（content 片原文） | ⚠️ | ✅ | — | drift 语义人话弱（观察项，不立销项） |
| Agent | welcome Agent 行→chat/:agent | ✅ | ✅ | ⚠️ | 会话活性 chip 死链→V-05 |
| WorkService | connectors 屏+文档库 | ✅ | ✅ | — | — |
| ConnectorOps | connectors 屏 | ✅ | ✅ | ⚠️ | workflows 屏 connector 列死链→V-12 |
| Workflow | 列表三区+wf/:name+run 详情 | ✅ | ✅ | ⚠️ | dependsOn 死链→V-03；时间线事件死链→V-02 |
| Task | tasks 五组+task/:id | ✅ | ✅ | ⚠️ | 依赖死链→V-03；pending 无词形→V-09；session 反向无回链→V-10 |
| Proposal | proposals 屏 | ⚠️ | ❌ | ⚠️ | 无提案详情路由；「去审批」泛链不带标识→V-14 |
| Provider | connectors 屏 | ✅ | ✅ | — | — |
| Ref | connectors 屏 | ✅ | ✅ | — | — |
| Notification | **无落面** | ❌ | ❌ | ❌ | deliveries 投影+对象无 UI→V-21 |
| User/Group/Role | obj 工作台通用详情 | ⚠️ | ✅ | — | 无专属清单面（观察项：权限概念人话弱） |
| Template | 仅 3 张静态假卡+disabled 按钮 | ❌ | ❌ | ❌ | 真对象无列表面+假数据→V-20 |
| Skill | 仅 obj/tree 通用 | ⚠️ | ✅ | — | 无清单面（观察项） |
| TaskScheme | 仅 obj/tree 通用 | ⚠️ | ✅ | — | 同上 |
| Scheme/DocType | obj 工作台 scheme 片 | ✅ | ✅ | — | — |
| （BugDoc docType 载体） | 文档库被 DOC_KINDS 排除 | ❌ | ❌ | ❌ | bug 闭环不可见→V-19 |

## 三、非 kind 已实现能力 × 界面矩阵

| 能力 | 后端实况 | 界面实况 | 缺口→销项 |
|---|---|---|---|
| 自循环 | /v1/loop/current | welcome 循环卡（session=null 诚实） | wake 事件 chip 无 loop 关联→并入 V-10 |
| 会话活性+watchdog | /v1/sessions+heartbeat | welcome Agent 行 chip + session 屏 | chip 死链→V-05 |
| 会话上下文契约 | /v1/sessions/{id}/context | sessionctx.js 全片 | chunks/topDocs 纯文本→V-06 |
| 上下文索引/检索/trace | /v1/context/index\|find\|relevance、/v1/trace | obj 上下文片+会话 tagSig | chunks 死链（同 V-06） |
| doc_history 真账 | /v1/doc-history + /v1/rev-content | 编辑器历史 tab=事件名子串过滤（假账） | 换真账→V-17 |
| code-audit | /v1/connectops/code-audit/{audit,findings} | **全前端零命中** | V-18 |
| 审批闸 | /v1/approvals+fieldManager 判定 | approvals 三区+welcome 就地批闸 | 锚死链→V-04；批闸后无指引→V-15 |
| bug 闭环 | bug-lifecycle builtin+BugDoc+BugReport | 模板静态卡，BugDoc 不在文档库 | V-19 |
| 模板派单 | Template 五层+InstallRequested/TemplateFound | 静态卡 disabled | V-20 |
| 任务调度 | TaskScheduler+依赖/租约 | tasks 五组 | 依赖死链→V-03 |
| 对象删除三账 | DELETE /v1/objects+DocDeleted | （删除入口在 obj 操作片） | — |
| 实时推送 | /v1/stream RFC6902 | 全局实时灯 | — |
| 对话式录入 | /v1/intake/* | **前端零落面**（chat 面外无 intake 屏） | 观察项：录入经 rootAgent 对话已合规（Proposal 入口裁决），不另立屏 |
| tag 族 | metadata.tags/importance/tagRelevance 全局标度 | 两处过滤+伪链接 | V-16 |

## 四、销项清单（V-01..V-22，四批；每项判据=点击到达目标屏截图+npm test 增锚+800 行红线+R-PUB-1）

### V-A 批：死链激活（纯前端机械，先行）

| # | 动作 | 位置证据 |
|---|---|---|
| V-01 | tag 点击词形 `docs/tag/:tag`（router 增段+docs 屏第三段预填过滤框）；docs 行内 tag chips 同词形可点 | objects.js:216-218、misc.js:141,155-156、router.js:9-16 |
| V-02 | 事件行接 `event/:id` 深链（历史 tab 行/运行时间线行/相位抽屉事件行） | editor.js:237-239、workflows.js:398-401、workflows.js:55-57 |
| V-03 | 依赖 chip 可点：task 依赖→`task/:id`；wf dependsOn→`wf/:name` | tasks.js:125,199、workflows.js:254 |
| V-04 | 审批锚 chip→`wf/:name`；welcome 待批行加「运行详情」→`wf/:name/r/:n` | approvals.js:44-48（锚已解析于 :32-35）、welcome.js:148-158 |
| V-05 | Agent 行会话活性 chip→`session/:id`（数据已在手） | welcome.js:303-305 |
| V-06 | 会话上下文 chunks（kind/scope/name+score）→obj 深链；shards topDocs→docRoute | sessionctx.js:160-165,179 |
| V-07 | syncBadge「Running」可点→触发它的 run（返回 run 锚或 docs 行单独渲染 run 链） | chips.js:148-157、misc.js:143 |
| V-08 | REF_KINDS 正则补 Runbook/DriftReport/DocReview；refs.js renderMessage/`data-doc-full` 死代码接回 chat.js 或删除（不留死代码） | refs.js:9,25-63 |
| V-09 | PHASE_VIEW 补 `pending` 人话词形 | tasks.js:14-23,76 |

### V-B 批：双向回链与相关面补齐

| # | 动作 | 位置证据 |
|---|---|---|
| V-10 | session 屏回链 task/event（按 session id 反查快照）；事件详情「循环唤醒 #N」chip→welcome 循环卡 | chat.js（全文无 task 引用）、events.js:44 |
| V-11 | s/:name 屏补 tasks/drafts/runs 三区块（快照三源都已在手） | misc.js:292-315 |
| V-12 | workflows 注册表 connector 列↔connectors 屏互链 | workflows.js:197-203 |
| V-13 | docs 行 draft-dot→approvals 对应 diff 卡深链 | misc.js:145 |
| V-14 | proposal 详情：新增 `prop/:name` 路由或卡内全展开；approvals 屏支持按提案定位；「去审批」带提案标识 | misc.js:274-288 |
| V-15 | welcome 就地批闸后指引（→approvals 已决台账） | welcome.js:196-230 |

### V-C 批：已实现概念落面（真实数据源，禁止假卡）

| # | 动作 | 证据/口径 |
|---|---|---|
| V-16 | **tag 聚合页**（设计见 §五）：`#/tags` 路由 + `docs/tag/:tag` 词形 + tagGroups 喂真词表 + sessionctx tagSig 联动 | 现状无聚合页，objects.js:205 不传 vocab |
| V-17 | 编辑器历史 tab 换真账：api.js 接 `GET /v1/doc-history` + `GET /v1/rev-content`（rev/at/fieldManager/bytes+点看正文快照）；事件子串过滤退役为辅助注脚 | editor.js:232-241 现为假账 |
| V-18 | code-audit findings 落面：接 `/v1/connectops/code-audit/findings`（POST 调试路由+权限门 fail-closed；若前端直调 403，则后端在快照加只读 findings 投影——两条路径按实测定，不冒充）；导航挂基础设施组 | 全前端 grep 零命中 |
| V-19 | bug 闭环可见：DOC_KINDS 补 BugDoc（misc.js:88）；bug-lifecycle 模板卡改接真实 Workflow 对象与运行 | misc.js:88,107-108、workflows.js:89-93 |
| V-20 | Template 真对象落面：三张静态假卡+disabled「实例化」按钮（**假数据，原则 4 违规存量**）换 snapshot 中 Template kind 真实对象列表 | workflows.js:89-93,105 |
| V-21 | 通知送达落面：Notification 对象+`GET /v1/notifications/deliveries` 投影接入 connectors 屏新片（accepted→sent/failed+attempts） | 前端零落面 |

### V-D 批：导航与词表收尾

| # | 动作 | 位置证据 |
|---|---|---|
| V-22 | NAV_TREE 补 designdoc 入口；biz 占位屏词形复查（须显式「业务层未部署（设计稿在册）」）；i18n 幽灵词条「补标/Add tag」随 V-16 落 UI 或删 | main.js:43-68、misc.js:334、core/i18n.js:82 |

## 五、tag 页设计草案（回答「tag 之类的页面？」）

- **路由**：`#/tags`（NAV_TREE 文档库旁挂「标签」）；`docs/tag/:tag` 子词形直达 docs 屏预填过滤。
- **聚合页形态**：按 tagType 分组两段式（词表在册=分组名；缺席=「未分组」恒殿后，不冒充分类）→ 每组 tag chips + 计数；点 tag → `docs/tag/:tag` 看命中文档清单。
- **数据源（真实，三层聚合）**：① /v1/context/index 的 tags 字段（索引投影，权威面）；② 对象 tagsOfDoc（spec.metadata.tags 优先）；③ docs 屏 docCache frontmatter 解析（仅预取窗口，沿用诚实注脚口径）。三源去重计数；无任何假词表。
- **联动**：对象工作台 tag 点击→`docs/tag/:tag`（修 V-01 伪链接）；sessionctx tagSig chips 同词形；tagGroups 喂真词表后 tagType 分组生效。
- **判据**：#tags 页截图含真实计数；从对象工作台一次点击到达示过滤 docs 屏；npm test 增 tags 路由锚。

## 六、假数据存量补充（原则 4 本轮新增发现）

1. workflows.js:89-93 三张静态「模板卡」+:105 disabled「实例化」按钮=假数据（V-20 销）；
2. editor.js:232-241 历史 tab 用事件名子串过滤冒充版本史（V-17 销）；
3. core/i18n.js:82「补标/Add tag」词条无对应 UI=幽灵词条（V-22 销）；
4. 其余假数据清单沿用 console-audit-2026-11-26.md（probe 任务/演示阈值/陈旧收件箱，Batch 1 在销）。

## 七、批序与监督

执行序 V-A（机械先行）→ V-D → V-B → V-C（V-18 涉后端判定最后）。每批完成判据=全部销项截图+测试锚+lint 三绿（含 800 行红线），loop 逐轮销、巡检 automation 按批名核查进度。不动 acceptance/audit/probes/ 探针资产；web/ 动工前先查在制并行分支。
