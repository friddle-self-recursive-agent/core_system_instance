# Core Console 全页扫描与整改方案（2026-11-26）

> 依据：2026-11-26 真实运行面全量浏览器扫描（34 张实屏截图 + 16 个活体 API 端点 + 21 个在册对象全量核对 + `core_design/core/scheme.yaml` 逐行比对）。
> 原则：以人为本（第一眼直觉可读、复杂信息进 expand/详情）、主线明确、布局正常、零假数据（scheme 与文档全部真实）、真实 scheme/文档不合理处直接修订落库。

---

## 一、致命功能故障与入口断裂（P0，立即阻断可用性）

| # | 位置 | 现场现象 | 根因定位 | 修复方案 |
|---|---|---|---|---|
| F-01 | 入口 `/core-console/` 与 `/core-console` | 直接访问返回 **HTTP 404**，仅 `/core-console/v2` 可开 | `plugin/src/routes/console-v2.ts:124-127` 只注册了 `/core-console/v2` 与 `/core-console/v2/` | 将 `/core-console` 与 `/core-console/` 转正为主壳（或 302 到 `/core-console/v2`，建议直接以 `/core-console/` 为正式路径，`/core-console/v2` 兼容重定向） |
| F-02 | `#/workflows` 与 `#/tree` | 整屏崩溃，`在册工作流` / `运行记录` 永卡加载中；导航与面包屑残留在上一页 | `web/src/screens/workflows.js:9` 漏导 `involvedRoute`，第 121/248 行抛出 `ReferenceError: involvedRoute is not defined` | 补齐 `involvedRoute` 导入；所有屏 render 包一层错误边界（出错显式提示，不静默卡 loading） |
| F-03 | `#/wf/:name` | 运行记录编号倒挂：`run #1`（2h 前 suspended）显示成 `run #2`，`run #2` 显示成 `run #1` | `workflows.js:253` 读 `r.no`（后端键是 `r.run`），退化为 `runs.length - i` 倒排 | 统一取 `r.run ?? r.no` |
| F-04 | `#/wf/:name/r/:n` | ① 失败的 `core-workflow #2` 把 `Verifying` / `Reporting` 全标绿勾；② 静态状态机边表 `transitions` 当事件时间线展示；③ `Failed` 终态仍写「正在发生」；④ 推进过 `Reporting` 居然落入 `Failed` | 后端 `workflow/run.go` 把异常态 `Failed` 放进线性 `phases` 末尾并生成 `Reporting --advance--> Failed`；前端按数组下标 `< curIdx` 盲标绿勾且无 `run.history` 轨迹 | **设计+代码同修**：① `scheme.yaml` 与 `workflow.md` 已将 `Failed/Paused` 移出正向 `phases`、补 `converged`/`canceled` 状态、拆分静态 `transitions` 与运行轨迹 `run.history`；② 引擎停在正向末步落 `converged`；③ 节点图按 `history` 标色、终态改文案、点节点弹出对应 agent/session/日志 |
| F-05 | `#/tasks` 与总览 KPI | 活体任务 `phase: "running"` 被判成「状态未知」丢进「排队」，并弹出过时 BUG-013 警告；总览「进行中任务」误显示 `0`；点任务进详情报「任务不在册」 | `tasks.js:24` 读 `t.status.phase`、`welcome.js:327` 读 `x.status.phase`，但 `/v1/snapshot` 与 `/v1/tasks` 返回扁平 `t.phase`；且路由 ID 编码不匹配 | `statusOf(t)` 兼容扁平顶层字段（`t.phase`/`t.lastAction`）与 `t.status`；统一任务详情深链 `scope/name` 解析 |
| F-06 | `#/docs`（文档库） | 21 个在册真实对象里只露出 3 个（`core-headless`/`notify`/`workflow-engine`），其余 18 个全部失踪 | `misc.js:66` 硬编码 `DOC_KINDS` 把 `ServiceDesc`/`Workflow`/`Proposal`/`ConnectorOps`/`Task`/`Provider` 等全过滤掉 | 移除硬编码过滤，默认按用户视角分组展示全部真实文档与对象（含设计文档仓入口） |
| F-07 | `#/designdoc` | 107 份真实设计文档全显「文档为空」，直接访问详情永卡「正文现读中」 | `misc.js:185` 读 `r.data.files`，但 `/v1/design-docs` 实际返回 **`r.data.docs`** | 改为读 `r.data.docs || r.data.files || []`，空树时仍允许直链 `hydrateDesignDoc` |
| F-08 | `#/obj`（对象工作台） | ① 「适用规则」永卡「规则命中判定中…」；② `Proposal`/`Task` 等 Markdown+frontmatter 正文显 `(空正文)`；③ `scheme` 片全显「暂不可达」；④ 「标签」全显「未声明 `spec.metadata.tags`」；⑤ 无对象选择器，点进默认盲开首个对象 | ① `objects.js:223` 无 `Rule` kind 返回 `null` 后直接 `return` 漏写 DOM；② `yamlToCards` 对 `---\n...\n---\n# md` 失败返回空；③ `store.js:113` 读 `state.kinds` 而非 `/v1/scheme/kinds`；④ 元数据路径错写为 `spec.metadata.tags` | ① 无规则时落诚实终态（并接入 `design-docs` 中的 `rule/` 文档）；② 识别 `---` frontmatter + Markdown 正文双形态渲染；③ 从 `/v1/scheme/kinds` 注入真实 `Kind` 定义渲染 scheme 字段卡；④ 优先读顶层 `metadata.tags` 与 `.metadatainfo`；⑤ 顶栏补对象快速切换器 |
| F-09 | `#/approvals` 与 `#/inbox` | ① `#/inbox` 与 `#/approvals` 渲染完全同一页；② 审批页漏掉挂起中的 `core-workflow #1`（总览有、审批页反而没有）；③ `Proposal` 的 `ApprovalNeeded` 按钮永远置灰无法点击；④ 底部收件箱 64 条行全是无字空白行 | ① `approvals.js:16` 未纳入 `suspended` runs；② `wfAnchorOf` 只认 `Workflow/...` 拒认 `Proposal/...`；③ `inboxHtml` 读 `x.title/summary/note`，但 `/v1/inbox` 返回 `x.digest/at/link` | ① 审批页合并挂起 Workflow run + 待审 Proposal + 待审草稿三源，均为可操作一等卡片；② 支持 `Proposal/<scope>/<name>` 批准/驳回闭环；③ `/v1/inbox` 改为活体收敛待办（P3）并正确读取 `digest/at/link`，取消重复的 `#/inbox` 路由或合并为审批中心子 tab |
| F-10 | `#/service/:name` | Service 大屏原样照搬全局 21 对象 / 50 事件 / 64 收件箱，零 scope 过滤，且底部 `ServiceDesc 正文` 永卡注水 | `welcome.js:361` 未向 `dashLayout` 传 `scope` 过滤且读取不存在的 `sd.content` | 按 `scope === name` 过滤对象/工作流/任务/审批/事件，正文走 `docCache` + `api.object` 现读 |

---

## 二、以人为本与主线重构（满足要求 1 & 2）

### 2.1 一级主线收束（按用户心智，而非工程内部模块）

现行侧栏并列 13 个入口且把最核心的「会话」藏在「基础设施」下、保留已裁决废止的「需求提案」、重复存在 `系统树`/`文档库`/`对象工作台` 三个同源对象视图、另挂空壳「业务控制台」。重构为 **4 个日常主线 + 1 个折叠展开的“系统底层”抽屉**：

1. **首页（总览 + rootAgent 对话）** `#/`
   - **第一屏核心焦点**：顶部一个清爽的自然语言对话框（「告诉系统你想做什么，例如：检查文档与代码差距并修复」），**默认自动选中活跃 rootAgent 会话**，隐藏 `session id` 输入框和 `queue 语义` 工程黑话（切换会话收入右上角小下拉，默认折叠）。
   - **紧随其下三块人话状态卡**（仅展示当前需要人关心/正在动的事）：
     - **需要你决定**（当前活体待批 run + 待审提案 + 待审草稿，带标题/影响摘要/一键批准或查看 diff）
     - **正在进行**（当前 running 任务 + 活跃 workflow run，人话标题 + 进度节点 + 负责人）
     - **最近动态**（最新 5 条领域变更，可展开看全部）
   - 去掉令人困惑的 5 格技术数字墙（`21 在册对象`、`50 归档行`、`待审 稿∪待审事件`、`收件箱 64` 历史垃圾计数）和页脚 `GET /v1/snapshot + /v1/stream patch` 工程说明。
2. **工作与流程** `#/work`（合并「任务中心」与「Workflows」的日常视角，或两项紧邻）
   - 默认按人话分组（正在做 / 等你确认 / 遇到问题 / 最近完成）；点进任意一条即可看到**可视化多节点流程图**（仅画正向节点；失败/挂起以清晰侧轨徽章标明原因与重试/批准按钮），点击节点直接展开对应的 Agent、会话摘要与日志。
3. **审批中心** `#/approvals`
   - 只放**当前仍待裁决**的活体项（挂起工作流、待审提案、待审文档草稿），每条先用人话写清「改了什么 / 为什么需要你批 / 影响范围」，diff 与原始 YAML 收进可展开（expand）区；「历史已决记录」默认折叠或切到次级 tab。
4. **文档与资产** `#/docs`（合并「文档库」「设计文档」「对象工作台」「系统树」的日常入口）
   - 左侧树形目录（按「设计文档 / 服务与工作流 / 连接与凭证 / 系统配置」人话分类，不再按裸 kind 字母表罗列），右侧默认**渲染态正文 + 人话摘要**；原始 YAML、标签、适用规则、Scheme 定义、上下文信息收入右侧/底部可展开面板（expand）或详情页。
5. **系统底层（默认折叠，供研发/排障钻取）**：`会话记录`、`事件流`、`连接与凭证`、`系统树（按 Kind）`。空的「业务控制台」在无真实业务服务接入前不占主导航（或收入顶部视角切换器并标明“待接入业务服务”）。

### 2.2 全站工程黑话清零清单（对齐 R-UX-3）

- 浏览器标题 `Core Console v2（web 重构载体·并行验收面）` → `Core Console`；侧栏副标题 `web 重构起点` → 删除或显示当前工作空间名。
- 全面清除界面中的内部开发术语与规范口头禅：`稿∪待审事件`、`空态显式`、`诚实空态`、`显式占位不装假`、`不编造`、`注水中…`、`runs 面现读`、`ContextPack 契约面`、`PUT 落盘即切新分叉`、`乐观锁基准`、`queue 语义`、`已知活体 bug（BUG 台账）`、`数据面：GET /v1/snapshot...`、`数据可信度：未注明生成方式`。
- `关注报告` 中 `ApprovalNeeded` 徽章与标题重复两次、缺乏人话摘要 → 卡片主标题取关联对象人话标题（如 `代码审核：实际与文档差距对账并修复`），次行一句话说明原因与直达按钮。
- `文档库` 状态徽 `基线一致 · Running` 自相矛盾 → 统一单一语义：`同步中（工作流运行中）` / `已同步`。

---

## 三、布局与视觉缺陷修复（满足要求 3）

| # | 位置 | 缺陷 | 修复 |
|---|---|---|---|
| L-01 | 全局顶栏 + 侧栏底部 | `● 实时 (WS patch)` 在右上角和左下角**同时重复出现两次** | 仅保留一处简洁状态灯（侧栏底角），悬浮 tooltip 显示连接方式 |
| L-02 | 1100px 视口（总览） | `#view` 发生**横向溢出**；三列大屏在 1100px 下强行三等分，导致「最近需要的审批」里 `core-workflow` 断词换行、`2h\n前` 折行、徽章与两个按钮相互挤压 | `.dash-grid` 在 `< 1280px` 自动退化为 2 列（`< 860px` 1 列）；审批行采用「上标题+状态、下操作按钮」双行结构，绝不在窄列硬塞 5 个横向元素 |
| L-03 | `welcome.js:341-344` | 存在未闭合嵌套 `<div class="w-foot">` 与错配 `</span>` 闭合标签 | 删除该工程注脚并修正模板闭合 |
| L-04 | 侧栏 `基础设施` 分组 | `· 基础设施` 莫名右对齐且上方留出大块空白，与主菜单风格割裂 | 与主分组统一左对齐小号分组标题样式（紧凑间距） |
| L-05 | `#/tree`（系统树） | 对象名在最左侧、`rv 14` 推到 1000px 外的最右侧，视觉断链 | 限制行最大可读宽度或将 `r14` 徽章紧跟对象名右侧展示 |
| L-06 | `#/chat`（会话列表） | 黄色 `suspected-stall` 徽章紧贴截断的 sessionId 几乎相撞；下拉框与输入框并列重复显示同一长 ID | 会话卡片改两行排版（首行主标题+状态徽，次行时间与最近动作）；合并会话选择器为单个可搜索下拉 |
| L-07 | EN 英文模式 | 切换 EN 后侧栏分组、审批行按钮（`待批`/`批准继续`/`驳回终止`）、相对时间（`2h 前`）仍残留中文；侧栏红点在切语言后才出现 | 补齐动态节点与 `relAge()` 的 i18n 词条；修复首屏徽标更新时机 |

---

## 四、假数据 / 探针残骸清理与真实对象修复清单（满足要求 4）

### 4.1 前端硬编码假内容删除
1. `workflows.js:88-107`：删除硬编码假模板数组 `WF_TEMPLATES`（`bug 生命周期`/`dev-delivery`/`文档收敛` 置灰假卡），改为真实读取在册 `Template(appliesTo=workflow)` 对象。
2. `tasks.js:130, 197`：删除硬编码 `已知活体 bug（BUG 台账：空 status 不调度）` 提示，修复扁平 `phase` 读取。
3. `misc.js:312`：移除「业务控制台」空壳占位屏对日常主导航的干扰。

### 4.2 活体存储与运行时假/探针数据清理（CT116 cored）
1. **删除探针任务**：`Task/self-recursive-core/probe-smoke-1`（「调度器冒烟探针」）。
2. **删除 loop-61 探针工作流及派生骨架**：`Workflow/global/deploy-system-workflow`、`Workflow/self-recursive-core/deploy-system-workflow`（`core/origin: probe-loop-61`）及其自动物化的 `ConnectorOps/global/deploy-system-workflow`、`ConnectorOps/self-recursive-core/deploy-system-workflow`。
3. **清理 4 个死探针会话（造成最近 200 条事件中 153 条=76.5% 为 `SessionStalled` 噪音）**：`"session-f5a51ebe-28ca-4edb-8587-47c15674fe98"`（带多余双引号）、`l58-selfheal-probe`、`l58-hb-probe`、`l57-probe`。
4. **移除演示用必触发假告警阈值**：修改 `WorkService/global/notify` 中 `observation.metrics[0].thresholds: [{op: gte, limit: 1}]`（注释明写「R-2 桥点火演示口径：首拍必越限」），改为真实合理告警阈值或移除演示项。
5. **归档/收敛历史脏记录**：清理 `inbox` 63 条 11 月 23–25 日无 `involved` 的陈旧 `Escalate` / 历史已决 `ApprovalNeeded`，以及 `approvals` 账本中 `Proposal/global/l60-ui-prop2..10` 测试提案记录（生产运行库与测试隔离）。

### 4.3 真实 Scheme 与在册对象同步修复
1. **将活体 `Scheme/builtin/default` 升级同步至最新 `core_design/core/scheme.yaml`**（当前活体 401 行，落后仓内权威 Scheme 70+ 行）。
2. **补齐缺失的真实对象 `WorkService/global/agent-comm`**：`ConnectorOps/global/agent-comm` 引用 `workservice: agent-comm`，但该 `WorkService` 对象缺失导致悬挂引用。
3. **补齐首批 3 份真实 `Template(appliesTo=workflow)` 对象入库**（`global/templates/wf-bug-lifecycle.yaml`、`wf-dev-delivery.yaml`、`wf-doc-converge.yaml`），支撑真实模板列表与实例化。
4. **修复真实对象的命名与引用不一致**：
   - `Proposal/global/code-audit-20261126` 的 `ownerRefs` 指向不存在的 `ServiceDesc/core_system`（实际在册名为 `self-recursive-core`），需统一命名。
   - `ServiceDesc/self-recursive-core` 中的 `system://self-recursive-core/{goal,desc,rules}` 补齐可解析映射（指向 `core_design/{goal.md,desc.md,rule/}`），使文档内所有引用真正可点可达。

---

## 五、真实 Scheme 与设计文档已修订项（满足要求 5）

本次扫描同步修订了 `core_design` 中与运行现实矛盾或不合理的 Scheme 与概念文档：

1. **`core/scheme.yaml` & `concepts/workflow.md`**：移除 `Workflow.spec.phases` 末尾的异常态 `Failed`（消除 `Reporting --advance--> Failed` 致命状态机缺陷），确立 `Failed/Paused` 侧轨语义、补齐单次 run `converged`/`canceled` 终态、分离静态 `transitions` 与运行轨迹 `run.history`，并补注册 `bug-lifecycle` 内置工作流。
2. **`core/scheme.yaml` & `concepts/template.md` & `concepts/workflow.md §9b`**：`Template.spec.appliesTo` 从 4 层扩为 **5 层**（新增 `workflow`），使工作流模板可真实入库校验、取代前端假卡。
3. **`core/scheme.yaml`**：补齐 `workflow.md §9a` 已定稿但未注册的 `BugDoc`（docType）、`BugReport`（eventType & dispatch）；补齐 `runtime.ruleChecks` 遗漏的 `R-DOC-8` 与 `R-ENG-7`；更新 `kinds` 注释（18→19）与 `doc_history` 已落地状态。
4. **`core/scheme.yaml` & `concepts/proposal.md`**：收敛需求入口为统一 rootAgent 对话（`Proposal` 退居系统内部结构化变更/审计对象，不占主导航），并扩展 `ApprovalGranted`/`ApprovalRejected` 支持 `Proposal/<scope>/<name>` 锚（消除审批死路）。
5. **`core/scheme.yaml`**：统一检索元数据落位为顶层 **`metadata.*`**（废除违背 P2 的 `spec.metadata.*`）；显式声明 `Proposal`/`Task` 支持 `markdown-frontmatter` 载体格式。
6. **`core/scheme.yaml` & `concepts/attention.md` & `concepts/event.md`**：确立收件箱/待审/关注报告的 **Level-triggered 活体收敛口径**（已决/终态退出待办，不拿 append-only 历史日志计数当待办），以及 watchdog 会话终态退出规则（`escalated`/`SessionClosed` 停止周期重复发送 `SessionStalled`）。

---

## 六、可行性分析与分步落地建议

| 批次 | 范围 | 风险与缓解 | 机械验收判据 |
|---|---|---|---|
| **Batch 1（P0 止血 + 去假数据）** | 修复 F-01~F-10、清理活体探针对象/会话/演示阈值、同步活体 `Scheme/builtin/default`、补 `WorkService/agent-comm` 与 3 份真实 workflow `Template` | ⚠️ 低：均为确定性 bug 修复与数据清理；删探针对象前先导出 sqlite 备份 | `/core-console/` 200；全站 0 JS error / 0 404；`#/workflows` 展示 7 注册表+真运行+真模板；`#/docs` 展示全部在册对象；`#/designdoc` 展示 107 文档；`#/tasks` 与 `#/approvals` 零死路；200 条事件中探针噪音为 0 |
| **Batch 2（引擎状态机与活体收敛）** | `workflow/run.go` 停在正向末步落 `converged` + 记录 `run.history`；`/v1/inbox` 活体收敛；watchdog 终态退出；`ApprovalGranted/Rejected` 接 `Proposal` | ⚠️ 中：涉及 `run_test.go` 旧断言更新（原断言锁死了 `Reporting→Failed`）；按 R-ENG-6 开 `agent/` 分支合入并全量单测 | 批准挂起 run 后走到 `Reporting` 落 `converged`（不落 `Failed`）；`Proposal` 可在审批页一键批准；已升级会话不再每 10m 产生 `SessionStalled` |
| **Batch 3（以人为本 IA + 布局精修）** | 侧栏收束为 4 主线 + 折叠底层；总览改为对话+三块人话态卡；清零工程黑话；修 1100px 响应式与双连接灯与 EN 词典 | ⚠️ 低：纯前端重构，遵守 R-ENG-7 单文件 ≤800 行 | 1440px 与 1100px 零横向溢出；全页面文本断言零工程黑话词形；中英文切换零中文残留；单连接灯；npm test 全绿 |
