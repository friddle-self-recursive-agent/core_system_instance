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
| 1.2 | `/plugins/events` 长连接反复被代理掐断（error log：`upstream timed out while reading upstream`，约 60s 周期） | NPM 该 host 未配置长 read timeout，SSE/长轮询被默认 60s 掐；实测根因：该端点（client-hmr 的 bundle graph 通道）连上后只在 graph 变更时发帧，**空闲期零字节**，前端代理 read 计时器必然超时 | **已修（机器侧，2026-11-23，E0）**：固定钥匙门（§1.3 部署侧工具）对该机 dsh web 反向代理的 SSE 响应（content-type=text/event-stream）做两件事——① idle-only 心跳：上游静默每 20s 注入一行 SSE 注释帧 `: keepalive`（SSE 客户端忽略注释行；注释帧只落在整块上游数据之间，不拆帧），前端代理 read 计时器持续被喂，60s 掐断链消除；② 逐响应加 `x-accel-buffering: no`，前端代理对本响应关缓冲（SSE 逐帧直达浏览器）。代理机 conf 侧 `proxy_read_timeout 3600s` + `proxy_buffering off` 保留为部署侧备选（须跳板变更，非本机可操作面，本轮未动）；dsh 侧端点本体不改（零心跳是 dsh 既有事实，console 红线不动 dsh 本体）。验收证据：经门与经代理域名两条链路 SSE 空闲存活远超 60s 且心跳帧间隔≤20s（acceptance/loop-35.md L35-01/02） |
| 1.3 | 自循环每轮自替换后重启 web，**token 每次轮换**，已打开的旧页面永久失联且只有死重连 | token 是进程启动期一次性值（实测 dsh 0.2.2-rc.5：launchToken 每进程一枚，无 CLI/env/config 固定口） | **已修（固定钥匙门，2026-11-23）**：agent 机上部署 `dsh-web-gate.service`（部署侧工具，不入仓）——`/?key=<固定值>` 302 到当下 fresh token（60s 周期从 journal 刷新），代理前向改指门，**用户入口从此恒定**；key 只存部署侧 env。console 连接态三色保留（rotated 态被门消化，浏览器重走固定入口即可） |
| 1.4 | 服务每 30–40min 自替换重启属预期（loop 节奏） | — | 非故障；console 必须把「短暂不可达」当常态设计（连接态灯 + 重试退避），不做崩溃式白屏 |

### 1.5 连接态三色（设计定稿，E0 落文档、E1 落实现）

**console 所有屏幕共用一枚连接态灯（右下角固定浮标）：底座事实=dsh web 客户端连接通道（含 `/plugins/events` 与远端 mux）的实时状态，三态+一指引。**

| 态 | 颜色 | 判定 | 面板行为 |
|---|---|---|---|
| connected | 绿 | 通道在册且基线/增量帧或心跳新鲜（≤2×心跳周期内收到过任意帧，含注释帧） | 正常渲染，无提示 |
| reconnecting | 琥珀 | 通道断开（网络断/服务重启窗口），指数退避重试中（1s 起步、×2、上限 30s） | 顶栏细条「重连中（第 N 次）」；数据区保留最后基线渲染+骨架行提示，**不白屏不报错块**（§1.4 常态化纪律） |
| rotated | 红+指引 | 重试收到 401/鉴权失效（token 随自替换重启轮换，§1.3）——连续 3 次 401 即判定，**不再无限重试**（旧 token 重试必败） | 指引条「入口已轮换 → 重走固定入口」：点击/自动跳转固定钥匙门入口（浏览器书签恒定），门 302 到当下 fresh token 即恢复；这是唯一需要人（或浏览器自动跟随重定向）动作的态 |

- 判定优先级：rotated ＞ reconnecting ＞ connected；态切换不整页刷新，恢复后走 baseline+increment 重放（重连=新 baseline 原子替换，对齐 console-ui 数据通路规则）。
- **rotated 判定边界=登录面（index）**：实测 dsh 0.2.2-rc.5 中 `/plugins/events` 通道（client-hmr bundle graph）无独立鉴权（任意/无 token 皆 200，传输面内部通道，鉴权边界在前端代理+固定钥匙门）；401 判据只能在登录面（index 授权门）上做——连接态灯实现（E1）以 index 重试响应码为 rotated 依据，不得以 events 通道响应为依据。
- **E1 实测补注（2026-11-23，loop-36）**：①登录面判据的载体=查询串 token 授权门（旧 token 过登录面=401 实测复现）；**cookie 会话面不随 launch token 轮换失效**（签名 cookie 跨进程有效=重启后旧 cookie 过 index/API/WS 全部通过实测）——launch token 轮换只影响「新进入」，由固定钥匙门消化；既有会话不因自替换重启失联（§1.3 前提在本 build 上收窄）。②rotated 态的触发面=真鉴权失效（会话吊销/签名拒绝/部署策略变更）；连接稳态下灯以登录面周期复检（60s）兜底覆盖该面；「重启→events 流重连→灯回绿」是正确行为（会话确未失效），非误报。
- 固定钥匙门消化 rotated 的大部分场景（用户从固定入口进入，token 轮换后重走固定入口即愈）；rotated 态指引的落点就是该固定入口，console 不自存 token 也不自存 key（R-PUB：key 只存部署侧 env）。
- 心跳注释帧（§1.2）参与「帧新鲜」判定——空闲期通道也有 20s 粒度的活性证据，connected 态不会因无业务帧而误报琥珀。

### 1.6 E1 实现拓扑与细化验收（2026-11-23，E1 轮）

**Slots 注册面结论（方向性风险 §6 的主案验证）**：dsh 0.2.2-rc.5 的顶层导航扩展位=客户端 slot `sidebar.panellist`（list，`id` ↔ `main` 面板键）+ `main`（keyed，`key`=面板 id，非 `conversation` 键无 Session 绑定）。注册该对即获得「顶层导航入口 + 整页路由承载面」。

**E1 拓扑裁决（八入口不占八个 dsh 面板）**：dsh 侧只加一枚入口（panellist id=`core-console` ↔ main key=`core-console`）；console 壳自带侧栏（proto 同构：Welcome/总览/系统树/Workflows/文档/事件/审批/连接/会话=§3.4 八组+总览），hash 路由在壳内（dsh client 不占用 location.hash——bundle roster 实测零引用）。路由即状态：**刷新恢复=注册完成后按 hash 判定 `layout.selectPanel`**（hash 是 console 路由而宿主面板选择已回落 → 重选本面板，不整页刷新）。proto 四文件整体内嵌为起点代码（用户裁决 2026-11-24）：app.js 手术=MOCK 数据走闭包不落 window、`$`/事件委托/键盘监听收进容器根（不触宿主全局 DOM）、挂载/卸载对称（卸载清定时器+摘监听）；css 全量作用域化（每条规则选择器收进容器类，keyframes 改名防全局碰撞）；SVG symbol id 加前缀防宿主碰撞。

**连接态灯实现依据（§1.5 落实现）**：判定核 DOM 无关、fetch/时钟可注入（单测确定性）。流面=对 `/plugins/events` 自持 **fetch 流式读**（非 EventSource——门注入的心跳是 SSE 注释帧，浏览器 EventSource 吞注释帧零回调，流式读才能把注释帧当活性证据）；新鲜窗=2×心跳周期=40s，超窗=流静默死亡→断流重连。rotated 判定边界=登录面（§1.5）：重连尝试期对页面自身地址（含 token 查询串）重取，**连续 3 次 401 → rotated 且停止重试**；2xx 清零；网络错误不计入。退避 1s 起步 ×2 封顶 30s；优先级 rotated＞reconnecting＞connected；rotated 指引=顶栏细条「入口已轮换→重走固定入口」+右下浮标红色，落点=固定钥匙门入口（key 只存部署侧，console 不自存）。

**E1 细化验收线（§4 E1 行展开；探针编号 L36-\*）**：
- L36-01 client bundle 链路：`window.__DSH_BOOT__` graph 含 `dsh-plugin-core-system` 行 ∧ `/plugins` combo 脚本 200 且为 lazy-CJS 工厂形（HTTP 机读）。
- L36-02 Slots 注册面：bundle 载荷含 `main` key=`core-console` 与 `sidebar.panellist` id=`core-console` 成对注册（静态断言）∧ 活体=headless 浏览器侧面板可选中。
- L36-03 八入口可点：壳内导航九项（§3.4 八组+总览）逐项点击 → hash 变更 ∧ 主区渲染对应屏（headless 活体断言）。
- L36-04 刷新可恢复：停在 `#/workflows` reload → 恢复同屏（headless）。
- L36-05 连接态灯：判定核状态机单测（帧新鲜=connected；断流退避=reconnecting 计数前进；登录面 3×401=rotated 停重试+2xx 清零）∧ 活体=浏览器内浮标绿色 connected。
- L36-06 零控制台 error：headless console 监听（宿主壳与本插件载荷均计；dsh 既有告警不计=基线先采）。
- L36-07 回归：781 项基线+E0 11 项全绿（零迁移）。

### 1.7 门面 Origin 改写（E1 轮实测发现，部署侧工具）

**现象**：固定钥匙门（§1.3）部署后，浏览器经门进入时 dsh 客户端壳可载（静态+登录链 200），但 `/api` XHR 与 `/api/remote.mux` WebSocket 全部 403——面板级数据面（会话/插件/任务）全不可用。**根因**：dsh web 的连接插件对每条 Host API 路由与流做 Host/Origin 检查（web-server.md 语义）；门的反代把 Host 改写为后端地址（在 `--trusted-host` 清单）但 **Origin/Referer 原样透传**——浏览器 Origin=门的 host:port，不在信任清单 → 403。HTTP 表现层此前未暴露=裸 curl 探针不带 Origin 头（查询代替日志的盲区：curl 证据覆盖不了浏览器才有的头）。**处置（部署侧，2026-11-23）**：门对反代与 WS upgrade 两路统一把 Origin/Referer 改写为后端自身 origin（门呈现=后端的信任面）；实测经门 WS 403→101、页面 403 群→零 error。**教训**：代理链上的鉴权面诊断必须用带浏览器头的探针（Origin/Referer/Cookie 三件套），纯 curl 2xx ≠ 浏览器可用；前端代理（openresty 面）对 WS upgrade 的转发配置仍是独立待验面（本机不可操作，挂账）。

### 1.8 E2 实现拓扑与细化验收（2026-11-23，E2 轮）

**数据通路（E2 起的通用读面链路，后续 E 轮复用）**：浏览器 → dsh web（同源）→ 宿主插件代理路由 `GET /core-console/api/v1/*`（dsh-plugin-core-system 经 `ctx.inject(['webServer','connection'])` 软出现注册——headless 宿主无 webServer 零影响）→ connection 鉴权栅栏（`requestRejection`，open-in-app 同款口径：401/403/undefined，**栅栏缺席=fail-closed 拒全部**）→ cored 只读 GET 面（cored-bridge.md §2）。代理只放行 `GET /v1/*`（非 GET=405 allow: GET；路径穿越=404；cored 未就绪=503；上游不可达=502）——**写路径唯一入口 POST /v1/apply 永不经浏览器代理**（§5 规则 1/2 的机械落点）。cored 侧新增 `GET /v1/events`（event_log 归档查询投影，limit/type/level/involved/since 五参最小集，limit≤500 防拖库；旧代经兜底 handler 405=代际判别器）——Welcome 最近重要事件（console-ui.md 屏幕 0 数据来源=event_log）与事件流页（E6）共用本面。

**E2 屏面换装范围（其余屏保持 proto mock 待各自 E 轮）**：Welcome 大屏 / 系统树 / 系统详情（最小面）/ 对象详情 viewer（`#/doc/:kind/:scope/:name` 直链 + `#/doc/:name` 名字解析，歧义=空态引导回树）/ 事件详情（`#/event/:id`）。 Welcome 数据源=cored 对象枚举+run 投影+event_log+草稿缓存；健康度合成口径写进 tooltip（InSync 率=status.phase=InSync 实例占比——instance status 回写在正文，live 层逐个现读；**0 实例=n/a 不冒充 100%**；drift=DriftReport 在册数；审批积压=ApprovalNeeded 归档数；24h 失败率=run 终态 failed/started）。dev-delivery 阶段条=run 投影相位落点映射（run=触发面受理投影，status: triggered|running|suspended|failed；**无 run=全 wait 空态不假画进行中**；suspended=闸锚挂起标注）。系统树=Global（builtin/global kind 分组）→ 系统（ServiceDesc）→ instances/workflows/workservices/docs 四组；文档节点与资源节点完全同构（kind 徽章/rev/草稿圆点）；树上标识符全可点 → 对象 viewer（只读，E4 起升编辑器）。退化纪律（§1.4）：读面不可达=骨架行+轻提示不报错块；事件归档空=诚实空态（「归档窗内暂无事件」）。

**E2 细化验收线（§4 E2 行展开；探针编号 L37-\*）**：
- L37-01 读面端点代际：`GET /v1/events` 200（新代）∧ 旧代 405（兜底 handler）——双状态码判别。
- L37-02 代理链路活体：经 dsh web（门链带浏览器头）`/core-console/api/v1/scheme` 200 且载荷与 cored 直查双读一致（同键同值）。
- L37-03 Welcome 真数据：headless 活体——系统行出现真实 ServiceDesc 名 ∧ 事件区零 mock 事件名（空态=「归档窗内暂无事件」或归档行业务化标题）∧ 健康度 tooltip 含构成口径。
- L37-04 系统树真数据：树上出现真实系统名/kind 分组 ∧ 全部对象行可点（`data-go=doc/<kind>/<scope>/<name>`）∧ kind 徽章/rev/草稿圆点在册。
- L37-05 对象 viewer：点击树行 → `#/doc/:kind/:scope/:name` 渲染 cored 现读正文（apiVersion 原文非 mock）∧ 引用标识符区在册（chips 或诚实空注）。
- L37-06 事件详情：`#/event/:id` 命中归档行=字段投影；未命中=空态（不报错块）。
- L37-07 回归：781 基线+E0 11 项+E1 16 项全绿（零迁移）+ npm test（plugin 仓）全绿。

### 1.9 E3 实现拓扑与细化验收（2026-11-23，E3 轮）

**数据面（cored v0.37 console 读面第二段）**：`GET /v1/workflows` 聚合投影——三源同投（声明=builtin 注册表∪文档库 Workflow 对象（本体/override 并存，origin 投影）；现势=run 环每锚最新 run 相位/状态；计数=event_log 归档分组×dispatch 决议，`workflow.RunAnchor` 与 run 投影同一锚解析）+ run 载荷新增 `involved` 键（运行抽屉「涉及文档」直接取字段落对象链接，无前端拼凑）。口径三诚实（入桥文档）：计数=归档触发量（含 braked 拦阻——不冒充已执行）；成功率不投影=run 终态事件未落归档（declared 余量，UI n/a 不冒充）；`enabled=null`=未声明不冒充。

**写面（E3 起 console Apply 通路）**：宿主插件新增 `POST /core-console/apply`（与只读代理 `/core-console/api` 前缀分立的 exact 路由）：connection 鉴权栅栏 fail-closed 同款 → 转发 cored `POST /v1/apply`（唯一写入口，三步闸门零旁路）→ 主体由**宿主注入**（config.applySubject，浏览器不携带主体；授权仍走文档面 Role/Group 判定）。部署侧：两 web profile coredArgs 追加 `--allow-apply`（写面显式开启=部署决策，锚点记台账）。

**启停=Apply 闭环（红线 b 的机械落点）**：console 对 workflow 的启停不直写 builtin 本体——落 Instance/系统层同名 override（origin: override-of-builtin，concepts/workflow.md §1）：override 在册=更新该对象 spec.enabled（rv 乐观锁）；override 缺席=builtin 有文档本体时克隆本体为 override（改 scope+origin 标注+翻转 enabled）、builtin 无文档对象=诚实拒绝（不发明 builtin spec 字段，E4 编辑器轮补全）。闭环判定=对象面：Apply 落库 rv+1 ∧ DocApplied 归档 ∧ UI 重读显示已停用 ∧ builtin 本体对象 rv 不动。**触发路径对 enabled 的实时 honoring 余量**（触发接线检查 spec.enabled=下一段）——本面闭环止于对象面+审计面，如实标注。

**E3 屏面换装范围**：Workflows 列表 / Workflow 详情（六 tab：运行默认/流程图/事件/流转/数据流/配置）/ 运行独立页 `#/wf/:name/r/:n`。运行 tab=dsh Jobs 双栏（run 列表+抽屉内联：相位时间线（声明序列+当前落点）/留痕 kv/涉及文档（run.involved+对象行）/action log=诚实空态余量/SessionLog=诚实空态余量）；流程图=生效相位序列线性渲染当前落点高亮；事件 tab=触发留痕过滤（route→该锚，eventId 可点=归档事件详情）；流转=run 行投影（相位+状态+时刻，前端过滤）；数据流=聚合面 dataflowInputs/Outputs 拼图节点全可点；配置=生效对象 YAML 只读+编辑深链。重跑/取消=余量不画按钮（mock 移除——不冒充动作）。

**E3 细化验收线（§4 E3 行展开；探针编号 L38-\*）**：
- L38-01 聚合面代际：新代 `GET /v1/workflows` 200 ∧ 覆写前旧代 405（carrier-pre 预采快照）——双状态码判别。
- L38-02 聚合面载荷：runs 载荷含 `involved` 键 ∧ 聚合行含 effective/phases/runsTotal（新代判别器键组）。
- L38-03 代理与写路由：经 dsh web（浏览器头）`/core-console/api/v1/workflows` 200 ∧ 与 cored 直查双读一致（同键同值）；`GET /core-console/apply` 405（写路由方法分立）。
- L38-04 Apply 闭环活体：经 dsh web `POST /core-console/apply` 停用 override → 200 rv+1 ∧ DocApplied 归档在册 ∧ 再启用回 true ∧ builtin 本体 rv 不动（双读取证，全程 API 查询代替日志）。
- L38-05 屏活体（headless）：Workflows 列表真数据（真实对象名/对象行）∧ `#/wf/:name` 六 tab 真数据 ∧ 运行抽屉 `#/wf/:name/r/:n` 相位时间线∧涉及文档可点 ∧ 零 console error。
- L38-06 回归：781 基线+E0/E1/E2 专项全绿（零迁移）+ npm test（plugin 仓）全绿。

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
| E0 | §1.2 代理超时修复 + §1.3 连接三态（rotated 指引）【已完成 2026-11-23：机器侧 SSE 心跳（§1.2）+ 三色设计定稿（§1.5），实现落 E1；探针=acceptance/loop-35.md】 | 断连面板可用≥1 个自替换周期 |
| E1 | plugin 注册 slot 壳：八入口导航 + hash 路由骨架 + 连接态灯【实现拓扑与细化验收=§1.6；主案验证通过=顶层导航扩展位（panellist+main 成对注册），回退案未动用】 | 八入口可点、刷新可恢复路由（细化=L36-01…07） |
| E2 | Welcome 大屏 + 系统树（cored 读面：scheme/objects）【已完成 2026-11-23：读面通路=`/core-console/api` 宿主只读代理+cored `GET /v1/events`（§1.8）；五屏真数据=Welcome/系统树/系统详情/对象 viewer/事件详情，其余屏 proto mock 待各自 E 轮；探针=acceptance/loop-37.md】 | 健康度/树真实数据；标识符全可点（细化=L37-01…07） |
| E3 | Workflow 运行管理（列表+详情+运行抽屉）【已完成 2026-11-23：数据面=cored v0.37 `GET /v1/workflows` 聚合投影+run involved 键（§1.9）；写面=宿主 `POST /core-console/apply`（主体宿主注入，唯一写入口零旁路）；启停=override 语义闭环（红线 b）；探针=acceptance/loop-38.md】 | 运行次数/相位/涉及文档可见，启停=Apply 闭环（细化=L38-01…06） |
| E4 | 文档编辑器（草稿→Apply 全流程，dry-run 三检查） | LLM 提案→人点 Apply→Revision+1 全链路 |
| E5 | Agent 会话 + 运行器四选 + 终端 tab（dsh 内置 PTY 为主，gotty 跨机兜底；provider 映射=内嵌 dsh/claude-code 现成 subagent provider，opencode/gotty 自写 SubagentProvider——cross-agent.md §5.7） | 能对 Service agent 发消息并收到 ConnectorOps 卡 |
| E6 | 事件流/审批/连接页 + 详情页矩阵互跳 | event→run→workflow→doc 链路走通 |
| E7 | 场景面四页 + tag 过滤 + 虚拟滚动大列表 | 千级事件滚动流畅 |

## 5. 执行红线（对 loop 的约束）

1. **不改文档面语义**：console 是观测/操作面，一切写操作（启停/编辑/批准/重跑）=Apply 走既有写路径；发现设计不合理→改文档先于改代码（acceptance 纪律）。
2. **渲染数据无双源**：全部来自 cored 读面+ops DB；console 不自建持久状态。
3. **R-PUB**：真实域名/IP/token/部署路径不入仓，用占位符；运行时验收产物落 acceptance/（gitignore）。
4. **交互契约以 proto 为准，实现落在 dsh plugin 里**（用户裁决 2026-11-24）：`dsh-core-agent/console-proto/`（Mac 侧，四文件，file:// 直开；机器侧副本 `<本机proto副本目录>` 由巡检 rsync 同步，实际路径记台账）是交互与信息结构对照物，**独立页永久保留**；但实现必须经 dsh Slots 贡献进 dsh web client（dsh-plugin-core-system），不得做成独立站点；proto 的 hash 路由四文件可整体内嵌 slot 作起点代码，再逐步替换为 dsh 模块——屏的路由、区块、验收线不变。
5. **Connector/ConnectorOps 代码归属（R-ENG-3）**：gotty/opencode/claude-code/内嵌 dsh 四种运行器驱动与 agent-comm 实现都是 connector 代码——通用能力默认入 `common_connector`；确需独立仓时用 `gh` 建（org 内私有仓）并先在 rule.md R-ENG-3 注册再使用。
6. **硬性验收**（沿 console-ui.md 3.5）：界面上出现的任何资源标识符必须可点；详情页任意互跳；零控制台 error。

## 6. 可行性分析

| 风险 | 等级 | 缓解 |
|---|---|---|
| dsh client rc 期 API 变动 | ⚠️ 中 | 只锁交互模式与信息结构；组件 API 经插件层薄封装（沿 cross-agent.md 同款缓解） |
| Slots 注册面能力不足（能否加顶层导航/整页路由） | ❗高→需先验证 | E1 即是验证增量：注册失败则回退「单页挂 hero slot + 内部 hash 路由」方案（proto 已是 hash 路由，天然兼容） |
| cored 读面字段不足以渲染（如运行次数聚合） | ⚠️ 中 | ops DB 预聚合查询；缺字段先 E2 只读对齐再扩 cored，不前端拼凑 |
| loop 一轮体量过大（E3/E4） | ⚠️ 中 | 一轮一增量+探针回归；超一轮则拆（E4a 草稿面/E4b Apply 面） |
| 长连接被代理反复掐断影响所有面板 | ✅ 已消化（E0 机器侧） | 固定钥匙门 SSE idle 心跳+逐响应关缓冲（§1.2），空闲存活远超代理默认 60s；代理机 conf 侧改法留作部署备选 |
| token 轮换打断实现期自测 | ⚠️ 中 | 探针脚本用 journalctl 取最新 token（既有套路） |

**结论：可行。E1 的 Slots 注册验证是唯一方向性风险，E0/E1 先行，其余增量均不阻塞在未知上。**
