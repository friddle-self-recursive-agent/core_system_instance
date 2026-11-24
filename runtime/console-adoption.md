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

### 1.10 E4 实现拓扑与细化验收（2026-11-24，E4 轮）

**数据面（cored v0.38 console 读面第三段）**：`GET /v1/history/{kind}/{name}?scope=<scope>` 对象应用史投影——数据源=ops DB `apply_log`（ops-log.md §2：一次 Apply 判定的流水，repository 双写钩子落 ok/noop/conflict 行+引擎 denied 行；**历史 tab 的权威=审计账不是 git 考古**——git 权威在正文，rev 流水在账）；`obj=kind/scope/name` 过滤+rv 降序+limit 收敛（≤500 防拖库同口径）；`ApplyLogFace` 可变口面（`QueryApplies` 新方法不占冻结 Store 签名，与 EventLogFace.GroupEvents 同款模式）+face 缺席=503 防御面（旧代兜底 405=代际判别器恒成立）；行载荷 `ts/rv/result/fieldManager/subject/reasonRef`（denied 行 subject 必带=判定主体可追溯）。装配层随 ops DB 恒注入（cmd/cored 与 WithEventLog 同点位）。

**写面（E4 草稿通道，浏览器→cored 的第二条宿主路由）**：宿主插件新增 `POST /core-console/drafts`（落稿 upsert）+ `DELETE /core-console/drafts/{kind}/{name}?scope=`（弃稿）——prefix 路由内按方法+路径分立（exact 段=POST，子路径=DELETE；其余=405 allow: POST,DELETE），connection 栅栏 fail-closed 与 apply 路由同款（handler 内再锁一道：reject 缺席=拒全部）；体不可解析=400；cored 未就绪=503；上游不可达=502。**fieldManager=客户端溯源串**（与 E3 apply 的 `console:workflow-toggle` 同款——溯源非授权：授权主体仍由宿主注入 apply subject，草稿面不触文档面零授权面）；客户端缺主=宿主补缺省 `console:editor`（无主稿 cored 侧 400 拒绝，宿主兜底保 UX）。dry-run 三检查不经新路由——`POST /core-console/apply` 既有通路携 `fromDraft:true, dryRun:true`（引擎 admit ①scheme②权限 零副作用预检+dry-run 回执 `rv`=文档面现值——**乐观锁检查=客户端比对**：回执 rv ≠ 草稿 baseResourceVersion → 弹窗判 ✗（真 apply 将 409 且稿保留））。

**E4 屏面换装范围**：对象 viewer 全线升编辑器（`#/doc/:kind/:scope/:name` 直链+`#/doc/:name` 名字解析+ws/provider/ref/role/agent/connector 详情路由共用同屏——文档与资源同规则）：中央编辑器（textarea，编辑=debounced 落稿不触文档面不发事件）+右栏协作面板四 tab（**LLM 提案**=提案队列：数据源=草稿缓存中 fieldManager 非 `console:` 前缀的稿（agent 经草稿通道落的提案，会话页提案卡深链至此=E5 接线余量如实标注）——diff 卡 vs 文档面现值，每张 [加入草稿]（采纳=工作副本更新）/ [丢弃]（DELETE 弃稿）；proto 的 LLM 对话输入摘除=真实生成面（agent 会话）接线前不冒充）；**草稿**（默认）=累积 diff（手动+已采纳提案同通道）+条目留痕（来源/摘要/时刻）+完整 diff+吸底 Apply dock+弃稿；**历史**=apply_log 投影行（rv/结果/fieldManager/subject/reasonRef；点行 diff 上一版=rev-content 面余量如实标注）；**元数据**=对象身份键+rev+草稿态+写路径说明。确认弹窗=完整 diff+dry-run 三项检查（scheme 校验/权限准入/乐观锁）逐行 ✓/✗ 机械呈现，三 ✓ 才解锁确认按钮；空草稿=dock 禁用（服务端 noop/无稿 404 双保险）。

**E4 细化验收线（§4 E4 行展开；探针编号 L39-\*）**：
- L39-01 历史面代际：新代 `GET /v1/history/{kind}/{name}?scope=` 200 ∧ 覆写前旧代 405（carrier-pre 预采快照）——双状态码判别。
- L39-02 草稿写面通路：经 dsh web（浏览器头）`POST /core-console/drafts` 落稿 200 ∧ `GET /core-console/api/v1/drafts` 在册且与 cored 直查双读一致（同键同值）∧ `DELETE` 弃稿 → 404 后续（幂等清场）；`GET /core-console/drafts` 405（写路由方法分立）。
- L39-03 dry-run 三检查：有稿 `POST /core-console/apply {fromDraft:true,dryRun:true}` → 200 `action=dry-run` 且 `rv`=文档面现值；野 kind → 404（scheme ✗）；受限主体直查 cored → 403（权限 ✗——宿主注入的 console-operator 全权，403 判据走 cored 直查面）；陈旧 baseRV → 回执 rv ≠ baseRV（乐观锁 ✗ 判据=客户端比对，单测覆盖）。
- L39-04 全链路闭环活体（headless）：LLM 提案落稿（fieldManager=`agent:…` 非 console 前缀）→ 编辑器屏 LLM tab 提案卡在册（diff 卡）→ [加入草稿] → dock N 处变更 → 点 Apply → 确认弹窗三检查 ✓ → 确认 → Revision+1 ∧ DocApplied 归档在册 ∧ 草稿清空（GET /v1/drafts 无此稿）∧ UI rev 更新 ∧ 零 console error。
- L39-05 空草稿纪律：无 diff → dock 禁用（活体）∧ 直发 `POST /core-console/apply {fromDraft:true}` 无稿 → 404（与 noop 可区分，服务端兜底）。
- L39-06 回归：781 基线+E0/E1/E2/E3 专项全绿（零迁移）+ npm test（plugin 仓）全绿。

### 1.11 E5 实现拓扑与细化验收（2026-11-24，E5 轮）

**E5 拆分裁决（E5a/E5b，一轮一增量纪律）**：E5 含两条独立数据面——①会话面=dsh session store（client 侧 ctx.sessions/ctx.remote/ctx.webTerminals）；②agent-comm 运行面=宿主四 op 工具（envelope v0.1，§5.3 挂载面）。同轮落地违反一轮一增量体量纪律（§6 风险行同款处置）：**E5a=会话屏真数据换装+发消息真通路+ConnectorOps 卡渲染判别器（本轮）；E5b=agent-comm 四 op 工具面入 plugin 宿主（R-ENG-3：通用能力默认 common_connector，确需独立仓先 rule.md 注册——工具宿主=core plugin 本体，落 plugin 仓）+agent 声明集种子（global/connector-ops/agent-comm 对象+Agent.mount），使「收到 ConnectorOps 卡」活体达**。E5b 完成前，卡片活体=判别器单测+真会话工具卡渲染，ConnectorOps 卡活体如实标注 unverified（不冒充）。

**数据通路（E5a）**：浏览器 client cordis ctx——`ctx.inject(['sessions','remote'])` 软出现（缺席宿主回调不启动，chat 屏 `ready()=false` 诚实降级）；`ctx.sessions.list/create/using`（清单快照/新建/**prompt 真通路**——beginSubmission+prompt(mode=queue|steer, requestId)，cross-agent.md §5.7 #2 机械落点）；`ctx.remote.session.page`（转录事件页读面：user/message、assistant/message、tool/call+tool/result 按 callId 配对；context 注入行不上对话面只入轨迹）；`ctx.webTerminals.watch`（内置 PTY roster 真数据，§5.7 #6 主案）。**身份=SessionId 的文档面落点**：console 新建会话成功 → 既有 apply 通路（fieldManager=`console:chat-backfill`，rv 乐观锁）回填 Agent `status.currentSession={id,startedAt,docsLoaded}`（§5.7 #1；已有 status 块=结构化合并 E5b 余量诚实跳过不盲写）。归属过滤（§3.7 会话组织裁决）三层证据：①文档面 status.currentSession.id ②console 发起（内存 UI 态，零持久状态）③agentRefs 显式 `session://<id>` 形；其余行入「宿主全部会话」组不冒充归属。渲染数据双权威面（红线 2 细化）：文档面/资源状态=cored 读面；会话运行态=dsh session store（§3.7 显式裁决）——两权威各管一面无双源。

**E5a 屏面换装范围**：`#/chat/:agent` 全屏（左栏=会话清单归属两层+owner 反查；中栏=转录渲染[chat/trajectory 双视图]+输入条[queue/steer 模式开关]+**运行器四选 modal**（内嵌 dsh 可用；claude-code/opencode/gotty=在册禁用+why 诚实余量标注）；右栏=权限面 Agent 文档面真数据（connectorOps 挂载 refs/Provider/Ref/Role/autoLevel/op 声明集——mock token 字样摘除））；`#/session/:id` 真数据（session 事件页轨迹+归属反查）；ServiceInstance 详情页真数据（实例条目=ServiceDesc 正文现读、agentRefs chips 全可点、「在对话框调用该 Agent」跳转 `#/chat/:agent`=任务原文 #3 跳转链；conditions/metrics=引擎回写面，对象缺席=诚实空态）；`#/agent/:name` 保持编辑器屏（E4 文档与资源同规则——sessions 列表落 `#/chat/:agent` 左栏，同源不复制）。假动作摘除：pin/archive 按钮（session store 无客户端面）、仿 gotty 终端、personaReply 假流式回复。**ConnectorOps 卡判别器**：转录工具调用 op 名 ∈ agent 文档面声明集（spec.connectorOps[].ops × ConnectorOps 对象 spec.ops 并集）→ ConnectorOps 卡（op 名等宽+payload/result 展开+凭据值打码）；声明缺席=普通工具卡（不冒充协议挂载）。

**E5a 实现补注（2026-11-24，探针活体实测沉淀）**：①cordis 客户端服务护栏=**回调式 `ctx.inject(['sessions'],…)` 软出现**（声明式 `exports.inject` 加 `sessions/remote` 名会让 cordis apply 停等=整面板缺席——E5 探针字节级二分实证：E4 字节活/E5 任意重建停等；`remote.session` 命名空间未声明即访问抛 without inject）——faces 一律回调注入，缺席宿主回调不启动=chat 屏 ready()=false 诚实降级。②转录活体源=**sessions.retain 持有的 `binding.eventSource` 事件窗**（retain 自带初始历史开窗+订阅即活体；热路径[create→prompt→回复]全链实证；**冷会话空窗=declared 余量**——console 面板上下文冷 retain 事件窗不回放全史，native 会话视图承载全史，console 深链历史=同源余量；loadOlder 显式补拉已接仍空窗，如实标注）。③对话/终端切换**恒在册**（proto 原型=仅终端态显示切换，chat 视图不可达终端 tab=可达性破缺，探针修正）。④身份回填：首回填（无 status 块）=rv 前进落库实证；**已有 status 块=结构化合并 E5b 余量**（不盲写覆盖，诚实 toast）。⑤探针入口 locator 须知：面板入口 title 随 pin 态改写（`core console` ↔ `Unpin core console from sidebar`），活体断言用 `[title*="core console" i]` 子串匹配。


**E5a 细化验收线（§4 E5 行展开；探针编号 L40-\*；E5b 线=E5b 轮补入）**：
- L40-01 会话数据源活体：chat 屏左栏=dsh session store 真实行（headless：新建后清单行 id ∈ 宿主 store 投影）∧ 零 mock 会话名（sess-term-*/builtinRoot 摘除判据）。
- L40-02 发消息真通路：headless 活体——新建会话（内嵌 dsh）→ 输入 Enter → prompt 回执 accepted（发送面判别联合 ok）∧ 转录重读出现真实 user/message 行（session.page 读面）∧ 零 console error。
- L40-03 ConnectorOps 卡判别器：单测（声明集命中→ConnectorOps 卡；缺席→普通工具卡；callId 配对回填 result）∧ 活体=真会话工具事件渲染在册。**E5b 前真调用卡活体=unverified（如实标注）**。
- L40-04 运行器四选：modal 四项在册 ∧ 内嵌 dsh=真创建（新 SessionId 入 store）∧ 其余三=禁用+余量标注（headless 断言 disabled+why）。
- L40-05 身份回填写面：创建成功 → cored 直查 `GET /v1/objects/Agent/<name>` 含 `status.currentSession.id=<新 SessionId>` ∧ DocApplied 归档在册（fieldManager=console:chat-backfill）。
- L40-06 ServiceInstance→Agent 对话跳转：实例页 agentRefs 来自 ServiceDesc 正文现读 ∧ 「在对话框调用该 Agent」→ `#/chat/:agent` 渲染该 agent 文档面（headless 活体）。
- L40-07 终端 tab：roster 只读真数据（或 ctx.webTerminals 缺席=诚实空态）∧ 主案/兜底标注在册 ∧ attach=xterm 依赖余量标注（不冒充终端）。
- L40-08 回归：781 基线+E0/E1/E2/E3/E4 专项全绿（零迁移）+ npm test（plugin 仓）全绿。

### 1.12 E5b 实现拓扑与细化验收（2026-11-25，E5b 轮）

**归属裁决（R-ENG-3 核查，2026-11-25 注记 rule.md）**：agent-comm 四 op 工具=core plugin 对 dsh 宿主工具面的贡献（`ctx.tools.register`），**不是 connector 驱动**——四 op 是宿主内进程级通道，不绑部署用法、无独立通信栈（§5.3「无独立通信栈」的机械落点）；工具宿主=plugin 仓本体，不入 common_connector、不建新仓。

**工具面（server 侧，plugin 仓 src/agent-comm.ts）**：四工具以**协议 op 名裸用**（`dispatch`/`query`/`interrupt`/`inbox`——§5.3「agent 只见四个 op」机械落点；E5a 判别器 op 名 ∈ 声明集零改动即命中 ConnectorOps 卡；dsh 保留名 run_code 之外全域撞名核查 2026-11-25 通过）。注册防御面：ctx.tools 缺席宿主=不注册不炸；撞名=warn+跳过该 op 其余照常。

**协议实现（envelope v0.1，§5.1/§5.2 逐字段）**：校验=v 恒 0.1/id uuid（幂等键）/ts RFC3339/from-to=`agent/<name>@<scope>`/kind 四原语枚举/payload 自由对象（object）/refs 可选 string[]/**token dispatch 必带**（§5.2 接收侧硬规则——工具面即发起+接收两侧合一面，缺 token 拒收）。to 解析三步（§5.7 #1）：①ref 形校验 ②文档面 Agent 对象在册（coreSystem bridge get，`status.currentSession.id` 回填体或 agentRefs 显式 `session://` 形）③活体注册表 `ctx.agents.get(sessionId)` 可解析——缺文档面=拒（无服务发现 §5.4）、缺身份载体=拒（身份=SessionId）、活体缺席=拒（同机传输前提；跨机 typert=v0.2 declared 余量）。**inbox 豁免活体检查**（requireLive=false）：拉取面对着自己/冷会话也要可用，mailbox 落账不依赖活体。

**四 op 落点（§5.7 #4 对照表机械映射）**：
- `dispatch` → sessionController `prompt({mode:'queue'})`（真通路=E5a 已实证的宿主受理面；回执 accepted=消息入对端会话队列；对端业务回复在其 SessionLog——§5.2 dispatch 回执两路之另一路，v0.1 不自动回传）。
- `query` → 同步只读快照（live/status/pendingInbox 计数/mailboxPending/文档面 phase）——**§2 对齐表 query↔get/list 分支**；inject 文本注入通路=v0.2 declared 余量（对话式问询引导走 dispatch）。
- `interrupt` → sessionController `cancel({sessionId})`（§5.7 #4 cancel/interruptByUser 对照）。
- `inbox` → 进程内 mailbox 落账面（error reply 按 to 归档，id 幂等去重，FIFO 容量 50/ref）拉取消费 + 活体 pending 输入计数投影（**不消费 dsh pending 队列**——那是目标 agent 驱动队列）。v0.1 reply 非原语：本面只落 error reply，业务回复走 SessionLog（§5.2）——mailbox 是我方进程内投递面失败回执，from=发起方自记不冒充目标身份。

**from 解析**：exec.agent.id 反查文档面（list Agent→get→currentSession.id 命中）→ `agent/<name>@<scope>`；未回填身份的会话=诚实降级 `agent/<sessionId>@session`（可追溯）；caller 缺席=拒（对等面信任已注册发起方 §5.2）。

**装配（软出现纪律，§1.11 补注①同款）**：sessionController prompt/cancel 面=回调式 `ctx.inject(['sessionController'],…)`（声明式 inject 加新服务名=apply 停等教训原样规避）；`ctx.agents` 服务直读（宿主根 ctx 恒在，缺席=活体解析必拒）；cored 文档面解析=本插件自 provide 的 coreSystem bridge 闭包直引（零新 inject 面）。

**声明集种子（文档库经 apply 落库，三对象）**：WorkService `agent-comm`（category=tool，tools=四 op——ConnectorOps spec.workservice ref 解析锚）→ ConnectorOps `agent-comm`（spec.workservice=agent-comm，ops=四原语——§5.3 挂载面 yaml 落地）→ Agent `core-headless` spec.connectorOps mount `{ops: connector-ops/agent-comm, as: agent-comm}`（E5a 判别器声明集数据源；apply 走三步闸门 rv 递增，DocApplied 归档在册）。

**E5b 细化验收线（§4 E5 行展开；探针编号 L41-\*）**：
- L41-01 四工具注册活体：宿主日志「agent-comm 四 op 工具已注册（4/4）」∧ 活体=headless 会话转录可见 dispatch/query/interrupt/inbox 四工具（chat 屏新会话内可调用——工具全局注册=各 profile agent 可见）。
- L41-02 声明集种子在册：cored 直查 `GET /v1/objects/ConnectorOps/agent-comm?scope=global` 200 且 ops=四原语 ∧ WorkService agent-comm 200 ∧ Agent core-headless spec.connectorOps 含该 ref（rv 递增=apply 闸门通路）。
- L41-03 真调用 ConnectorOps 卡活体（E5 验收线收口）：chat 屏新会话发「用 dispatch 派发测试消息」→ 转录 tool/call name=dispatch 命中声明集 → **ConnectorOps 卡在册**（op 名等宽+payload 展开）——L40-03 的 unverified 标注就此消除。
- L41-04 协议校验活体：无 token dispatch=工具回执 error（envelope 校验失败：dispatch 必须携带 token）∧ to 未注册=error reply（无服务发现）∧ error reply 落发起方 mailbox（inbox 拉取可见——同会话或探针会话）。
- L41-05 dispatch 真通路：合法 dispatch → 回执 accepted+sessionId ∧ 对端会话转录出现 user/message 行（SessionLog 承载=对端回复两路之一）。
- L41-06 回归：781 基线+E0…E4 专项全绿（零迁移）+ npm test（plugin 仓，agent-comm 测试面新增）全绿。




### 1.13 E6 实现拓扑与细化验收（2026-11-25，E6 轮）

**读面复用裁决（零 Go 改动，复用优先）**：E6 全部数据源=既有读面（`/v1/events`、`/v1/drafts`、`/v1/objects`、`/v1/workflows/runs`、`/v1/workflows`、`/v1/triggers`——E2/E3/E4 通路）+ **一个插件宿主新读路由** `GET /core-console/comm`（plugin 侧非 cored——agent-comm 运行时落账面的浏览器读出口）。run→doc 反查链=`/v1/workflows/runs` 载荷 `eventId`/`involved` 键（v0.37 已有）客户端过滤，不扩 cored；事件→路由→workflow 锚=既有 `/v1/triggers/resolve` 查询面（决策投影恒开）。**载体同代口径成立：cored 零重建**（carrier-pre 快照照采，判别器=新端点旧代 404）。

**事件泳道映射（三泳道，console-ui.md 屏幕 9 机制化）**：泳道=类型族映射纯函数 `eventLaneOf(type)`——**状态变迁 lane={DocApplied}**（对象 rv 前进=状态变迁的机械落点）；**数据事件 lane={ExternalChanged, MetricThreshold, DriftFixed, ReconcileTick}**（数据面/巡检驱动源族）；**事件流 lane=其余**（ApprovalNeeded/Escalate/HeartbeatLost/InstallRequested/TemplateFound/SessionClosed/未知类型缺省——缺省归事件流不丢行）。右聚合面板=归档窗内实数（渲染数据无双源）：审批积压=归档 ApprovalNeeded 行数；死信率=`routedTo` 含 `dead-letter` 行占比；类型分布=top5 计数；**workflow 成功率=declared 余量 n/a**（run 终态事件未落归档，v0.37 口径不冒充）；**token/预算消耗=无数据面 n/a**（mock spark 摘除）。事件窗=`/v1/events?limit=100`（E7 虚拟滚动收口千级——declared 余量如实标注）。

**审批（屏幕 10，红线 1：批准/驳回=Apply）**：待审区=**草稿缓存**（`GET /v1/drafts` 全量——草稿=代改代审的家，apply.md §6；草稿在册即待审项，无论主是人是 agent）∪ **ApprovalNeeded 归档行**（`GET /v1/events?type=`）；**diff 预览=稿 content vs 文档面现值**（`GET /v1/drafts/{kind}/{name}` + `GET /v1/objects/{kind}/{name}` 渲染时现读，不缓存）；**批准=既有 Apply 全流程复用**（dry-run 三检查→人确认→fromDraft 落库——E4 通路零旁路；approval_log 独立账=declared 余量，留痕=apply_log 行 fieldManager=`console:approve` + DocApplied 归档；**机制沉淀（探针首轮实测）**：apply 幂等=整文档 canonical 比对（canonicalWithoutRV 重编码），**注释行差异=幂等 noop 不落 rv**——探针稿必须为语义差异（spec.ops 序翻转）才达「落库 rv+1」判据；）；**驳回=`DELETE /core-console/drafts/{kind}/{name}`**（弃稿零文档面动作——驳回≠反落库，不发明反向写路径）；**批量=同 kind 多稿顺序 Apply**（逐条 dry-run→apply 独立判别结果，单条失败不中断后续；高危单条必审判据未声明=批量限同 kind 草稿组，机制如实标注）。ApprovalNeeded 无稿行=只读待审卡（批准面缺席不冒充——深链 involved 对象编辑器，批准动作缺席即 UI 不出现按钮）。

**连接页（屏幕 8）**：三组=cored objects 跨 scope 枚举（`/v1/objects/{WorkService,ConnectorOps,Provider}`——E2 通路复用）；ConnectorOps 详情=**编辑器屏第五 tab「运行面」**（ConnectorOps kind 专属，缺省 tab=运行面）：agent-comm：op 面（四原语卡+实时计数）+拓扑（节点=文档面 Agent×connectorOps mount 命中 ∪ comm 落账 from/to refs，边=comm 落账行——SVG 静态投影全可点）+消息日志（comm 落账流水：ts/from→to/op/payload 摘要/token 打码/状态/sessionId 深链 `#/session/:id`）+envelope 表（v0.1 字段静态说明=协议文档非数据）；非 agent-comm ConnectorOps：op 面（spec.ops 现读）+挂载方（Agent docContent 反查）+相关事件（归档 involved 过滤）+编辑器深链。**comm 落账面（E6 新）**：`executeAgentCommOp` 每次调用落一条流水（ts/from/to/op/ok/error/envelopeId/sessionId/hasToken——**token 值永不落账**，只记 hasToken 布尔），进程内环形缓冲 200 条 FIFO；回执结果全量在册（accepted+error 两路——§5.2 dispatch 回执与 error reply 落账面合一，v0.1 SessionLog 业务回复仍不回传）。**红线 2 边界澄清：comm 落账=agent-comm 协议运行时自身记账（mailbox 同族扩展），非 console UI 自建持久状态**——console 只渲染；进程内不跨重启。暴露=`GET /core-console/comm`（exact，GET only；connection 栅栏 fail-closed 与 apply 路由同款——handler 内再锁一道；载荷 `{ops, refs, journal, mailboxPending}`）。旧插件代=该路由缺席（dsh 兜底 404）=代际判别器（carrier-pre 快照）。

**读面缺口（E6 探针实证——loop-44 收口，见 §1.15）**：WorkService 单对象读面缺席已收口：storage 模板归 global 桶（`global/workservices/<name>/workservice.yaml`——作用域=Global 物化），单对象 GET 可寻址；客户端两处诚实守卫（编辑器屏/tag 现读）随之摘除。原缺口记录：storage 模板 `workservices/<name>/workservice.yaml` 无 scope 段，单对象 GET 无可寻址分支恒 400（写入面同款闸=loop-41 deviation ④），客户端不发 400 fetch 走诚实空态。**详情页矩阵（硬性验收 §5 规则 6）**：event 详情=E6 增强——involved 对象链（E2 既有）+**run 反查链**（`/v1/workflows/runs` eventId 命中→`#/wf/:name/r/:n`）+**workflow 锚链**（`/v1/triggers/resolve` route 投影→`wfAnchorOfRoute`→`#/wf/:name`）——**event→run→workflow→doc 链路走通=E6 验收主线**；ws/provider/ref/role 详情=编辑器屏（E4 文档与资源同规则既有路由零改动）+标识符 chips（refChips）可点；ConnectorOps 详情=编辑器屏+运行面 tab（本节）；`#/connectors` 三组卡全可点落详情路由——矩阵互跳网闭合。

**E6 细化验收线（§4 E6 行展开；探针编号 L42-\*）**：
- L42-01 事件流屏实数：headless 活体——真实归档行渲染（真 DocApplied 行在册 ∧ 零 mock 事件名）∧ 泳道标注=lane 映射（DocApplied 行=状态变迁 lane）∧ 聚合面板审批积压数=API 双读一致 ∧ 成功率/token 字样=n/a 在册（不冒充）∧ 行点击→`#/event/:id`。
- L42-02 审批闭环活体（headless）：探针落稿（fieldManager=`agent:probe-loop42`，对象=ConnectorOps/global/agent-comm，差异=spec.ops 序翻转[语义差异——注释行=canonical noop 实测换型]）→ 审批屏待审卡在册（diff 预览=稿 vs 面真实差异）→ 批准（dry-run 三检查 ✓→确认）→ 200 rv+1 ∧ DocApplied 归档在册 ∧ 草稿清空（GET /v1/drafts 无此稿）；驳回路径=第二稿 DELETE → 后续 GET 404；ApprovalNeeded 无稿只读行（注入事件）在册且无批准按钮。
- L42-03 连接页实数：三组=cored objects 枚举真名（agent-comm/notify-send-email/email-notify 等在册）∧ agent-comm 运行面 tab=四原语卡+envelope 表在册 ∧ 消息日志=comm 落账真行（探针 dispatch 失败回执落账）∧ token 列打码（值不出现）。
- L42-04 comm 读面代际：新代 `GET /core-console/comm` 200 ∧ 载荷含 ops/refs/journal/mailboxPending 键 ∧ ok=false 失败落账行在册 ∧ 双读一致（幂等快照）∧ 旧代 404（carrier-pre 快照）。
- L42-05 详情页矩阵互跳链（headless 活体）：`#/event/:id`（DocApplied 归档行）→ involved 对象 chip 可点 → 编辑器屏；run 反查（批准 Apply 产的 DocApplied → `/v1/workflows/runs` eventId 命中 → 事件详情 run 链在册可点 → `#/wf/:name/r/:n` 渲染）→ workflow 锚链 → `#/wf/:name`；ws/provider 路由直入=编辑器屏渲染（矩阵行落点，对象在册）；role 路由=docsRoot 零 Role 对象=编辑器屏对象解析诚实空态（不冒充矩阵行落点）。
- L42-06 零 console error（headless 全程监听；宿主壳+插件载荷均计；dsh 既有告警=基线先采不计）。
- L42-07 回归：781 基线+E0…E5 专项全绿（零迁移）+ npm test（plugin 仓，comm 落账/读路由测试面新增）全绿 + go build/test/lint（零 Go 改动轮=全仓同代确认）全绿。

### 1.14 E7 实现拓扑与细化验收（2026-11-25，E7 轮——console 全收口）

**数据面裁决（读面复用优先，一处 Go 小增量）**：四页场景面全部走既有读面——events=归档窗投影（`/v1/events`）client 过滤 involved scope（involved 中段=scope，`systems/<name>` 前缀形兼容）；metrics=`/v1/metrics` 数据面投影（**关断口径=空投影诚实空态**——loop-43 实测 `{"metrics":[],"total":0}`，不冒充曲线）+ `/v1/metrics/query` 即席查询（404=无投影结果如实标注）；docs=`/v1/objects` scope 枚举（文档与资源同规则——inScopeObjects 同一匹配）+ 对象正文 tag 现读；permissions=Role/Group/Agent 文档面（objects 枚举 + docContent 现读——docsRoot 零 Role/Group 对象=诚实空态；Agent 挂载=声明正文 `spec.connectorOps` 现读，溯源=挂载声明行全可点）。唯一 Go 增量=`/v1/events` 增 `until` 游标（RFC3339，严格早于——向后分页读锚）；limit≤500 收敛口径不变（防拖库）。

**tag 过滤口径（一等过滤器）**：tags=对象正文 `spec.metadata.tags`（scheme.yaml conventions.tags 检索元数据声明；fallback `metadata.tags`）——客户端现读解析（纯函数 `tagsOf`；hydrate 注水，渲染层缓存 keyed 对象键+rv）。chips=当前面 base 集合实读 tag 并集；docsRoot 现状零 tag 声明=chips 空集+空态注记（不冒充）；探针激活=经 `POST /core-console/apply`（subject=admin，console 唯一写入口）真写一枚 tag——写路径即 Apply 红线不破。全局 `#/docs` 与单系统 `#/s/:name/docs` 同一 paintDocsScreen 同款过滤器（tag chips × kind × 草稿 × 搜索）。

**千级虚拟滚动（验收线「千级事件滚动流畅」）**：vlist=常量行高虚拟列表（DOM 只留视口±6 行缓冲）组件恒定不变；E7 增量=①事件窗 limit=100→500（收敛口径单窗）②`until` 游标滚动加载（近底阈值→fetch 上一页→按 eventId 去重合并→repaint；页行数<limit=已到底 exhausted 如实标注）③**合成压测窗=客户端合成展示层**（`synEvents` 确定性合成行：`syn-` 前缀 id+「合成」tag+不可点——不入归档、不入聚合面板计数），真实归档不足千级时滚动流畅验收的合规载荷（KI-001 探针无副作用：**审计账保真优先，不注入放大归档**——loop-43 裁决；POST /v1/events 注入路径保留为按需选项不做缺省）。合成窗入口=事件屏显式「压测窗」toggle（人点为准），计数注「合成展示层不入归档」。

**收口清扫（mock 渲染面归零）**：总览屏（`#/overview`）真数据换装（ServiceDesc 卡=读面枚举+相位投影、进行中运行=runs 面投影、最近事件=归档窗）；命令面板系统/workflow/文档行=读面枚举（M 静态锚摘除）；manualTick/newGoalDraft 假动作换诚实提示（写路径=Apply/新建文档=落稿经 Apply——不画假回执不推 mock 库）；设置页「全部本地 mock」声明摘除。console-data.js mock 数据文件保留（proto 内嵌起点代码；渲染引用归零后=死数据，摘除裁决→下轮标准对账）。

**E7 细化验收线（§4 E7 行展开；探针编号 L43-\*）**：
- L43-01 场景事件面：`#/s/:name/events` 真归档行（真 DocApplied/Escalate 行在册 ∧ 零 mock 事件名）∧ 过滤条=全局同款（type chips/level/lane/range/q）∧ involved scope 过滤（系统外行不出现）∧ 行点击→`#/event/:id`。
- L43-02 场景指标面：`/v1/metrics` 空投影=诚实空态在册（「数据面未装配」字样 ∧ 零 mock 曲线/零 mock 指标名）∧ MetricThreshold 归档行区（系统过滤，行可点）。
- L43-03 场景文档面：scope 对象枚举真名 ∧ tag chips=实读并集（apply 真写 tag 激活后 chip 在册 ∧ 点选过滤命中该对象）∧ kind/草稿/搜索组合 ∧ 行点击→编辑器。
- L43-04 场景权限面：矩阵行=Agent 文档面真名（core-headless）∧ 列=ConnectorOps/Provider/Ref 真名 ∧ 命中格=挂载声明现读（agent-comm × core-headless=✓，溯源=spec.connectorOps 挂载行可点）∧ Role/Group 零对象=诚实空态注记 ∧ 标识符全可点。
- L43-05 tag 全局同款：`#/docs` 全局文档面同一 paintDocsScreen（真对象行+tag chips/kind/草稿/搜索四件套）。
- L43-06 千级虚拟滚动：合成压测窗 ≥1000 行渲染 ∧ DOM `.vrow` 行数有界（≤80——视口缓冲）∧ canvas 高度=行数×行高 ∧ 全程滚动扫掠到底完成 ∧ 零 console error；`until` 游标=Go 测试面（分页无重叠/坏参数 400）+ 活体相邻页 fetch 零重复 eventId。
- L43-07 回归：E0…E6 专项全绿 + npm test 全绿 + go build/test/lint 全绿（workservice until 增量在册）。

### 1.15 对账轮增量：WorkService 单对象读面收口（2026-11-25，loop-44 轮——标准对账选点）

**缺口根因（E6 探针实证 declared 余量的收口轮）**：WorkService storage 模板 `workservices/<name>/workservice.yaml` 无 scope 段——模板解析闸门（repository.git storagePatterns）要求展开结果落 scope 目录前缀之下，根级路径对任何四层 scope 均不可寻址 → 单对象 GET/写入面恒 400（`ErrScope` 无可寻址分支）。且 docsRoot 既有对象 `workservices/notify/` 本身 metadata.scope 声明 `notify`（非法四层段）——对象身份与声明双重漂移。

**收口方向（对账裁决：concepts/workservice.md §头表「作用域=Global」为准绳，layout.md §2「路径=scope」为物化规则——§1 旧树根级 workservices 属声明漂移）**：
1. 声明面：scheme.yaml WorkService storage → `global/workservices/<name>/workservice.yaml`（concepts/scheme.md / concepts/workservice.md / layout.md §1 / examples 同步）。
2. docsRoot 迁移：`workservices/notify/` → `global/workservices/notify/`（git mv 零残留）∧ 对象 metadata.scope `notify`→`global`（身份声明与物化位置一致）。
3. 客户端：编辑器屏/tag 现读两处 WorkService 诚实守卫摘除（单对象 GET 200 后走正常 fetch——守卫存在前提=读面缺口，缺口不在即摘除，勿留死分支）。

**L44 验收线（探针编号 L44-\*）**：
- L44-01 单对象读面：`GET /v1/objects/WorkService/notify?scope=global` → 200 ∧ content 含 `kind: WorkService` ∧ `metadata.name: notify`；跨 scope 枚举（`/v1/objects/WorkService` 无 scope 参）行集含 notify 且行 scope=global。
- L44-02 编辑器屏活体（headless）：`#/ws/notify` 直入 → 正文 textarea 有值（非诚实空态）∧ rev chip=资源版本数字 ∧ 零「读面缺口」字样。
- L44-03 docsRoot 迁移零残留：docsRoot 根级 `workservices/` 目录不存在 ∧ `global/workservices/notify/workservice.yaml` 在册 ∧ cored 读面（objects 枚举）与新位置一致。
- L44-04 tag 现读守卫摘除：`#/docs` 面对 WorkService 行走正常 fetch（无 WorkService 特判分支——源代码 grep 判别）；notify 无 tags 声明=空集诚实标注（不冒充）。
- L44-05 回归：npm test 全绿 + go build/test/lint 全绿 + loop-43 探针基线（probe-e7/e7-ui-verify 路径替换版）全绿（E6R-UI-28 `#/ws/notify` 直入判据升级=正文在册）。

### 1.16 对账轮增量：metrics 数据面装配开启 + 阈值声明面最小样本源（2026-11-25，loop-45 轮——标准对账选点）

**缺口根因（R-2，loop-44 缺口清单首选候选）**：v0.33 MetricsInfo 数据面三件套（样本库/自观测采样器/读面）代码在位，但**装配旗标 `--metrics-source` 未在任何部署 profile 开启**——运行时数据面恒关断，`/v1/metrics` 恒空投影（200 `{metrics:[],total:0}`）、`/v1/metrics/query` 恒 404（关断口径）；且文档库零 WorkService 对象声明 `observation.metrics.thresholds`——即使开旗标阈值桥也恒 no-source（绑定面缺口）。附带两处对账缺口：①`metricsrc` 源绑定 involved 投影为两段式 `WorkService/<name>`——违反 involvedRef `kind/scope/name` 三段惯例（event.md 规则 11 首段同构口径），owner/scope 谓词与 console 事件详情 involved 对象链（`involvedRoute` 三段判别，两段=回落 welcome 死链）均不可解析；②采样器窗口计数为闭区间双端（`t.Before(since)` 才跳过）——相邻窗口在端点瞬刻重叠一行，与 E7 半开窗纪律（相邻页零重叠）不同口径。

**收口方向（装配段增量：开旗标+最小声明面+三段同构修正+窗口口径对齐）**：
1. 装配：三 profile 部署锚 `coredArgs` 增 `--metrics-source`（窗口缺省 30s 不另声明）；carrier profile 同款锚改配置面、进程换代随载体重启轮（不在本轮重启面——自噬会话，沿 loop-44 deviation ①口径）。
2. 声明面：docsRoot `global/workservices/notify` 增 `observation.metrics` 最小样本源声明（`events.DocApplied` gte 1——桥点火演示口径：首拍全量对账必越限，dedupKey=`<metric>:<window>` 同窗聚合防风暴）。
3. 代码（workservice）：源绑定收编 `metricsrc.BindWorkservice` 纯函数（阈值解析+involved 三段同构 `WorkService/<scope>/<name>`——零阈值/空 scope=零绑定缺口可见）；采样器窗口改半开 `(since, now]`（与 E7 纪律对齐，相邻窗零重叠）。
4. 文档对账：event.md 规则 13 与 cored-bridge.md 的 involved 措辞升三段；cored-bridge.md v0.31 行尾 stale 余量注记（被 v0.33 取代）修正——终态制防误读。

**L45 验收线（探针编号 L45-\*；探针=acceptance/loop-45.md）**：
- L45-01 装配开启：两 web profile cored 进程 cmdline 含 `--metrics-source`（查询代替日志：/proc cmdline）∧ journal 装配锚 `metrics 数据面=on(30s)` ∧ `metrics 阈值源=on(1)`。
- L45-02 数据面读面：`GET /v1/metrics` → 200 ∧ `total`≥1 ∧ 行集含 `events.DocApplied` 且样本数>0（首拍全量对账=ops DB 既有归档行投影）；`/v1/metrics/query?metric=events.DocApplied&agg=count` → 200 ∧ value>0；声明面外聚合（agg=median）→ 404 不冒充。
- L45-03 信号面点火：`GET /v1/events?type=MetricThreshold` → count≥1 ∧ 行 `source=metrics` ∧ `involved=WorkService/global/notify`（三段同构）∧ `dedupKey=events.DocApplied:30s`。
- L45-04 run 同拍落点：`/v1/workflows/runs` 行集含 `eventId` 命中 L45-03 事件 id 的 run（owner 对账锚 core-workflow）；console 事件详情 involved 链 `involvedRoute` 三段可点（`doc/WorkService/global/notify`——两段死链不回归）。
- L45-05 窗口半开对齐：EventCountsSince 单测——相邻窗端点零重叠（半开 `(since, now]`）∧ 首拍全量口径不变。
- L45-06 回归：go build/test/lint 六仓绿 + npm test 绿 + loop-44 探针基线（probe-e44/e44-ui-verify 路径替换版）全绿；`/v1/objects/WorkService/notify?scope=global` 200（L44-01 不回退，正文含 observation 声明）。
- L45-07 判据升级（数据面装配的随行件，模式同 loop-44 E6R-UI-28）：**L43-02a「指标面空投影诚实空态」升级为「指标面真实样本表」**（数据面装配开启→events.\* 行在册=装配开启的反证判据；旧空态退场）；**metrics 屏即席查询改跨窗口全量**（Query 面声明语义：窗口标签=采样器部署知识客户端不复制——window=1h 硬编码在数据面装配后 404 化且 4xx 记 console error 违零 error 硬线，E6R-UI-30/31 实证）。

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

### 1.17 对账轮增量：approval_log 审批判定独立账（2026-11-25，loop-46 轮——标准对账选点）

**缺口根因（R-3，loop-45 缺口清单首选候选，E6 declared 余量）**：console 审批屏的批准/驳回判定留痕现投影=apply_log 行（fieldManager=console:approve）+DocApplied 归档——但①**驳回=DELETE 弃稿零留痕**（草稿缓存非账，弃稿动作在 ops DB 无行：审计问"这条提案谁何时驳了"答不出来）；②批准判定与普通 apply 落库在账面不可判别（要靠 field_manager 字符串考古）；③ops-log.md §2 v0.9 声明的 approval_log 独立账至今零表零读面（v1 最小实现只建了 apply/event 两表）。

**收口方向（账面+读面+UI 现读，零旁路零新写路径）**：
1. opslog（workservice v0.46）：approval_log 建表+`AppendApproval`/`QueryApprovals`（decision/obj 精确过滤+rv 降序+limit 收敛防拖库同口径）；schema 修订=ts/approval_id/obj/decision/judged_by/field_manager/resource_version/reason_ref（v0.9 permission_rule 列并入 field_manager/reason_ref——A44 权限系统落地后随行具体化；细则见 ops-log.md §2 v0.46 注记）。
2. apiserver 写钩子两段（账面非权威：落账失败不翻转写路径结果）：POST /v1/apply（fromDraft ∧ 非 dry-run ∧ fieldManager=console:approve 成功）→ granted 行（rv=落库后 rv；noop 幂等重入照落，rv=面上现值）；DELETE /v1/drafts 成功 → rejected 行（rv=0，judged_by=请求主体头）。引擎侧落稿清除（fromDraft apply 后清稿）不经 HTTP DELETE handler，无双计。
3. 读面：`GET /v1/approvals`（decision/obj 过滤+rv 降序+limit；face 缺席=503 同口径；旧代=405 兜底代际判别器）。
4. console：审批屏增「已决账面」区块（`GET /v1/approvals` 现读不缓存——批准/驳回即决即见；渲染失败=诚实降级注记，零 console error 零 4xx）。

**L46 验收线（探针编号 L46-\*；探针=acceptance/loop-46.md）**：
- L46-01 建表面：ops DB approval_log 表在册（sqlite_master 机械查询）∧ 新代 `GET /v1/approvals` 200（carrier-pre 旧代 405=代际判别器）。
- L46-02 批准落账：console:approve fromDraft apply 成功 → approval_log granted 行（obj/approval_id=draft:\<键\>/judged_by=主体/rv=落库 rv）∧ apply_log ok 行同拍在册（双账并存）。
- L46-03 驳回落账：DELETE 弃稿成功 → rejected 行（rv=0）∧ 文档面零变化（弃稿零文档面动作不回归）∧ 弃稿后读面无稿。
- L46-04 读面投影：GET /v1/approvals rv 降序+decision/obj 过滤+limit 收敛+face 缺席 503+decision 非闭合集拒（单测）。
- L46-05 UI：审批屏「已决账面」区块行集=真实账面数据（granted/rejected 行在册可见）；零 console error 零 4xx。
- L46-06 回归：go build/test/lint 绿+npm test 绿+loop-45 基线探针（路径替换版）全绿（数据面真实样本表判据不回退）。
- L46-07 账面零耦合：Reconcile 不变量不受 approval_log 影响（apply_log(ok) ≙ DocApplied 单测断言）。

### 1.18 对账轮增量：metrics 阈值声明面 apply 事件驱动热重绑（2026-11-26，loop-47 轮——标准对账选点）

**缺口根因（R-4，loop-46 缺口清单首选候选，R-2 装配段余量）**：阈值声明面绑定是**装配期一次枚举**（main.go 启动时 `repo.List(WorkService)` 逐对象 `BindWorkservice` → 桥源集合固定进程生命周期）——console 对 WorkService 对象 `observation.metrics` 的编辑 apply 落库后**不生效，需重启才重绑**。三重不一致：①与 workflow 文档查找「零缓存：每次现读（git 后端权威，apply 落库即生效）」同库不同待遇；②与权限热装载（v0.10 免重启，repository.Watch 变更信号→重投影→快照整体替换）同类场景分立两套语义；③apply.md rule 1「落库即生效（DocApplied 必发）」对阈值声明面失效——声明面写路径的回执语义与实际生效面劈叉。

**收口方向（绑定表与样本流解耦——重绑 O(1) 零通道抖动）**：
1. 桥契约重构（workservice v0.47，`metricsrc` 内部包）：**样本流从每源一通道升为桥级单通道**（装配层一条 `metricsStore.Subscribe()` 经泵适配直投——per-source 通道形态下重绑=通道级联重建（订阅泄漏/泵 goroutine 阻塞弃Channel），单流+绑定表=重绑只换声明不碰流）；`Source` 契约=纯绑定声明 `{name, involved, thresholds}`（`Samples` 字段退场）；事件产出语义面零变化（同判定谓词/同 dedupKey/同 involved 三段同构/同主干零旁路——多绑定同键越限由总线窗口聚合，与原多源各自发布同态）。
2. `Bridge.Rebind(srcs)`：绑定表整体替换（锁内快照换装——样本流不动）；**零绑定=合法等待态**（装配期零声明不再是不启动的终态——`no-source` 状态退场为 `on(0)`，桥挂流等待 apply 热激活）。
3. `metricsrc.StartRebind`：apply 事件驱动热重绑主循环——订阅 `DocApplied`（与 apply 落库同一条总线主干零旁路）→ involved kind=WorkService 精确过滤（非 WorkService 对象 apply 零无效重枚举）→ 连续变更合并（积压排干后一次重枚举装到最新面）→ 枚举失败=保旧表+stderr 告警+下次 apply 重试自愈（权限热装载同款 declared 语义，不半装载）。
4. stderr 装配锚词表：`metrics 阈值源=off|unregistered|on(n)`（`no-source` 退场——零绑定成为瞬态等待态 `on(0)`，apply 后热激活升 `on(n)`）。

**L47 验收线（探针编号 L47-\*；探针=acceptance/loop-47.md）**：
- L47-01 热激活面（核心判据）：新代 cored 装配后对既有 WorkService 对象 apply 增补 `observation.metrics` 阈值（不经重启）→ 下一个采样窗内 `GET /v1/events?type=MetricThreshold` 出现**新 dedupKey**（`<新metric>:<window>`——旧绑定从未声明的键=热重绑激活的机械判别器）∧ `source=metrics` ∧ involved 三段同构 `WorkService/global/<对象名>`。
- L47-02 免重启对照：事件 `at` 晚于 apply 时刻 ∧ cored 进程 exe sha 在 apply 前后不变（`/proc/<pid>/exe` 双读一致——进程未换代，判定面变化纯事件驱动）。
- L47-03 run 同拍不回归：新 MetricThreshold 事件落 run 同拍（`/v1/workflows/runs` 含 `eventId` 命中行——workflow.md 规则 15 零改动）。
- L47-04 单测：Rebind 换表即时生效（旧阈值→新阈值判定切换）+ 零绑定等待态（挂流零事件→Rebind→越限即发）+ DocApplied×WorkService 过滤（非 WorkService involved 不触发重枚举）+ 枚举失败保旧表（Failed 回调+旧表继续判定）。
- L47-05 UI：指标面真实样本表出现新 metric 行（`events.<新type>` 在册——数据面照常产样本）；事件流屏 MetricThreshold 行在册且详情 involved 链三段可点（L45-04 不回归）。
- L47-06 回归：go build/test/lint 绿+npm test 绿+loop-46 基线探针（路径替换版）全绿（approval_log 双账/已决账面判据不回退）。
- L47-07 复原：探针声明面残留 apply 原文清场（docsRoot 权威=git，rv 乐观锁复原——探针零残留）。

### 1.19 对账轮增量：docsRoot 存量对象净入 lint 面（2026-11-26，loop-48 轮——标准对账选点）

**缺口根因（R-5，loop-47 缺口清单首选候选=deviations ③ 独立发现）**：spec 准入 checker（workservice `scheme.ValidateDoc`，core_design scheme.md 规则 6「R-TYPE 有规则即有 checker」）**应用点单一=apply 引擎准入第三步——只挡写入口**。docsRoot 存量对象零校验放行：读面 `globObjects` 对不可解析文档静默跳过（存量坏对象在 List 读面不可见）；存量形态违规对象（loop-47 实证 notify `connector.scheme.params` 字符串形态）读面放行、一编辑即 400 且按原文无法复原——「读面宽松/写面严格」双严格度不一致=存量面准入缺口。伴生缺口（loop-46 缺口 ③ 的同步 lint 选项）：docsRoot `core/scheme.yaml` 与声明权威 core_design `core/scheme.yaml` 双源系（cored `--scheme` 载入 core_design 仓，docsRoot 副本=消费方镜像）——镜像漂移零检出。

**收口方向（净入 lint 面：给 checker 补存量面应用点，零新写路径零旁路）**：
1. workservice v0.48（`internal/repository.LintGitDocs` + `cmd/cored-lint` 薄壳，lint 纯只读：零 ops DB 零 HTTP 零写面）：docsRoot 全 `*.yaml`/`*.yml` 文件系统通配（不经 List 读面——静默丢弃面正是被补的缺口），逐文件五闸与写路径同清单：①路径注册=storage 模板通配命中恰一 kind（零命中=野对象；多命中=歧义）②可解析（splitDoc+metaOf——读面静默丢弃面补检出）③身份一致（metadata.name/scope vs 文件名与路径派生 scope；nameSeg 命名规则=写面 concretePath 同闸）④spec 准入（`scheme.ValidateDoc`=apply 引擎准入第三步同闸门）⑤凭据来源形态（checkCredentialSource=Provider 写面同闸）；外加 scheme 镜像漂移闸（docsRoot `core/scheme.yaml` vs `--scheme` 载入源字节比对）。输出逐文件 OK/VIOLATION 行+计数（`--json` 机读）；退出码 0=绿 / 1=违规 / 2=用法错。
2. core_design `lint/docsroot-admission.sh` wrapper（R-TYPE-2 双向可追溯：checker 头注释回指 scheme.md 规则 6；规则 6 checker 条目回指本 checker）。
3. core-docs 内容轮：lint 对现存 docsRoot 全绿（notify params 已随 loop-47 随行规范化；本轮 lint 检出新违规→core-docs 规范化 commit）。

**L48 验收线（探针编号 L48-*；探针=acceptance/loop-48.md）**：
- L48-01 checker 落地活体：cored-lint 对生产 docsRoot 退出码 0 ∧ 逐文件 OK 行在册 ∧ files 计数与 docsRoot `*.yaml` 文件数机械一致（查询代替日志）。
- L48-02 检出力单测（「无 checker 的 lint 规则=未生效」收口的可证伪面）：五闸逐类坏对象 fixture（野路径/不可解析/scope 漂移/spec 形态违规/凭据内嵌）逐类检出 ∧ 合规对象零误报 ∧ 违规时退出码 1。
- L48-03 双闸门判定一致：临时副本 docsRoot 注入 params 字符串形态坏对象 → lint 检出 spec 违规 ∧ 同对象经 cored `POST /v1/apply dryRun`（零副作用预检）被写面拒（双严格度劈叉收口的机械反证面）。
- L48-04 scheme 镜像漂移闸：生产 docsRoot 镜像与载入源字节一致=绿；漂移 fixture（单测/临时副本改一字节）=检出。
- L48-05 回归：go build/test/lint 六仓绿 + npm test 绿 + loop-47 基线探针（路径替换版）全绿（热重绑/审批账面/指标真实样本表判据不回退）+ L42-02f face fetch 段。
- L48-06 零残留：lint 纯只读——docsRoot git 状态探针前后零变化（core-docs commit 仅内容轮规范化，非探针残留）。

### 1.20 对账轮增量：Role/Group 文档面对象 + 权限矩阵 Role 列激活（2026-11-24，loop-49 轮——标准对账选点）

**缺口根因（R-6，loop-46 缺口 ② 顺延）**：docsRoot 零 Role/Group 对象——授权面装载快照 `roles=0 groups=0`（cored-bridge.md §2 写面开关行：装载即权威快照——文档面零在册=授权面对象面空转，权限只靠 `DefaultAdmin` 字面量与进程级本地信任兜底）；console 权限面 Role/Group 卡=诚实空态注记（§1.14 L43-04「角色面=declared 余量」）；`ApprovalNeeded` 权限拒绝产源（v0.21）自实现以来 involved 引用的 Role/Group=测试 fixture 形态——生产 docsRoot 无实体可溯（事件链 `involved→文档` 末端死链）。scheme.yaml 声明面在位（Role/Group 行注册 storage `global/roles|groups/<name>.yaml`）——纯内容轮+UI 激活轮，零 Go 改动。

**收口方向**：
1. core-docs 内容轮：`global/roles/admin.yaml`（`builtinSet: [global/admin]` 声明的文档面载体——permissions 全域条目 + `on: [agent/core-headless]` 对象挂载）+ `global/groups/core-operators.yaml`（group 只绑 role，permission.md 规则 3 禁权限字段）。净入 lint 随行（files 基线 10→12）。
2. console 权限面 Role 列激活：live 层小对象现读清单扩 Role/Group（docContent 同批）；permissions 屏增「Role 授权矩阵」区块（行=Role，列=on 挂载对象/权限域条目/绑定 group 反查——spec 现读全可点溯源；零对象时保留既有诚实空态注记）。
3. 装载/热装载/ApprovalNeeded 产源/写面闸门=既有（v0.10 热装载、v0.21 产源）——本轮不触 workservice 代码，cored 恒代（deploy=plugin 层 + 文档库内容轮经 cored 启动装载生效）。

**L49 验收线（探针编号 L49-*；探针=acceptance/loop-49.md）**：
- L49-01 净入 lint 随行：cored-lint 对生产 docsRoot 退出码 0 ∧ `files=12 findings=0 mirror=ok`（files 计数与 docsRoot `*.yaml` 文件数机械一致，基线随新对象 +2）。
- L49-02 授权面活体（stderr 锚不可查询面——用判定行为证装载）：restart 装载后受限主体 `dryRun` 断言 `role/admin` 写 global 域对象 → admit 过（200，零写面）；同请求匿名主体 → 403 denied——「断言须对上文档面装载对象才产生权限」的机械证明。
- L49-03 ApprovalNeeded involved 实体化：受限主体**真写**（非 dryRun）在册 Role 对象 → 403 ∧ `/v1/triggers` 出现 `type=ApprovalNeeded ∧ source=permission` 留痕 ∧ event `involved=Role/global/admin`（docsRoot 在册实体——事件链末端可溯）∧ `/v1/notifications/deliveries` 增 `origin=route ∧ type=ApprovalNeeded` 条目 ∧ event_log `source='permission'` 行落库；反证面=同主体写非人审档 kind（Agent）→ 403 零事件。窗口去重口径：dedupKey=`permission:<obj>` 窗口内聚合——探针以「归档窗内 ≥1 行在册」判，不判增量（重复探针零新行=去重合法）。
- L49-04 console 权限面激活：permissions 屏 Role/Group 卡非空态（Role=1 Group=1 行）∧ 「Role 授权矩阵」区块 spec 现读（on 挂载→agent 链接、权限域条目 scope+actions、绑定 group 反查→role 链接全可点）∧ `#/role/admin` 编辑器路由活体（四 tab 壳+正文现读）。
- L49-05 回归：六仓 build/test/lint 绿 + npm test 绿 + loop-48 基线只读回归段（L46/L45/L43 判据不回退）+ L42-02f face fetch 段。
- L49-06 零残留：positive 探针走 dryRun（零写面）+ denied 真写零落库——docsRoot git 状态探针前后零变化（内容轮 commit 非探针残留）；ops 账面新增行仅 denied 审计行与事件归档（探针合法产物，计入账面基线）。
- L49-07 cored 恒判别：本轮 cored 零改动——exe sha 与 carrier-pre 定格一致（同代判别面；deploy=plugin dist 重载 + 两 web 重启触发文档库重装载）。

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
| E4 | 文档编辑器（草稿→Apply 全流程，dry-run 三检查）【已完成 2026-11-24：数据面=cored v0.38 `GET /v1/history` 应用史投影（apply_log 审计账——历史 tab 权威）；写面=宿主 `POST/DELETE /core-console/drafts` 草稿通道+既有 apply 通路（dry-run 三检查：admit ①scheme②权限零副作用+乐观锁=回执 rv 与稿 baseRV 客户端比对）；屏=viewer 全线升编辑器（四 tab+吸底 dock+确认弹窗）；LLM 提案=非 console 前缀稿队列（mock 对话输入摘除）；探针=acceptance/loop-39.md】 | LLM 提案→人点 Apply→Revision+1 全链路（细化=L39-01…06） |
| E5 | Agent 会话 + 运行器四选 + 终端 tab（dsh 内置 PTY 为主，gotty 跨机兜底；provider 映射=内嵌 dsh/claude-code 现成 subagent provider，opencode/gotty 自写 SubagentProvider——cross-agent.md §5.7）【拆分裁决=§1.11：**E5a 已完成 2026-11-24**——会话屏真数据换装（数据源=dsh session store §3.7 裁决）+发消息真通路（session.prompt queue/steer）+ConnectorOps 卡渲染判别器（声明集判别）+身份回填（status.currentSession=SessionId 文档面落点）+ServiceInstance→Agent 对话跳转；终端 tab=内置 PTY roster 只读+attach 余量标注；探针=acceptance/loop-40.md。**E5b 已完成 2026-11-25**——agent-comm 四 op 工具面（宿主 plugin ctx.tools.register，工具名=协议 op 名裸用；envelope v0.1 全字段校验+to 解析三步+mailbox 幂等落账，§1.12）+声明集种子（WorkService/ConnectorOps agent-comm+core-headless mount 经 apply 落库）→「收到 ConnectorOps 卡」真调用活体达（R-ENG-3 归属注记 rule.md）；探针=acceptance/loop-41.md】 | 能对 Service agent 发消息并收到 ConnectorOps 卡【E5a 细化=L40-01…08；E5b 细化=L41-01…06（真调用卡活体已达=E5 全行收口）】 |
| E6 | 事件流/审批/连接页 + 详情页矩阵互跳【已完成 2026-11-25：数据面=零 Go 改动（读面复用裁决 §1.13）——事件流=三泳道 `eventLaneOf` 映射+聚合面板实数（成功率/token=n/a 不冒充）；审批=待审区（草稿缓存∪ApprovalNeeded 归档）+diff 现读+批准=Apply 全流程复用（dry-run 三检查→fromDraft 落库，fieldManager=console:approve）+驳回=DELETE 弃稿+批量=同 kind 顺序 Apply；连接页=三组 objects 枚举+编辑器 ConnectorOps 第五 tab「运行面」（agent-comm=comm 落账活体：op 计数/拓扑/消息日志 token 打码/envelope v0.1 表）；agent-comm.ts=CommJournal 环形落账（token 值永不入账）+index.ts=`GET /core-console/comm` 读路由（fail-closed 同款）；事件详情=run 反查（eventId 命中→#/wf/:name/r/:n）+/v1/triggers/resolve 锚链——event→run→workflow→doc 链路活体走通；探针=acceptance/loop-42.md】 | event→run→workflow→doc 链路走通（细化=L42-01…07） |
| E7 | 场景面四页 + tag 过滤 + 虚拟滚动大列表【已完成 2026-11-25：数据面=读面复用+一 Go 增量（workservice v0.39 `/v1/events` until 游标——半开窗 [since,until) 向后分页，EventQuery 六参）；事件全局/场景面=screenEventsCore 共用核（过滤条同款+until 滚动加载+合成压测窗=客户端合成展示层不入归档 KI-001 裁决 §1.14）；metrics=空投影诚实空态+即席查询 404 不冒充；docs=scope 枚举+spec.metadata.tags 现读一等过滤器（rv 键缓存+WorkService 读面缺口守卫不发 400 fetch）；permissions=Role/Group/Agent 文档面+挂载声明现读溯源+挂载反查表；收口清扫=总览/palette/文档行真数据+manualTick/newGoal 诚实化（mock 渲染面归零）；探针=acceptance/loop-43.md（prep 21/21+UI 53/53+verify 21/21 含补验；千级合成窗扫掠到底 1665ms/DOM 22 行有界/零 console error/零 4xx）】 | 千级事件滚动流畅（细化=L43-01…07） |
| 对账轮 R-1 | WorkService 单对象读面收口【已完成 2026-11-25（loop-44，§1.15）：storage 模板归 global 桶（声明面 scheme.yaml/concepts/layout.md 四处同步）+docsRoot 迁移（根级 workservices→global/workservices+对象 scope 声明修正）+plugin 两处诚实守卫摘除；探针=acceptance/loop-44.md（prep 27/27+UI 53/53+verify 28/28；旧代双口径 400→新代 scope=global 200 实证）】 | 单对象 GET 可寻址+守卫摘除+迁移零残留（细化=L44-01…05） |
| 对账轮 R-2 | metrics 数据面装配开启 + 阈值声明面最小样本源【已完成 2026-11-25（loop-45，§1.16）：三 profile 锚 `--metrics-source` 装配开启（carrier 随载体重启轮换代）+docsRoot notify 对象 observation.metrics 最小声明（桥点火演示口径）+metricsrc.BindWorkservice involved 三段同构（kind/scope/name 惯例——console 事件链两段死链修正）+采样器窗口半开对齐 E7 纪律；cored-bridge v0.31 stale 余量注记修正；探针=acceptance/loop-45.md】 | `/v1/metrics` 真实样本+MetricThreshold 落 run 三段 involved 可导航（细化=L45-01…07） |
| 对账轮 R-3 | approval_log 审批判定独立账【实现拓扑与细化验收=§1.17（loop-46）：opslog approval_log 表+读写面（schema v0.46 修订——v0.9 A44 声明收编落地）+apiserver 两写钩子（批准 granted/驳回 rejected——驳回零留痕缺口收口）+`GET /v1/approvals` 读面+console 审批屏「已决账面」现读区块】 | 批准/驳回判定独立账面可查（细化=L46-01…07） |
| 对账轮 R-4 | metrics 阈值声明面 apply 事件驱动热重绑【实现拓扑与细化验收=§1.18（loop-47）：桥契约重构（样本流桥级单通道+Source=纯绑定声明——重绑 O(1) 零通道抖动）+`Bridge.Rebind` 绑定表整体替换（零绑定=合法等待态，no-source 终态退场）+`StartRebind`（DocApplied×WorkService 过滤+积压合并+失败保旧表自愈）】 | 阈值声明 apply 落库即生效免重启（细化=L47-01…07） |
| 对账轮 R-5 | docsRoot 存量对象净入 lint 面【实现拓扑与细化验收=§1.19（loop-48）：checker 存量面应用点=workservice `cmd/cored-lint`（五闸=路径注册/可解析/身份一致/spec 准入/凭据来源，写路径同清单）+scheme 镜像漂移闸（双源系对账收口）+core_design lint/docsroot-admission.sh wrapper（R-TYPE-2 双向可追溯）】 | 存量坏对象可检出且与写面判定一致（细化=L48-01…06） |
| 对账轮 R-6 | Role/Group 文档面对象 + 权限矩阵 Role 列激活【实现拓扑与细化验收=§1.20（loop-49）：core-docs 内容轮（global/roles/admin + global/groups/core-operators——声明面在位的纯数据轮）+console live 小对象现读扩 Role/Group+permissions 屏「Role 授权矩阵」spec 现读区块；零 Go 改动=装载/热装载/ApprovalNeeded 产源皆既有】 | docsRoot Role/Group 对象净入授权面+involved 实体化+UI 矩阵激活（细化=L49-01…07） |

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
