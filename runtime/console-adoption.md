# 运行时设计 3.6：console v2 落地盘点与逐页建议（adoption）

> 对线上已部署 console（dsh web 裸壳 + dsh-plugin-core-system）的实测盘点（2026-11-23）与逐页功能/UI 建议。设计定稿见 [console-ui.md](console-ui.md)「运行时设计 3.5」（v2 十屏 + Welcome 大屏 + 详情页矩阵 + 懒加载），本文回答三件事：**现状是什么、每页差在哪、按什么顺序落地**。执行体=core-agent 自循环（loop），一轮一个可验收增量。

## 0. 结论

1. 现状 = dsh web 官方壳（会话/插件/自动化任务三页）+ core plugin **已启用但零界面贡献**——console v2 的全部屏幕都是 plugin 经 Slots 新增的贡献，不修改 dsh 本体。
2. dsh 客户端已内置与 console v2 高度同构的模块（§2 清单）：**不重复造**，复用其交互模式与部分组件，core 概念（Service/Instance/Workflow/文档面/ConnectorOps）作为新数据源接入。
3. 两个环境阻塞（§1）不修则任何页面都活不长：trusted-host 缺域名（已修）与长连接代理超时（待修）。另有 token 随重启轮换的 UX 缺口。

## 1. 环境发现（P0，先于一切页面）

| # | 发现 | 根因 | 处置 |
|---|---|---|---|
| 1.1 | web 首页静态壳可载，但 gateway 物理流 `/api/remote.mux` 403，插件/会话/任务面板全不可用，左下无限「重新连接中」 | systemd 单元沿用了域名重分配前的 `--trusted-host` 清单，未含现域名；dsh web 信任检查拒绝代理后的 Host | **已修**：单元 ExecStart 追加现域名（留 `.bak`），daemon-reload+restart 后面板全部可用。**机制化**：域名分配是控制面对象，域名重分配必须同步 trusted-host——写入部署检查项（agent-pool-machine.md 已有机器条目处补一行） |
| 1.2 | `/plugins/events` 长连接反复被代理掐断（error log：`upstream timed out while reading upstream`，约 60s 周期） | NPM 该 host 未配置长 read timeout，SSE/长轮询被默认 60s 掐 | 待修：该 proxy host 的 location 加 `proxy_read_timeout 3600s` + `proxy_buffering off`（按 .bak 纪律变更 NPM conf）；或 dsh 侧对该端点做心跳。由执行 agent 以机器侧可操作者优先 |
| 1.3 | 自循环每轮自替换后重启 web，**token 每次轮换**，已打开的旧页面永久失联且只有死重连 | token 是进程启动期一次性值（实测 dsh 0.2.2-rc.5：launchToken 每进程一枚，无 CLI/env/config 固定口） | **已修（固定钥匙门，2026-11-23）**：agent 机上部署 `dsh-web-gate.service`（部署侧工具，不入仓）——`/?key=<固定值>` 302 到当下 fresh token（60s 周期从 journal 刷新），代理前向改指门，**用户入口从此恒定**；key 只存部署侧 env。console 连接态三色保留（rotated 态被门消化，浏览器重走固定入口即可） |
| 1.4 | 服务每 30–40min 自替换重启属预期（loop 节奏） | — | 非故障；console 必须把「短暂不可达」当常态设计（连接态灯 + 重试退避），不做崩溃式白屏 |

## 2. dsh 客户端可复用模块清单（实测自 bundle roster）

console v2 不自造这些交互，模块 id 直接引用（rc 期只锁交互模式与信息结构，不锁组件 API）：

| dsh 模块 | console v2 用法 |
|---|---|
| `dsh-client-ui-trajectory` / `dsh-client-ui-chat` | Agent 会话双视图基座；Session 详情页 `#/session/:id` 直接复用 trajectory 呈现 |
| `dsh-client-ui-jobs` / `dsh-client-ui-workflow-run` | Workflow 运行列表+运行抽屉/运行页（follow/page 语义同源） |
| `dsh-client-ui-goal` | Goal 对象卡与详情（Goal 是文档面一等对象） |
| `dsh-client-ui-approval` / `dsh-client-ui-plan` / `dsh-client-ui-permission-presets` | 审批页、Plan 呈现、权限面矩阵的交互基线 |
| `dsh-client-ui-agent-team` / `dsh-client-ui-subagent` | 拓扑图（root↔系统 agent↔子 agent）与子 agent 面板 |
| `dsh-client-ui-schedule` | 自动化任务与 Workflow 触发器（timer）的关系呈现 |
| `dsh-client-ui-tool` / `dsh-client-ui-secret-mask` | ConnectorOps 调用卡凭据脱敏 |
| `dsh-client-ui-shortcuts` / `dsh-client-locale` / `dsh-client-ui-theme` | 快捷键速查、中文文案、深色主题直接继承 |
| `dsh-api-terminal-controller` | gotty 之外的宿主内终端（终端 tab 的另一实现选项） |
| `dsh-client-ui-settings-*` | settings-card 风格基准（proto 的「?」说明面板沿用） |

## 3. 逐页建议（现状 → 功能 → UI）

### 3.1 会话主页（dsh hero「探索未至之境」）
- **现状**：纯 dsh hero：工作区选择 + 空输入框；无任何 core 信息。
- **功能建议**：hero 之上注册 Welcome 大屏 slot（v2 屏幕 0：业务健康度大数字、dev-delivery 阶段条、Service 简卡行、业务视角重要事件、快捷入口）；「选择工作区」语义映射为「选择要查看/对话的系统 scope」，下拉里并排列出系统清单（来自 cored 读面）。
- **UI 建议**：保持 hero 留白气质，大屏数据区在 hero 下折叠为一屏；未连接 cored 时大屏区退化为骨架行而不是报错块。

### 3.2 会话页 Chat（dsh Conversation shell）
- **现状**：可用（本会话未发消息实测——避免干扰在跑 loop）；输入框/发送键/附件、左栏会话树齐备。
- **功能建议**：会话按 agent 组织（左栏树顶层=agent，会话挂其下）；会话内工具调用卡升级为 ConnectorOps 卡（op 名等宽、可展开 payload、凭据脱敏）；文档修改提案卡（mini diff + 深链编辑器）与审批请求卡（深链审批页）作为两类一等消息卡。
- **UI 建议**：完全沿用 dsh 气泡/卡片/流式渲染；新增卡型视觉重量 ≤ 工具调用卡，避免喧宾夺主。

### 3.3 Trajectory 视图
- **现状**：模块在册（bundle 已含 `dsh-client-ui-trajectory`），是 Session 详情页的呈现基座。
- **功能建议**：`#/session/:id` 复用之并补 core 侧标注：每条工具调用标注所属 ConnectorOps 与 workflow 轮次链接（双轨审计入口）。
- **UI 建议**：不重绘；仅加行尾徽标（ops 名/轮次号，可点）。

### 3.4 插件页
- **现状**：内置配置 4 卡（子智能体/网页搜索与获取/Agent 循环/终端）+ 实验性开关 + 已安装 `dsh-plugin-core-system`（启用）。卡片行=图标块+名称+一句描述+开关，风格干净。
- **功能建议**：core plugin 条目点开应出现「core 面板」入口组（Welcome/系统树/Workflow/文档/事件/审批/连接/会话八个 slot 的启停与说明），让插件页成为 console 面的注册表；每卡加「数据来源」行（渲染数据全部来自 cored 读面+ops DB，硬性约定）。
- **UI 建议**：沿用卡片行样式；入口组做成 settings-card 分组，不引入新视觉语言。

### 3.5 自动化任务页
- **现状**：dsh 自带 schedule 面板（状态筛选 tabs/搜索/空态/新建），当前无任务。
- **功能建议**：与 Workflow 触发器打通——timer.resync 与事件触发的工作流轮次在此面板可见（只读呈现，操作回 Workflow 详情页=Apply）；避免两个「自动化」概念并存导致的语义混淆：此面板管「宿主级定时任务」，workflow 管收敛循环，页头各加一句定位说明并互链。
- **UI 建议**：沿用 tabs+列表；workflow 行复用运行管理页的相位 chip。

### 3.6 console v2 新增屏（定稿见 console-ui.md 3.5，此处只列落地要点）
| 屏幕 | 路由 | 落地要点 | dsh 复用 |
|---|---|---|---|
| Welcome 大屏 | `#/welcome`（默认落地） | 健康度合成口径写进 tooltip；事件分级用业务化标题 | hero 空间 + `schedule`/`jobs` 数据 |
| 系统树 | `#/tree` | 文档节点与资源节点同构渲染；子层懒展开 | 侧栏树交互模式 |
| 系统详情+场景面 | `#/s/:name` + `events/metrics/docs/permissions` | docs tag 过滤为一等过滤器；权限矩阵行=agent/role 列=ConnectorOps/Ref/Provider/写路径 | settings-card 分组 |
| Workflow 运行管理 | `#/workflows` `#/wf/:name` `#/wf/:name/r/:n` | 运行 tab 默认；启停/编辑/克隆/导入全部=Apply | `jobs`/`workflow-run` |
| 文档编辑器 | `#/doc/*` | LLM 只产草稿提案，Apply 必须人点（编辑/发布分离）；dry-run 三检查 | diff 卡/`secret-mask` |
| Agent 会话（console 版） | `#/chat/:agent` | 运行器四选（内嵌 dsh 默认/opencode cli/claude-code/gotty）；权限面右栏 | Conversation shell |
| 连接页 | `#/connectors` | agent-comm 详情=op 面+拓扑+消息日志+envelope 表 | `agent-team`/`tool` |
| 事件流 | `#/events` | 三泳道+右聚合面板；过滤条全局/单系统同款 | — |
| 审批 | `#/approvals` | diff 预览+批量；批准/驳回=Apply | `approval` |
| 详情页矩阵 | `#/agent|session|ws|provider|ref|role|event/:id` | 详情页任意互跳；标识符全可点 | `subagent`/`goal`/`secret-mask` |

### 3.7 loop 会话与 agent session 可见性（裁决）

1. **loop 的 dsh session 要在页面上展示**：loop agent（core-headless）本身是文档面注册 Agent（global/agents/core-headless），其会话挂在 `#/agent/core-headless` 的 sessions 列表；每轮 loop 的 session 与 `acceptance/loop-<seq>.md` 报告**双链**——session metadata.tags 带 seq（R17 打标纪律），Session 详情页与报告互跳。loop 轮次同时是 Workflow 运行管理里 dev-delivery/bootstrap 的轮次行（一数据两投影，无双源）。
2. **能看到具体 agent 的 session**：`#/agent/:name` 详情页必备区块=sessions 列表（tag/时间/状态过滤）；`#/chat/:agent` 左栏同源。数据源=dsh session store（同机直读、跨机经 gateway），console 不复制状态。
3. **跳转到的 agent 可见**：ServiceInstance 详情 agentRefs chip → `#/agent/:name`——身份=文档面 Agent 对象（权限面/owner/父子），运行态=dsh registry（在线/离线/当前会话徽标，区分「文档已注册但未运行」）→ 「对话」按钮进会话。
4. **与 dsh 原生会话侧栏的关系**：原生侧栏=宿主全局会话列表保持不动；console 的 Agent 会话屏=同一 session store 按 agent 过滤的投影。

## 4. 落地顺序（一轮一增量，映射 loop 起点）

| 增量 | 内容 | 验收 |
|---|---|---|
| E0 | §1.2 代理超时修复 + §1.3 连接三态（rotated 指引） | 断连面板可用≥1 个自替换周期 |
| E1 | plugin 注册 slot 壳：八入口导航 + hash 路由骨架 + 连接态灯 | 八入口可点、刷新可恢复路由 |
| E2 | Welcome 大屏 + 系统树（cored 读面：scheme/objects） | 健康度/树真实数据；标识符全可点 |
| E3 | Workflow 运行管理（列表+详情+运行抽屉） | 运行次数/相位/涉及文档可见，启停=Apply 闭环 |
| E4 | 文档编辑器（草稿→Apply 全流程，dry-run 三检查） | LLM 提案→人点 Apply→Revision+1 全链路 |
| E5 | Agent 会话 + 运行器四选 + 终端 tab（dsh 内置 PTY 为主，gotty 跨机兜底；provider 映射=内嵌 dsh/claude-code 现成 subagent provider，opencode/gotty 自写 SubagentProvider——cross-agent.md §5.7） | 能对 Service agent 发消息并收到 ConnectorOps 卡 |
| E6 | 事件流/审批/连接页 + 详情页矩阵互跳 | event→run→workflow→doc 链路走通 |
| E7 | 场景面四页 + tag 过滤 + 虚拟滚动大列表 | 千级事件滚动流畅 |

## 5. 执行红线（对 loop 的约束）

1. **不改文档面语义**：console 是观测/操作面，一切写操作（启停/编辑/批准/重跑）=Apply 走既有写路径；发现设计不合理→改文档先于改代码（acceptance 纪律）。
2. **渲染数据无双源**：全部来自 cored 读面+ops DB；console 不自建持久状态。
3. **R-PUB**：真实域名/IP/token/部署路径不入仓，用占位符；运行时验收产物落 acceptance/（gitignore）。
4. **交互契约以 proto 为准**：`dsh-core-agent/console-proto/`（Mac 侧，四文件，file:// 直开；机器侧副本 `<本机proto副本目录>` 由巡检 rsync 同步，实际路径记台账）是交互与信息结构对照物；实现允许复用 dsh 模块替换自绘组件，但屏的路由、区块、验收线不变。
5. **Connector/ConnectorOps 代码归属（R-ENG-3）**：gotty/opencode/claude-code/内嵌 dsh 四种运行器驱动与 agent-comm 实现都是 connector 代码——通用能力默认入 `common_connector`；确需独立仓时用 `gh` 建（org 内私有仓）并先在 rule.md R-ENG-3 注册再使用。
5. **硬性验收**（沿 console-ui.md 3.5）：界面上出现的任何资源标识符必须可点；详情页任意互跳；零控制台 error。

## 6. 可行性分析

| 风险 | 等级 | 缓解 |
|---|---|---|
| dsh client rc 期 API 变动 | ⚠️ 中 | 只锁交互模式与信息结构；组件 API 经插件层薄封装（沿 cross-agent.md 同款缓解） |
| Slots 注册面能力不足（能否加顶层导航/整页路由） | ❗高→需先验证 | E1 即是验证增量：注册失败则回退「单页挂 hero slot + 内部 hash 路由」方案（proto 已是 hash 路由，天然兼容） |
| cored 读面字段不足以渲染（如运行次数聚合） | ⚠️ 中 | ops DB 预聚合查询；缺字段先 E2 只读对齐再扩 cored，不前端拼凑 |
| loop 一轮体量过大（E3/E4） | ⚠️ 中 | 一轮一增量+探针回归；超一轮则拆（E4a 草稿面/E4b Apply 面） |
| 长连接被代理反复掐断影响所有面板 | ❗高 | E0 前置；修复前开发不受阻（proto 离线） |
| token 轮换打断实现期自测 | ⚠️ 中 | 探针脚本用 journalctl 取最新 token（既有套路） |

**结论：可行。E1 的 Slots 注册验证是唯一方向性风险，E0/E1 先行，其余增量均不阻塞在未知上。**
