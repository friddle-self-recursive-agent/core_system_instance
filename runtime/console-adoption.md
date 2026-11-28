# 运行时设计 3.6：console v2 落地盘点与逐页建议（adoption）

> 对线上已部署 console（dsh web 裸壳 + dsh-plugin-core-system）的实测盘点（2026-11-23）与逐页功能/UI 建议。设计定稿见 [console-ui.md](../acceptance/console/console-ui.md)「运行时设计 3.5」（v2 十屏 + Welcome 大屏 + 详情页矩阵 + 懒加载），本文回答三件事：**现状是什么、每页差在哪、按什么顺序落地**。执行体=core-agent 自循环（loop），一轮一个可验收增量。

## 0. 结论

1. 现状 = dsh web 官方壳（会话/插件/自动化任务三页）+ core plugin **已启用但零界面贡献**——console v2 的全部屏幕都是 plugin 经 Slots 新增的贡献，不修改 dsh 本体。
2. dsh 客户端已内置与 console v2 高度同构的模块（§2 清单）：**不重复造**，复用其交互模式与部分组件，core 概念（Service/Instance/Workflow/文档面/ConnectorOps）作为新数据源接入。
3. 两个环境阻塞（§1）不修则任何页面都活不长：trusted-host 缺域名（已修）与长连接代理超时（待修）。另有 token 随重启轮换的 UX 缺口。
4. **主界面方向更新（2026-11-26，console-ui §14）**：首屏=关注报告×对话，对象详情=通用工作台；E0–E7 已落地的屏面保留为钻取面与数据口径，下一增量按 §14 的判据集落地（不再新增 CRUD 型首屏）。

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

**E5 拆分裁决（E5a/E5b，一轮一增量纪律）**：E5 含两条独立数据面——①会话面=dsh session store（client 侧 ctx.sessions/ctx.remote/ctx.webTerminals）；②agent-comm 运行面=宿主四 op 工具（envelope v0.1，§5.3 挂载面）。同轮落地违反一轮一增量体量纪律（§6 风险行同款处置）：**E5a=会话屏真数据换装+发消息真通路+ConnectorOps 卡渲染判别器（本轮）；E5b=agent-comm 四 op 工具面入 plugin 宿主（R-ENG-3：通用能力默认 common_connector，确需独立仓先 core_design rule/rule_eng.md 注册——工具宿主=core plugin 本体，落 plugin 仓）+agent 声明集种子（global/connector-ops/agent-comm 对象+Agent.mount），使「收到 ConnectorOps 卡」活体达**。E5b 完成前，卡片活体=判别器单测+真会话工具卡渲染，ConnectorOps 卡活体如实标注 unverified（不冒充）。

**数据通路（E5a）**：浏览器 client cordis ctx——`ctx.inject(['sessions','remote'])` 软出现（缺席宿主回调不启动，chat 屏 `ready()=false` 诚实降级）；`ctx.sessions.list/create/using`（清单快照/新建/**prompt 真通路**——beginSubmission+prompt(mode=queue|steer, requestId)，cross-agent.md §5.7 #2 机械落点）；`ctx.remote.session.page`（转录事件页读面：user/message、assistant/message、tool/call+tool/result 按 callId 配对；context 注入行不上对话面只入轨迹）；`ctx.webTerminals.watch`（内置 PTY roster 真数据，§5.7 #6 主案）。**身份=SessionId 的文档面落点**：console 新建会话成功 → 既有 apply 通路（fieldManager=`console:chat-backfill`，rv 乐观锁）回填 Agent `status.currentSession={id,startedAt,docsLoaded}`（§5.7 #1；已有 status 块=结构化合并 E5b 余量诚实跳过不盲写）。归属过滤（§3.7 会话组织裁决）三层证据：①文档面 status.currentSession.id ②console 发起（内存 UI 态，零持久状态）③agentRefs 显式 `session://<id>` 形；其余行入「宿主全部会话」组不冒充归属。渲染数据双权威面（红线 2 细化）：文档面/资源状态=cored 读面；会话运行态=dsh session store（§3.7 显式裁决）——两权威各管一面无双源。

**E5a 屏面换装范围**：`#/chat/:agent` 全屏（左栏=会话清单归属两层+owner 反查；中栏=转录渲染[chat/trajectory 双视图]+输入条[queue/steer 模式开关]+**运行器四选 modal**（内嵌 dsh 可用；claude-code/opencode/gotty=在册禁用+why 诚实余量标注）；右栏=权限面 Agent 文档面真数据（connectorOps 挂载 refs/Provider/Ref/Role/autoLevel/op 声明集——mock token 字样摘除））；`#/session/:id` 真数据（session 事件页轨迹+归属反查）；ServiceInstance 详情页真数据（实例条目=ServiceDesc 正文现读、agentRefs chips 全可点、「在对话框调用该 Agent」跳转 `#/chat/:agent`=任务原文 #3 跳转链；conditions/metrics=引擎回写面，对象缺席=诚实空态）；`#/agent/:name` 保持编辑器屏（E4 文档与资源同规则——sessions 列表落 `#/chat/:agent` 左栏，同源不复制）。假动作摘除：pin/archive 按钮（session store 无客户端面）、仿 gotty 终端、personaReply 假流式回复。**ConnectorOps 卡判别器**：转录工具调用 op 名 ∈ agent 文档面声明集（spec.connectorOps[].ops × ConnectorOps 对象 spec.ops 并集）→ ConnectorOps 卡（op 名等宽+payload/result 展开+凭据值打码）；声明缺席=普通工具卡（不冒充协议挂载）。

**E5a 实现补注（2026-11-24，探针活体实测沉淀）**：①cordis 客户端服务护栏=**回调式 `ctx.inject(['sessions'],…)` 软出现**（声明式 `exports.inject` 加 `sessions/remote` 名会让 cordis apply 停等=整面板缺席——E5 探针字节级二分实证：E4 字节活/E5 任意重建停等；`remote.session` 命名空间未声明即访问抛 without inject）——faces 一律回调注入，缺席宿主回调不启动=chat 屏 ready()=false 诚实降级。②转录活体源=**sessions.retain 持有的 `binding.eventSource` 事件窗**（retain 自带初始历史开窗+订阅即活体；热路径[create→prompt→回复]全链实证；**冷会话空窗=declared 余量**——console 面板上下文冷 retain 事件窗不回放全史，native 会话视图承载全史，console 深链历史=同源余量；loadOlder 显式补拉已接仍空窗，如实标注）。③对话/终端切换**恒在册**（proto 原型=仅终端态显示切换，chat 视图不可达终端 tab=可达性破缺，探针修正）。④身份回填：首回填（无 status 块）=rv 前进落库实证；已有 status 块=结构化合并（E5b 收口 §1.35；L64 缩进自适应=混合缩进容忍+缺席窗收窄 §1.37）。⑤探针入口 locator 须知：面板入口 title 随 pin 态改写（`core console` ↔ `Unpin core console from sidebar`），活体断言用 `[title*="core console" i]` 子串匹配。


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

**归属裁决（R-ENG-3 核查，2026-11-25 注记 core_design rule/rule_eng.md）**：agent-comm 四 op 工具=core plugin 对 dsh 宿主工具面的贡献（`ctx.tools.register`），**不是 connector 驱动**——四 op 是宿主内进程级通道，不绑部署用法、无独立通信栈（§5.3「无独立通信栈」的机械落点）；工具宿主=plugin 仓本体，不入 common_connector、不建新仓。

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

### 1.21 对账轮增量：workflow 执行模型绑定面——execution 判别器 + apply 即实现骨架物化（2026-11-26，loop-50 轮——标准对账选点 R-7）

**缺口根因（R-7，loop-49 缺口清单首选，人裁决 core_design@4375031+instance@05d3bb0 §11）**：workflow 执行模型声明面已落（Workflow `spec.connector: ?ref`、concepts/workflow.md §1.3、connector.md 规则 6）——实现面零落点：①workflow 对象 apply 后无任何绑定面动作（同名 ConnectorOps 缺席，docsRoot 六 ConnectorOps 与 workflow 锚零关联）；②决策面无 `execution` 投影（`/v1/workflows` 聚合行无绑定状态——绑定缺口不可见，违反 connector.md 规则 6「缺口不静默」）；③console workflows 屏无执行绑定呈现。

**收口方向（机械面/agent 面二分——workflow-runtime.md §11.1 落地形态）**：
1. workservice v0.49（`internal/flowbind` 新包）：**绑定物化器**——①`Resolve`（生效对象 spec.connector 归一化/缺省同名 + 生效相位 → flow.nodes 节点骨架投影：name/title/unit（声明缺省 session）/op/connector/provider）②`Skeleton`（确定性 ConnectorOps 对象内容：workservice=workflow-engine + workflow=<锚名> + ops=[flow] + flow.nodes + labels[core/origin]=workflow-bind）③`Materializer`（装配期存量枚举初值 + DocApplied×Workflow 订阅热路径——metrics 阈值桥 v0.47 同款范式；物化走 apply.Engine 同一三步闸门 fieldManager=workflow:bind；幂等=canonical 比对 noop 零提交；spec 变更→rv+1 diff 可查；**所有面**：只写 origin=workflow-bind 标注对象，人/agent 实现零盲写；失败=保旧面+stderr 告警不打死写路径）。
2. 聚合面 execution 投影（`/v1/workflows` 行集增 `execution` 键）：`{state: bound|unbound, connector, connectorScope, skeleton}`——绑定解析=生效对象 spec.connector 覆写/缺省同名；对象缺席=unbound（缺口可见）；origin=workflow-bind=skeleton=true（实现代码未落）。
3. 声明面随行（core_design scheme.yaml + docsRoot 镜像同步）：ConnectorOps spec 增 `flow: "?{nodes: []{name, title: ?, unit: session|agent, op: ?, connector: ?, provider: ?}}"`（R-TYPE 有规则即有 checker——checker 同闸吃下）+ docsRoot `global/workservices/workflow-engine/`（flow ConnectorOps 宿主 WorkService，impl ref=workservice 仓 workflow 包=骨架执行面）。
4. console：workflows 列表「执行」列 + wf 详情头 execution chip（bound→ConnectorOps 编辑器深链；unbound→warn chip 缺口提示；skeleton→mute chip）——决策面 execution=unbound 可见的 UI 落点。

**L50 验收线（探针编号 L50-\*；探针=acceptance/loop-50.md）**：
- L50-01 apply 即实现（核心判据）：apply 探针 workflow（global/flow-probe）→ 同名 ConnectorOps 出现（`GET /v1/objects/ConnectorOps/flow-probe?scope=global` 200 ∧ spec.flow.nodes=生效相位投影 ∧ labels[core/origin]=workflow-bind ∧ spec.workservice=workflow-engine）∧ 聚合面该锚 `execution.state=bound`。
- L50-02 改 spec 再 apply → 实现更新：spec 增一相位再 apply → ConnectorOps rv+1 ∧ flow.nodes 计数+1 ∧ `/v1/history/ConnectorOps/flow-probe?scope=global` apply_log 行在册（diff 可查）∧ 幂等重入（同内容三 apply）→ noop 零 rv 前进。
- L50-03 未绑定缺口可见：builtin 注册表锚（core-workflow——无文档对象无物化）聚合行 `execution.state=unbound` ∧ console workflows 屏 warn chip（headless）——决策面 unbound 可见（缺口不静默）。
- L50-04 所有面：人写 ConnectorOps（先于物化落对象，origin≠workflow-bind）→ 对应 workflow apply → 该对象零盲写（rv 不动、内容零变化）∧ 聚合行 state=bound ∧ skeleton=false。
- L50-05 存量枚举初值：新 cored 装配启动 → dev-delivery（override 生效锚）同名 ConnectorOps 骨架物化在册（systems/self-recursive-core/connector-ops/）∧ 聚合行 bound——apply 事件缺席的存量文档同达绑定面。
- L50-06 载荷代际：新代 `/v1/workflows` 行含 `execution` 键 ∧ carrier-pre 旧代载荷无该键（代际判别器）；stderr 装配锚 `workflow 绑定=on(n)` 在册。
- L50-07 console 决策面（headless）：workflows 屏「执行」列 chips（bound 可点→ConnectorOps 编辑器屏渲染 flow 骨架）∧ wf 详情头 chip ∧ 零 console error 零 4xx；截图 ≥2 张（acceptance/shots/loop-50-*.png）。
- L50-08 回归：六仓 go build/test/lint 绿 + npm test 绿 + loop-49 基线判据只读段（L49-02 dryRun 三面/L49-03 involved 实体化/L43-02aR 真实样本表/L46 已决账面）不回退 + L42-02f face fetch 段 + cored-lint `files=14 findings=0 mirror=ok`（12→+workflow-engine+dev-delivery 骨架）。
- L50-09 零残留：探针对象（flow-probe 两件）git rm 清场 → 聚合面行消失 ∧ docsRoot git 状态=内容轮 commit 非探针残留 ∧ ops 账面新增行仅探针 apply 审计行（合法产物）。

### 1.22 对账轮增量：apply-workflow agent 派单面——骨架物化即派单受理投影（2026-11-26，loop-51 轮——标准对账选点 R-8）

**缺口根因（R-8，loop-50 缺口清单首选）**：§11.1 落地形态二分已落（骨架+节点接线=cored 机械面收口）而**两步之间的接口面零落点**——骨架物化（=「该版本实现未落」的机械签名）后无任何 apply-workflow agent 派单动作（§8 拉起形态：dsh 会话挂载/触发接线/AUTOLEVEL 三者对账余量）；workflow-runtime.md §11.1 步 2「实现代码=apply-workflow agent 面」declared-deferred 前无接口，骨架→agent 的交棒不可见不可查。

**收口方向（拉起形态首段——workflow-runtime.md §11.2）**：
1. workservice v0.50（flowbind `dispatch.go`）：**派单受理投影**——物化器一次真实物化动作（`created|updated`）即记一条对 `apply-workflow` 锚（builtin 专用 agent，§8）的派单受理（`DispatchLog` 环=workflow.WakeLog 同构；`noop`/`skipped` 不派单——无新实现可做零噪音）；`autoLevel: ask` 数据面在册（§8 默认；批准/拉起动作面随真实拉起段落地）；sink 装配层注入（nil=静默——headless 载体零影响）。
2. 聚合面读口（`GET /v1/agents/dispatches`，恒开）：`{count, accepted, dropped, dispatches:[{seq, agent, status, autoLevel, action, workflow, scope, connector, rv, eventId, at}]}`——rv=骨架落库后版本（实现侧 diff 基线）、eventId=DocApplied 回执（来源链可回指）；face 缺席=503；旧构建 405=代际判别器。
3. console：wf 详情配置 tab 骨架态（execution.skeleton=true）增「派单（apply-workflow）」行——受理投影现读（×n 计数+最近 action/rv/autoLevel；进程内环重启归零=缺席如实标注，实现未落持久态=execution.skeleton 兜底）。
4. 诚实边界（声明面随行）：**派单受理 ≠ agent 会话已拉起**（wake 面同构）——真实拉起=dsh 会话挂载/agent-session 域 deferred；观测面非账本（持久态=骨架对象+apply_log 审计）。

**L51 验收线（探针编号 L51-\*；探针=acceptance/loop-51.md）**：
- L51-01 骨架物化即派单（核心判据）：apply 探针 workflow（global/flow-probe）→ `GET /v1/agents/dispatches` 出现该锚受理行（`agent=apply-workflow ∧ status=accepted ∧ autoLevel=ask ∧ action=created ∧ connector=flow-probe ∧ rv=骨架落库 rv ∧ eventId=DocApplied 回执同源`）。
- L51-02 实现更新再派单：spec 增相位再 apply → 第二条受理行（`action=updated ∧ rv=2`）∧ 骨架 rv 同步（两投影同源）。
- L51-03 幂等不派单：同内容重 apply（noop）→ 受理计数不前进（无新实现可做——零噪音）。
- L51-04 所有面不派单：人写 ConnectorOps（origin≠workflow-bind）→ 对应 workflow apply → 物化器 skipped → 受理计数不前进（零盲写语义随行）。
- L51-05 元数据变更有别于骨架变更：workflow metadata.tags apply（spec 相位零变化）→ 骨架 noop → 零新派单（派单只随节点接线变化——spec 变更≠骨架变更的判别面）。
- L51-06 载荷代际：新代 `/v1/agents/dispatches`=200 ∧ carrier-pre 旧代同端点 405（代际判别器）；stderr 装配锚 `workflow 派单=on` 在册（判据走 /proc cmdline+exe sha+HTTP 三重机械面）。
- L51-07 console 决策面（headless）：wf 详情配置 tab 派单行现读（`apply-workflow ×n` chip ∧ autoLevel=ask ∧ 受理≠拉起注记）∧ 零 console error；截图 ≥1 张（acceptance/shots/loop-51-*.png）。
- L51-08 回归：六仓 go build/test/lint 绿 + npm test 绿 + loop-50 基线判据只读段（L50-01…05 execution 投影/L49-02 dryRun 三面/L43-02aR 真实样本表/L46 已决账面）不回退 + L42-02f face fetch 段 + cored-lint `files=14 findings=0 mirror=ok`（本轮零 docsRoot 对象新增——基线不动）。
- L51-09 零残留：探针对象 git rm 清场（flow-probe 两件+probe-owned 两件）→ 聚合面行消失 ∧ docsRoot git 洁性（内容轮 commit 非探针残留）。


### 1.29 对账轮增量：R-9 build 生效链判别面——骨架产物 digest ↔ apply_log 绑定行 rv 对账 + 流程图骨架节点升格 + apply-workflow 拉起投影面（2026-11-26，loop-57 轮——标准对账选点 R-9）

**缺口根因（R-9，console-adoption.md §4 落地顺序表 R-9 项，loop-56 对账清单首选）**：§1.21/§1.22 已落 execution 判别器（state=bound|unbound+skeleton）与派单受理投影（`/v1/agents/dispatches`），余量=「run 相位推进产生的效果与 build 产物对账」的判别面三问零落点：①构建产物 digest（骨架落库 rv）不可查；②apply_log 绑定行（fieldManager=workflow:bind 的 ok/noop 流水）与对象现值 rv 无对账投影——人写演进（骨架翻转为实现后物化器零盲写）导致的链分裂不可见；③骨架节点接线（spec.flow.nodes）与 run 相位序列无对账投影（流程图 tab 只有声明相位线性渲染）；④派单受理行不带节点载荷（apply-workflow 拉起输入面缺席）。

**收口方向（判别面三件联动——零新写面，全部现读现投）**：
1. workservice v0.55（flowbind `execution.go` 新件）：**Reconcile 判别投影**——`ReconcileOf(execution, connObj, applies)` 纯函数：骨架产物 digest=绑定对象落库 rv（skeletonRv，absent=0）↔ 最近绑定器 apply 行 rv（lastBindRv/lastBindApply/lastBindAt——行集按 fieldManager=workflow:bind ∧ reasonRef 前缀 workflow-bind: 过滤，rv 最大者为最近：ok 行=落库后版本、noop=面上现值）→ **chain 三词闭合集**：`consistent`（同窗一致）/`divergent`（面上 rv≠绑定行 rv——对象在绑定器之外演进过，链照实分裂可见不静默；含绑定行缺席词形）/`absent`（绑定对象缺席=unbound 同窗缺口词形）。`NodesOf`=骨架对象 spec.flow.nodes 宽松解析投影（派单行与聚合面共用同一投影——单一真相零硬编码）。
2. 聚合面行集四新键（`GET /v1/workflows` 行——新载荷键=代际判别器）：`reconcile`（Reconcile 判别投影全字段）/`executionFlow`（骨架节点接线投影——bound 行=nodes 数组，unbound=null）/`executionDigest`（`{skeletonRv, bound, skeleton, chain}` digest 三键）/`executionHistory`（apply_log 对象链机读深链参数 `kind=ConnectorOps&scope=<s>&name=<n>`——绑定对象键同源）。派单面行集新键 `nodes`（workflow-runtime.md §11.2 第三段拉起投影面：apply-workflow 拉起输入=骨架节点清单——kind=workflow 行携带，kind=proposal 行空值不适用）。
3. console（v0.49/50 呈现升格三件——零新组件）：workflows 列表「生效链」列（`链·r<rv>` mute chip=consistent/`链·分裂` warn chip=divergent/`链·absent` faint=absent——digest↔bind rv 对账 head 词形在 title）；wf 详情配置 tab 生效链详情行（骨架 digest ↔ 绑定 apply 行 → chain 词 + 应用史深链）+ 骨架节点接线 chips（spec.flow.nodes 投影：name·unit 全显，unit=agent/connector/provider 落 title）；**流程图 tab 骨架节点 × run 相位对账投影卡**（节点态四词着色 ◉ 当前落点·✓ 已过·○ 未至·⤫ 不在现势 run 相位序列——节点在骨架而 run 序列不含=off-flow 对账缺口可见；骨架缺席=回退声明相位线性渲染既有形态零翻转）；派单行 nodes 键消费（节点输入词形随行）。

**L57 验收线（探针编号 L57-\*；探针=acceptance/loop-57.md）**：
- L57-01 骨架 rv ↔ 绑定行 rv 对账（核心判据）：apply 探针 workflow（global/l57-chain-probe）→ 同名 ConnectorOps 骨架出现 ∧ 聚合面该锚 `reconcile.chain=consistent` ∧ `skeletonRv`=骨架落库 rv ∧ `lastBindApply=ok ∧ lastBindRv` 同值（apply_log 绑定行同源可回指 `/v1/history`）。
- L57-02 digest/绑定态/对象链三件联动：`execution.skeleton=true ∧ reconcile.skeletonRv ∧ executionHistory=kind=ConnectorOps&scope=<s>&name=<锚>` 三键同源——「构建产物 digest ↔ 生效对象 rv ↔ execution 绑定态」联动一致可查（unbound/skeleton=true 即缺口词形）。
- L57-03 executionFlow=骨架节点接线投影：flow.nodes 节点行（name/title/unit/op/connector/provider）在册；unit=agent 节点声明原样投影（跨服务=agent 调 agent 表达面）。
- L57-04 派单行拉起输入面：`GET /v1/agents/dispatches` 该锚行 `nodes`=节点清单（apply-workflow 拉起输入面首件；autoLevel=ask 数据面；**受理≠拉起红线不变**——真实执行仍 observe）。
- L57-05 dev-delivery 存量链：boot 存量枚举 noop 行（幂等重入零差异照落现值）→ reconcile=consistent（lastBindApply=noop）；派单行=0（noop 不派单零噪音）。
- L57-06 divergent 缺口词形（单测锚定）：人写演进（骨架翻转为实现/外部编辑）→ 面上 rv≠绑定行 rv → chain=divergent（flowbind execution_test `-race` 绿；外来 fieldManager/reasonRef 行过滤面随行）。
- L57-07 流程图对账投影（headless）：wf 详情流程图 tab「骨架节点 × run 相位对账投影」卡在册——节点态四词着色数据面可查（◉/✓/○/⤫）；run 环重启归零=全列 ⤫ 诚实词形；骨架缺席=回退声明相位渲染（既有形态零翻转）。
- L57-08 console 判别面（headless）：workflows 列表「生效链」列 + 配置 tab 生效链行/骨架节点 chips/应用史深链 + 派单行 nodes 词形——零 console error 零 4xx；截图 ≥3 张（列表+配置+流程图，acceptance/shots/loop-57-*.png）。
- L57-09 零残留：探针对象（l57-chain-probe 两件）git rm 清场 → 聚合面行消失 ∧ docsRoot git 洁性 ∧ apply_log 探针审计行=合法产物（账本不删——对账锚跨生命周期如实可见）。
- L57-10 回归：六仓 go build/test/lint 绿（并发包 -race 绿）+ npm test 绿 + loop-50/51 基线判据（execution 投影/派单幂等不派单/所有面不派单）不回退 + loop-56 基线（心跳面活体）不回退 + cored-lint `files=14 findings=0 mirror=ok`（docsRoot scheme 镜像漂移闸本轮复原：core_design@74a8efe 声明面随行镜像同步）。
- L57-11 代际判别器：新代聚合面行含 reconcile/executionFlow/executionDigest/executionHistory 四键 ∧ 派单行含 nodes 键；旧代（headless 载体或旧构建）无该键（载荷键出现/缺席=代际词形分立）。


### 1.30 对账轮增量：agent-session 域 SelfHeal 注入执行面真实接线 + 派单 ask 批准动作面（2026-11-26，loop-58 轮——标准对账选点 R-10）

**缺口根因（R-10，loop-56 declared 顺延项 KI-003 余量 + workflow-runtime.md §11.2/§11.3 余量行）**：①watchdog 自愈第一动作=「注入固定 prompt『继续』」在 cored 侧只有 `Watchdog.SelfHeal` 装配口（nil=纯观测装配——healed-self 词形），真实执行面零落点（agent 会话推进点在 dsh 宿主 sessionController 面，cored 不可直达）；②派单面 autoLevel=ask 数据面在册而 ask 的「问不问」动作面（ApprovalNeeded→人批）缺席——批准/驳回判定无投影无账面可查；③watchdog 自身动作的活性观测心跳可经 POST /v1/sessions/heartbeat 伪冒（判定面自续租死循环口未闭）。

**收口方向（三件联动——零新自动执行面，红线 a 红线 1 全程不破）**：
1. workservice v0.56（`internal/sessionliveness` 扩展）：**SelfHealBridge 接口**（`Bounce(sessionID)/InjectWord()`——cored 唯一依赖方向，零宿主 import）+ `Watchdog.SetSelfHealBridge` 装配（桥接管 SelfHeal 面成为第一动作执行面：`--self-heal-word` 缺省「继续」单点声明）+ `BeatSource`（watchdog 侧动作观测续租落行——不触发 SessionHealed，恢复判据=会话侧真实推进心跳）；装配段经 env `CORE_SYSTEM_SELFHEAL_ADDR`（宿主 loopback HTTP 面）回填桥；桥缺席=纯观测词形不变。**心跳防伪**：POST /v1/sessions/heartbeat 拒收 `source=watchdog`（判定面自续租禁入——心跳面唯一口径）。
2. dsh plugin（`mountSelfHealBridge`）：**注入桥宿主侧**——loopback HTTP listener（`POST /selfheal/bounce`）→ `sessionController.prompt(mode=queue, 固定词)` 注入「继续」（保留上下文不重启）；注入受理→既有心跳通路回执活性观测（phase=inject-continue，source=session——非续租）；防御面=prompt 面缺席 503 绝不冒充/注入词不被远端改写/失败 502（cored 照实上报绝不静默，下一拍重试第一动作）。**红线**：注入只对「已判停滞的会话」发固定 prompt——零自主判定零定时器零队列。
3. workservice v0.56（`internal/flowbind/approval.go`）：**派单 ask 批准动作面**——`ApprovalRecord/ApprovalLog/SyncApprovals`（DispatchLog.Dispatch 同拍挂 pending 批准投影 autoLevel=ask；人批/驳回=Apply 判定（fieldManager=workflow:approve|workflow:reject 的 ok 行）按 obj=matchingKeyOf 精确匹配 → 原地翻转 approved|rejected（judgedBy/ts 随行））；**零新写路径零旁路**（判定=apply_log 行集匹配）；dispatches 派单行新增 `approval` 键（state 词随行——拉起投影面第三段）。

**L58 验收线（SelfHeal 段+批准动作面段；探针编号 L58-\*；探针=acceptance/loop-58.md）**：
- L58-01 桥接线（核心判据）：注入停滞→watchdog 第一动作=桥 Bounce→宿主 sessionController.prompt(mode=queue) 注入固定词「继续」∧注入受理落观测续租行（last_action 带 inject 词形）∧**不触发 SessionHealed**（恢复判据=会话侧真实推进心跳）∧恢复后 healed-by-beat 词形在账（attempts 清零）。
- L58-02 失败绝不静默：桥 Bounce 失败→行态保持 suspected-stall（attempts=0）∧下一拍重试第一动作=重试不是跳步（重试消耗判别桩 failN 计数）∧第三拍成功注入。
- L58-03 纯观测回归不破：无桥装配（env 未设）→ SelfHeal=nil 词形不变（判定事件在账、零注入、healed-self 恢复判定照旧）。
- L58-04 心跳防伪：POST /v1/sessions/heartbeat 带 source=watchdog → 400 禁入（判定面自续租死循环口闭合）；session 来源照常受理。
- L58-05 批准动作面（核心判据）：派单受理→批准投影 pending 行（autoLevel=ask）∧`GET /v1/inbox` approvals.records 含该行；Apply workflow:approve ok 行 → 投影原地翻转 approved（judgedBy/ts 随行）∧挂起计数归零∧approveIdle=true（零挂起≠停摆真实词形）；驳回=workflow:reject → rejected；无关 fieldManager/denied 行零翻转零发明。
- L58-06 单测：sessionliveness 桥四测（接线/失败重试/纯观测回归/BeatSource 不 heal）+ flowbind 批准面四测（挂起/翻转/键三段/收件箱四类）-race 绿 + apiserver inbox face 三测（投影/缺席 503/watchdog 拒收）。
- L58-07 红线：注入零新增自动任务/自动执行面（桥零自主判定零定时器——单测判别桩计数=watchdog 唯一触发源）；approved 派单投影≠spawn 已拉起（spawn 接线=agent-session 域 declared-deferred）；探针零外发。

### 1.31 对账轮增量：console 通知中心收件箱（2026-11-26，loop-58 轮——§1.25 页面兜底首段落地）

**缺口根因（§1.25 判据落点）**：「待你处理」收件箱四类汇总（NeedsHuman/ApprovalNeeded/Proposal 待批/文档待审）零落点——审批屏只覆盖草稿∪ApprovalNeeded 归档两类、提案屏只覆盖 Proposal 一类、事件流无接管分类视图；未配置通知通道=仅页面展示（notification.md 规则 6）无页面可展。

**收口方向（读面机械自分类——console 零自建持久状态红线 2）**：
1. workservice v0.56（`flowbind.BuildInbox` 纯函数 + `GET /v1/inbox` 读面）：四类判定分类=读面现读自组装——**NeedsHuman**（归档 NeedsHuman∧Escalate 行——acceptance.md §9 接管链）/ **ApprovalNeeded**（归档行+派单 ask 批准投影挂起行）/ **Proposal**（status=submitted 提案）/ **DocReview**（草稿缓存行——apply.md §6 代改代审的家）；行 `{class, kind, name, scope, digest, eventId, at, link}`（link=console 深链路由——页面兜底入口恒达操作面）；类序=人注意优先、同类 At 降序（投影确定性）；载荷 `{count, classes, items, approvals, watchdog}`（watchdog={approvals, pending, approveIdle}——真实词形零挂起≠停摆）。face 缺席=503；旧构建 405=代际判别器。
2. console（v0.51 呈现新增一屏一卡一动作）：`#/inbox` 屏（四类 chips 过滤+条目行=深链操作面+空态显式「待你处理清单为空」+watchdog 观测面区块+接管与回链口径 disclosure）；总览屏「待你处理」metric 卡（计数+点击落收件箱）；palette「待你处理收件箱」动作；`inboxCount()` 读面缺席回落=草稿∪ApprovalNeeded 归档现读（不冒充零）。

**L58-UI 验收线（收件箱段；探针编号 L58-UI-\*）**：
- L58-UI-01 收件箱屏活体（headless）：`#/inbox` 渲染 ∧ 四类 chips 计数在册 ∧ 条目行深链 `data-act="go"` 在册（命中→对应操作面渲染）∧ 空态或实数行在册 ∧ watchdog 观测面区块在册（approveIdle 词形）。
- L58-UI-02 总览 metric 卡：「待你处理」卡在册且计数与 `/v1/inbox` count 双读一致 ∧ 点击落 `#/inbox`。
- L58-UI-03 深链操作面闭环：ApprovalNeeded 条目行 → 编辑器/审批屏渲染（`data-go` 落点活体）——条目可点达操作面（§1.25 判据）。
- L58-UI-04 零 console error 零 4xx（收件箱屏+总览屏 headless 全程监听）；截图 ≥2 张（acceptance/shots/loop-58-*.png）。

### 1.32 对账轮增量：收件箱四类深链操作面活体判定 + 事件回链闭环 + spawn 接线声明投影（2026-11-26，loop-59 轮——§1.31 闭环加固 + workflow-runtime.md §11.5 余量第二段）

**缺口根因（L58-UI-10 判据遗留 + §11.5 余量第二段）**：①收件箱四类条目的深链此前只有「类级」判定窗（L58-UI-10 在「无 ApprovalNeeded/DocReview 条目」窗为跳过词形）——四类各自的**操作面落点活体判定**缺席；②「完成操作后事件回链可查」未判据化——收件箱计数条目是否在下一次装载反映操作结果（回链闭环）零探针锚；③派单 ask 批准投影挂起行**只进计数（classes.ApprovalNeeded）不进行集（items）**—— ApprovalNeeded chip=计数 N 而 items=0 行的「幽灵计数」缺口词形（计数可点达性违背 §1.25「计数与深链」同规则）；④approved 派单投影的 spawn 接线只有「≠已拉起」否定词形——接线声明面（wired 词形）缺席（workflow-runtime.md §11.5 余量第二段）。

**收口方向（读面投影+呈现落点+声明面三件——零新写路径，红线 a/红线 2 全程不破）**：
1. workservice v0.57（`flowbind` 批准投影行集升格）：**ApprovalNeeded 类挂起行进行集**——派单 ask 批准投影 pending 行以 `InboxRow{class: ApprovalNeeded, kind: dispatch, name: <connector|proposal>, scope, digest: "派单待批（<锚> · autoLevel=ask）", eventId, at, link: #/wf/<锚>}` 投影进 `/v1/inbox` items（行集与计数同源不翻倍——`classes.ApprovalNeeded` 加法投影摘除，`count=行数`；`SortInboxRows` 导出形=BuildInbox 内序与合并复排同一投影）；**spawn 接线声明投影**（`ApprovalSpawnDeclaration` 纯函数）——approved 批准投影行 → `{declared: true, wired: false, target: "apply-workflow", approvalId, rv, eventId}`；`GET /v1/agents/dispatches` 派单行新增 `spawn` 键（键恒在=代际判别器；pending/rejected 行/投影面缺席=`{declared:false, wired:false}` 零值诚实词形）；判定权威=apply_log 行（`workflow:approve` ok/noop 行 Sync 翻转随行写 rv=批准 Apply 落库后版本；投影环重启归零后判定行重放=声明再现——账本事实投影单点真相）；**wired 恒 false=真实拉起 deferred 的机械锚**（红线 a：零拉起执行器零自动触发；`wired=true 而无执行面`=静默缺口禁入词形）。
2. console（v0.52 呈现三件——零新组件）：**类内 op 深链落点升格**——收件箱条目行随 class 消费类内 op 落点：NeedsHuman→事件详情回链（`#/event/:id`）∧Escalate→wf 锚链（`#/wf/:name`）；ApprovalNeeded→编辑器（`#/doc/:kind/:scope/:name`）∪审批屏（`#/approvals`）；Proposal→`#/proposal/:scope/:name` 详情批准/驳回动作；DocReview→审批屏 diff 卡（`#/approvals`）∪编辑器；**ApprovalNeeded 派单待批行**（v0.57 新行集）落点=派单投影所在 wf 详情配置 tab（`#/wf/<workflow>`——批准动作=Apply `workflow:approve` 判定链路，行 title 标注）；**轻刷新回链判据**——approval 翻转/提案批准/文档落库完成后 `/v1/inbox` 下一次 15s 轮询装载（live.load 全量）反映（挂起行消失/计数降位/状态词翻转）——`#/inbox` 屏挂载即 ensure()、数据老化窗内重入即现读（不缓存不冒充）。
3. 判据（机读，探针编号 L59-\*；细化验收线随行）：headless 四类各自命中→落点屏渲染断言（`data-cc-screen`/屏头词形）∧ `spawn` 键代际判别器（新代在册∧wired=false 词形诚实∧旧代键缺席）∧ 回链判据=操作完成后 inbox 下一次装载反映（count/classes 降位 ∧ 挂起行消失）∧ 零 console error 零 4xx ∧ 截图 ≥3 张（acceptance/shots/loop-59-\*.png）。

**L59 验收线（探针=acceptance/loop-59.md）**：
- L59-01 spawn 接线声明投影（核心判据）：探针 workflow（self-recursive-core/l59-spawn-probe）apply → 骨架物化即派单受理（pending）∧ 派单行 `spawn={declared:false, wired:false}` 零值键在册；Apply `workflow:approve`（noop ok 行）→ 投影原地翻转 approved ∧ `spawn={declared:true, wired:false, target:"apply-workflow", approvalId 同键, rv=批准落库后版本}` 声明词形在册。
- L59-02 spawn 判定权威=apply_log 行：判定=Apply 判定行匹配（零新写路径）；投影环重启归零后（服务重启实测）重物化同拍挂 pending、`workflow:approve` 判定行重扫即再现声明（账本事实投影单点真相——重启不致声明静默缺口）。
- L59-03 红线 a 机械锚：`wired` 恒 false 词形（单测 TestApprovalSpawnDeclaration 锚定 pending/rejected/零值三词形）∧ 零新增自动任务/自动执行面（声明面零拉起执行器零定时器——approved≠拉起）∧ eventId 判定行不复制派单载荷（声明面零拉起事实词形）。
- L59-04 spawn 代际判别器：派单行 `spawn` 键恒在（零值=诚实缺席）；face 缺席=503；旧构建 405。
- L59-UI-01 收件箱四类深链操作面活体（headless，类级闭环收口——L58-UI-10 跳过词形废除）：四类各自命中条目→落点屏渲染断言全绿（NeedsHuman→事件详情回链/ApprovalNeeded→编辑器∪审批屏/Proposal→提案详情批准/驳回动作/DocReview→审批屏 diff 卡∪编辑器）；类内 op 落点与 `link` 键单一真相（console 不改写 cored 深链——`data-go`=link 原值）。
- L59-UI-02 ApprovalNeeded 挂起行进行集（幽灵计数缺口收口）：派单 ask 批准投影挂起 → `/v1/inbox` items 出现 `class=ApprovalNeeded ∧ kind=dispatch` 行（digest=派单待批（<锚> · autoLevel=ask））∧ `classes.ApprovalNeeded` 计数=归档行+挂起行（**计数=行数**——加法投影摘除后同源不翻倍）∧ 条目行可点达操作面。
- L59-UI-03 事件回链闭环：批准动作完成（workflow:approve 判定落账）→ inbox 下一次装载（live.load 轻刷新）反映——挂起行消失 ∧ `classes.ApprovalNeeded`/`count` 降位 ∧ `watchdog.approveIdle=true` 真实词形（零挂起≠停摆）。
- L59-UI-04 零 console error 零 4xx（inbox 屏+落点屏全程监听）；截图 ≥3 张（inbox 类过滤+落点屏+spawn 声明面，acceptance/shots/loop-59-*.png）。
- L59-05 回归：六仓 go build/test/lint 绿（并发包 -race 绿）+ npm test 绿 + loop-58 基线（SelfHeal 注入面 e2e 心跳防伪/批准投影翻转）不回退 + cored-lint mirror 闸 ok（docsRoot 探针清场后 files=14 findings=0 mirror=ok）。



**保留**：现 console 独立页（proto/现有页面）**单独留着**，不改不拆（作为完整形态参照与独立入口）。

**整合（第一波）**：把 console 九项功能（Welcome/总览/系统树/Workflows/文档/事件/审批/连接/会话）**嵌入 dsh 主侧栏**，采用 **DeepSeek console 原生风格与样式**——不出现第二列导航，全部经 dsh plugin Slot 注册为宿主侧栏分组（如「核心控制台」），点击进入各屏。

**样式基线（验收硬线）**：
- 行高/字号/图标尺寸/hover/选中态与 dsh 原生侧栏一致；深浅色 token 取自宿主；
- 卡片统一 spacing（8/12/16）与边框色；每屏主 CTA 唯一（其余降次级）；
- 中英混排字体栈一致；正文最大行宽约 72ch；长说明用抽屉/展开，不用 tooltip 压内容；
- 红色只用于「需要行动」的告警（审批 badge）；事件计数用中性色；空态显式（无 run=「等待触发」而非灰点排）。

**Workspace 改造（第一波）**：Workspace 按 **Service** 创建 project（如 `self-recursive-core`）；Service 的 agent 会话归入对应 project（service agent = dsh project 页）；`Ungrouped` 噪音隐藏或折叠（仅保留当前项目）。概念影响=改动 agent 归属（service ↔ project），先按**最小映射**实现（project 名=service 名；会话 metadata.project 绑定），不得破坏既有会话可访问性；更深的 agent 概念改造后续轮次再动。

**判据（机读）**：
- 主侧栏出现「核心控制台」分组且含九项，DOM 无第二列 nav；
- 样式抽查=与 dsh 原生项同 token（截图比对入报告）；
- Workspace 出现按 Service 的 project，新会话归组正确；Ungrouped 折叠/隐藏；
- 独立页路由仍可达（保留）；截图走 acceptance-screenshot（Chromium headless），报告按 §8。

### 1.23 用户裁决（2026-11-24）：console 原生整合 + Workspace 按 Service（第一波）

**（已完成 2026-11-24，loop-55 §1.28——本节原裁决全文并入 §1.28 落地记录；判据=主侧栏九项/原生 token/Service project 归组/独立页保留，细化=L55-01…12。本节标题保留为历史锚。）**

### 1.24 用户裁决增量：能力 B——需求提交流（2026-11-24 裁决「B 优先，A 次之」，loop-52 轮）

**缺口根因（用户裁决 2026-11-24）**：用户要在 agent-core 界面上**直接提交需求**（像在对话里提要求一样）——需求先成为一等对象、走审批、自动落地为文档草稿/派工任务。现状对账：①需求无对象形态（只能进对话或文档散记——不入库、无状态机、不可对账）；②审批链已立（v0.46 approval_log 独立账+`console:approve` 约定串+审批族事件）但只服务「草稿代改代审」，无需求级判定面；③派单面已立（v0.50 `GET /v1/agents/dispatches`）但触发源只有 workflow 骨架物化一种；④console 无需求提案屏。

**收口方向（按现有架构最小落点；概念文档=core_design concepts/proposal.md）**：
1. 声明面：`kind: Proposal` 注册（core_design/core/scheme.yaml——storage `global/proposals/<name>.yaml | systems/<s>/proposals/<name>.yaml`；spec `title/summary/acceptance[]/impact/priority/proposer/status`+可选 `landing` 产物指针；status 闭合集 `draft|submitted|approved|rejected|landed`）。
2. 数据面：cored 读面 `GET /v1/proposals`（列表/详情/状态过滤）；写面零新端点（Proposal 走既有 apply 管线 spec 准入 checker——枚举闭合集闸门）；审批分流=部署侧 `--proposal-auto-approve=<priority csv>`（缺省空=全人审，宁慢勿越）；高危提交引擎自产 `ApprovalNeeded`（event.md 规则 15，source=core，dedupKey=`proposal:<obj>`，route `notification/*`）。
3. 审批链复用：批准=草稿（status=approved）→ `fromDraft` Apply `fieldManager=console:approve`（granted 行+`ApprovalGranted` 事件 source=human）；驳回=草稿（status=rejected）→ `fromDraft` Apply `fieldManager=console:reject`（**v0.51 对称扩展**：rejected 行 rv=落库后版本+`ApprovalRejected` 事件）。
4. 派单面（第二触发源）：Proposal status=approved 落库 → flowbind 派单面 `kind=proposal` 行（agent=apply-workflow，载荷带 proposal 名/目标/验收/priority/proposer，eventId=DocApplied 回执同源；**受理≠拉起**照旧诚实投影；rejected 不派单）。
5. console：屏幕「需求提案」（`#/proposals` 列表+提交表单；`#/proposal/:scope/:name` 详情=六要素+状态+派单行+产物指针+批准/驳回动作）——提交=草稿→Apply 全流程（fieldManager=console:propose）。
6. 落地产物：本轮打通到「派单受理+产物指针」（spec.landing 声明）；产物真实落盘=apply-workflow agent 真实拉起段（declared-deferred，照旧）。

**L52 验收线（探针编号 L52-\*；探针=acceptance/loop-52.md）**：
- L52-01 界面提交→对象在库：提交一条需求（表单→草稿→fromDraft Apply）→ `GET /v1/proposals` 该提案行在册（rv=1 ∧ status=submitted）∧ docsRoot `global/proposals/<name>.yaml` 落盘（git 权威）。
- L52-02 批准→派单同源：批准（fromDraft Apply console:approve）→ status=approved ∧ `GET /v1/agents/dispatches` 出现对应行（`kind=proposal ∧ agent=apply-workflow ∧ autoLevel=ask ∧ action=approved ∧ rv=落库 rv ∧ eventId=DocApplied 回执同源`）∧ approval_log granted 行在账。
- L52-03 驳回→无派单：另一提案驳回（fromDraft Apply console:reject）→ status=rejected ∧ approval_log rejected 行在账 ∧ 派单面零该提案行。
- L52-04 分流可配：`--proposal-auto-approve` 缺省=提交即产 ApprovalNeeded（source=core，involved=Proposal 锚）；命中清单的 priority（探针专用实例）→ 提交即自动 approved+granted 行（fieldManager=proposal:auto）+派单照常（stderr 装配锚在册）。
- L52-05 读面代际：新代 `GET /v1/proposals`=200 ∧ 载荷形状 `{count, proposals}` ∧ 状态过滤生效；旧代 405（代际判别器）。
- L52-06 console 屏活体（headless）：`#/proposals` 列表/表单/详情真数据（列表行=真实提案名 ∧ 详情六要素+派单行+产物指针）∧ 批准/驳回动作闭环（状态 chip 翻转）∧ 零 console error；截图 ≥2 张（列表+详情，acceptance/shots/loop-52-*.png）。
- L52-07 红线：提案对象不 enable 任何 workflow（dispatch 投影≠拉起——run 面/触发接线零变化）∧ R-PUB lint 全绿（提案内容含占位符纪律）∧ 探针零外发。
- L52-08 回归：六仓 go build/test/lint 绿 + npm test 绿 + loop-51 基线判据只读段（派单面 workflow 行/幂等不派单/所有面不派单）不回退 + cored-lint 全绿（探针对象清场后 files 基线复原）。
- L52-09 零残留：探针 Proposal 对象 git rm 清场 → 读面行消失 ∧ docsRoot git 洁性。

### 1.25 待你处理收件箱与接管路径（2026-11-24 用户裁决）

- console 首页与侧栏提供**「待你处理」收件箱**：汇总 NeedsHuman / ApprovalNeeded / Proposal 待批 / 文档待审四类，带计数与深链；
- **接管路径**：①提交需求（能力 B：Proposal 表单）②编辑文档（能力 A：设计文档编辑器）③审批（ApprovalNeeded）；完成即产事件回链，loop 自动续跑对应分支；
- 移交通知（邮件/页面）必须含**固定入口链接**与接管清单；未配置通知通道=仅页面展示（notification.md 规则 6）；
- 判据：收件箱条目可点达对应操作面；完成任务后事件回链可查；无待办时显式空态。

### 1.26 用户裁决增量：能力 A——设计文档在线编辑（2026-11-24 裁决「B 之后做 A」，loop-53 轮）

**缺口根因（用户裁决 2026-11-24）**：console 屏幕 6 目前只能编辑**文档库对象**（core-docs 的 YAML 对象），用户要能直接在界面上编辑**设计文档 md**（core_design/concepts/*.md、core_system_instance/runtime/*.md 等）：打开 → 编辑 → 草稿 → dry-run（结构/lint 检查）→ Apply → **git commit**（权威=git 仓）。对账：①设计文档无读面（cored 只知 docsRoot 对象，设计文档仓零投影）；②无写面（git commit 写路径零落点）；③屏幕 6 无设计文档入口。

**路线裁决（任务书两路线择一，机械面取舍）**：**路线②受限文件面**——设计文档正文的真相本来就在其 git 仓，对象化（路线① kind:DesignDoc 落 docsRoot）会在文档库造第二副本、再靠同步器写回目标仓，单向权威可定义但多一跳同步与漂移判定面；本面零新权威：Apply=写工作树文件+git add+git commit（本地落盘不 push），读面=git HEAD 内容（**未提交的工作树改动不进读面**）——红线「权威必须唯一」的机械落点：无同步器、无双源、无漂移判定面。契约落点=cored-bridge.md §2.4（v0.52）。

**收口方向**：
1. workservice v0.52（`internal/docrepo` 新包）：`--design-repo <name>=<仓根>`（可重复）注册白名单仓；读面=git HEAD（ls-tree/cat-file/log）；写面引擎随 `--allow-apply` 装配——Apply 三检查（白名单 403 / R-PUB-1 lint 400 携违规 / 乐观锁 baseSha 409）+ 权限准入（`core/design-docs` 资源域，permission.md 机读——scheme.yaml Role 声明词汇 v0.52 扩 `core/*` 家族）+ git commit（message 自动生成，提交身份随仓 config）+ 审计（apply_log 行 obj=`DesignDoc/<repo>/<path>` + DocApplied 事件 involved 三段同构）。幂等 noop（同内容零提交）；工作树脏=拒绝 409（不吞他人未提交编辑）。
2. core_design 声明面随行：scheme.yaml Role permissions scope 词汇 `global|systems/<n>/*` → `global|systems/<n>/*|core/*`（cored 资源域家族——core/design-docs 写设计文档域）；docsRoot 镜像同步 commit+admin Role 增 `{scope: core/*, actions: ['*']}` 条目（净入 lint 随行，files 基线不动）。
3. plugin 宿主：`/core-console/design-docs` 写路由（POST exact=apply 主体宿主注入 / POST draft=落稿 / DELETE draft/{repo}/{path...}=弃稿——栅栏 fail-closed 同款）；读面走既有只读代理。
4. console：屏幕 6 增「设计文档」页签（全 kind）+ `#/designdoc/:repo/:path` 深链路由共用同一工作台渲染核——三栏=文件树（白名单仓分组+过滤）/ 编辑器（HEAD 权威正文+最近提交行）/ 协作面板（草稿 diff+审计史）+ Apply dock（dry-run 三检查确认弹窗，三 ✓ 才解锁确认按钮）；审批屏 DesignDoc 稿=设计文档卡（HEAD vs 稿 diff+批准=designApply 全流程+驳回=designDraftDelete）；DesignDoc involved 深链=工作台。
5. 草稿=与对象草稿同一缓存同一持久化面（draft.Store kind=DesignDoc, scope=<repo>, name=<path>——写穿/恢复/审批屏待审区全继承；baseSha 不入草稿在 apply 请求随行）。

**L53 验收线（探针编号 L53-\*；探针=acceptance/loop-53.md）**：
- L53-01 读面代际：新代 `GET /v1/design-docs` 200（清单=白名单仓 .md 行集含 sha）∧ carrier-pre 旧代 405（代际判别器）；单文档读面（真实概念文档）content+sha+lastCommit 在册。
- L53-02 写面判据三件：①界面（headless）打开 core_design 概念文档 → 编辑并 Apply → 目标仓出现新 commit（message 自动生成）∧ DocApplied 归档在册（eventId 同源）∧ apply_log ok 行在账；②基线 sha 不符 → 409（expected/current 在载荷）；③非白名单路径（.yaml/越权）→ 403；④lint 失败 → 400 携违规（line/rule）。
- L53-03 幂等与幂等不派单：同内容重入 noop（零提交零事件）；DocApplied×DesignDoc 不触发 flowbind/proposal/metrics 任一 watcher（下游零动作）。
- L53-04 权限面：受限主体（role/design-editor 断言）dryRun 写 → admit 过；匿名主体 → 403 denied 行在账（permission.md 规则 3 判定留痕）。
- L53-05 UI 活体（headless）：屏幕 6「设计文档」页签=文件树+编辑器+diff+Apply dock 在册 ∧ 文件树=白名单仓真名∧行可点 ∧ Apply dock 空稿禁用 ∧ 零 console error；截图 ≥2 张（acceptance/shots/loop-53-*.png）。
- L53-06 审批屏 DesignDoc 稿：设计文档稿落稿 → 审批屏卡片（HEAD vs 稿 diff+批准=git commit+驳回=弃稿）在册（headless 活体）。
- L53-07 回归：六仓 go build/test/lint 绿 + npm test 绿 + loop-52 基线判据只读段（L52-01…05 提案面/派单面 kind=proposal 行）不回退 + cored-lint `files=14 findings=0 mirror=ok`（Role 条目编辑不改 files 基线）+ E4 对象编辑回归不掉（L39-04 全链路判据）。
- L53-08 零残留：探针设计文档改动复原（原内容 apply 回 HEAD——git log 两枚探针 commit 为合法审计留痕，终态内容零漂移）∧ docsRoot git 状态=内容轮 commit 非探针残留 ∧ 探针草稿清场。

### 1.27 用户裁决增量：能力 D——需求提案对话式录入 + R-UX-1 通用对话交互框架 + R-UX-2 scheme 驱动编辑控件（2026-11-24 裁决，loop-54 轮）

**缺口根因（用户裁决 2026-11-24，proposal.md §4.5 / console-ui.md §12 / core_design rule/rule_ux.md R-UX-1 & R-UX-2）**：
1. 能力 B 已落地的提案录入是静态表单，用户裁决「改成对话。完整询问方式填完 scheme 的东西或者自动补充。然后对话完成后。提交节点让 LLM 自动生成相应的格式。然后确认后自动补全。这个界面跟傻子一样」；
2. 按通用规则 **R-UX-1**，所有与人交互默认是对话（session 对话），表单仅为降级或精修入口；须实现**可复用的对话录入组件/流程**（Proposal 为首个接入面，Workflow/Role/ServiceDesc/对象编辑可直接复用），固定六步顺序：自由描述+自动上下文 → 自动补充 → 缺少询问（只问缺失/冲突项，带默认与示例） → 提交节点生成 spec 对象+三重 dry-run（失败定位到具体字段） → 确认 diff 后系统自动补全并 Apply → 降级表单（同一对象无双源）；
3. 按通用规则 **R-UX-2**，一切录入/编辑面的字段集、类型、必填、枚举、默认值一律取自 `scheme`（单一真相，UI 不硬编码）；控件按八类机读映射（枚举→selector 禁手输、字符串→input、长文本→textarea、数组→列表编辑器、ref→对象选择器显示 name+rv、bool→switch、map→键值编辑器、数字→number input 带 min/max）；校验双保险（控件级即时校验 + 提交前 spec 准入 dry-run 定位到字段）；Scheme 本体可经对象编辑/设计文档编辑修改（过同一权限/R-PUB lint/Scheme 准入链），修改后 `cored` 内存热刷新、UI 自动反映（零硬编码残留）。

**收口方向**：
1. workservice v0.53：
   - `internal/scheme/widgets.go`：从 `Kind.Spec`/`Kind.Fields` 实时派生 `[]FieldDescriptor`（8 类 `widget` 映射、`required`、`enum` 闭合集、`default`、`min/max`、`refKind`、嵌套 `elem`/`fields`）；`Scheme` 加读写锁与 `Replace` 原子热刷新；`apply.Engine` 与 `design_docs` 对 `Scheme` 变更强制执行 `scheme.Load` 结构准入 + R-PUB-1 lint 并在落库后热刷新内存 `Scheme`。
   - `internal/intake` 新包 + `internal/apiserver/intake_face.go`：通用 R-UX-1 对话录入与三重 dry-run 引擎（支持 `Proposal` 及任意注册 `Kind`）——`POST /v1/intake/turn`（自由描述多字段抽取、上下文与缺省自动补充、缺失/冲突字段计算、带默认值与示例的追问生成、字段卡双向同步）、`POST /v1/intake/generate`（系统补缺省、生成标准 YAML `rv=0`、逐字段 R-PUB-1 lint 含 secret 引用式前缀检查 + `scheme.ValidateDoc` spec 准入含 `ref` 存在性校验 + `apply.Engine` 权限预览与审批分流预示，违规精确归因到 `fieldErrors:[{field, rule, message}]`）、`GET /v1/intake/sessions*`（会话与生成版本留痕，对话原文不入公共库）。
2. plugin 宿主：`/core-console/intake`（`POST /turn`、`POST /generate`）写路由（connection 栅栏 fail-closed + 宿主注入 `applySubject`；服务端可选会话/Provider 钩子，零浏览器直连模型，探针零外发）。
3. console 前端（`console-live.js` + `console-app.js` + `console.css`）：
   - R-UX-2 通用 scheme 控件渲染器 `renderSchemeWidgets`（`selector`/`input`/`textarea`/`list`/`ref`/`switch`/`map`/`number`/`object` 全覆盖 + 控件级即时校验）；
   - R-UX-1 通用对话录入组件（左 2/3 对话区 + 右 1/3 实时字段卡 + 预览确认弹窗/区 + 一键切换降级表单，共享同一字段态产同一对象）；
   - `#/proposals` 需求提案屏默认进入对话模式（保留「直接填表」降级表单及下方提案列表/详情/批准/驳回全链路）；屏幕 6 对象编辑器接入 R-UX-2 scheme 驱动结构化控件与 R-UX-1 对话辅助面板。

**L54 验收线（探针编号 L54-\*；探针=acceptance/loop-54.md）**：
- L54-01 读面代际与 R-UX-2 控件映射：新代 `GET /v1/intake/sessions` 200 ∧ 旧代 405（代际判别器）；`GET /v1/scheme/kinds` 返回 18 kind 的 `widgets` 描述符，抽查 `Proposal`/`Workflow`/`ServiceDesc`/`Provider`/`ConnectorOps`/`WorkService` 覆盖全部 8 类控件（`selector`/`input`/`textarea`/`list`/`ref`/`switch`/`map`/`number`）。
- L54-02 R-UX-1 对话录入与自动补充：零起点会话自动补充 `proposer=console-operator`、`priority=low`、`landing.target=doc`；只问缺失/冲突字段（不重复问已推断项）；支持一段话自由描述抽取多字段（标题/目标/验收标准/影响面/优先级）与分轮带默认值/示例询问；≤6 轮对话字段全绿（`ready=true`）。
- L54-03 提交节点生成与 dry-run 字段级错误定位：`POST /v1/intake/generate` 在字段含 R-PUB 违规（真实 IP/部署路径）、非法枚举（`priority=urgent`）、缺失必填项或明文 secret 时返回 `ok=false` 且 `fieldErrors` 精确定位到具体字段名（`impact`/`priority`/`title` 等）；修正后 dry-run 三检查全绿（`ok=true`）并给出 YAML 与 `reasonRef=intake:<sessionId>:v<genVersion>`。
- L54-04 确认后自动补全与 Apply 入库：确认 diff 后经草稿→Apply 入库（`Proposal` `rv=1`、`status=submitted`、`proposer` 系统补全）；高危提案自产 `ApprovalNeeded` 事件在册；审计账 `apply_log` `reasonRef` 回指对话 `sessionId` 与 `genVersion`，且 docsRoot 零对话原文残留。
- L54-05 Scheme 本体可编辑与 UI 自动反映（R-UX-2）：经 Apply 修改 `Scheme`（如为 `Proposal.spec` 临时新增枚举项或可选字段；非法 Scheme 或 R-PUB 违规被 400 拦截）→ `GET /v1/scheme/kinds/Proposal` 与 UI 字段卡/表单立即自动反映新控件/新枚举（零硬编码）；复原 `Scheme` 后字节与基线一致。
- L54-06 UI 活体（headless）与降级表单：`#/proposals` 默认展现对话态（左对话区+右 scheme 驱动字段卡，枚举为 `<select>` 无法手输非法值，列表编辑器可增删）→ 对话抽取+预览确认态（YAML diff + dry-run 三 ✓）→ 提交入库 `rv=1`；切换「直接填表」降级表单提交第二条提案同样入库 `rv=1`（无双源，表单回归不掉）；截图 ≥2 张（对话态 `loop-54-proposal-chat.png` / 预览确认态 `loop-54-proposal-preview.png` / scheme 控件态）。
- L54-07 回归与零残留：六仓 `go build/test/lint` 绿 + `npm test` 绿 + loop-53/52/51 基线不回退 + 探针提案与草稿清场后 `cored-lint` `files=14 findings=0 mirror=ok` + 探针零外发（KI-001）。


### 1.28 用户裁决增量：能力 C——console 原生整合 + Workspace 按 Service + §11 全量整改（2026-11-24 裁决，loop-55 轮）

**缺口根因（loop-55 对账）**：①`client/entry.js` 只注册一个 `core-console` panel，宿主主侧栏无九项分组；②`console-shell.js` 仍有自有 `<aside>` + `<nav id="side-nav">`，形成第二列导航；③`console.css` 固定深色 hex、字号/间距/圆角自成一套，未继承 dsh token；④Welcome 与总览重复，会话屏重复宿主全局列表；⑤无 run 仍画灰点排、零实例仍画绿格、阶段用英文字母、时间用绝对切片、长说明压 tooltip；⑥Service 与 dsh Workspace 无映射，新会话 `create({})` 落未归组；⑦profile 未锁定，插件/自动化/设置入口仍在。

**收口方向（最小机制，零 dsh 安装包改动）**：
1. **宿主主侧栏九项**：`sidebar.panellist` + keyed `main` 成对注册 9 个入口——总览（Welcome 合并）/系统树/Workflows/文档/事件/审批/连接/会话/需求提案。`#/welcome` 与 `#/overview` 同屏；已交付「需求提案」补足九项，既不恢复重复 Welcome，也不删既有能力。dsh `panellist` 只支持平铺元数据，分组标题由首个入口的 Slot 图标贡献（`data-cc-sidebar-label`），九项仍使用宿主原生按钮/标签/hover/选中态；不做 DOM 包裹或替换 `ui-sidebar`。
2. **内容区单栏**：console 壳移除自有侧栏与第二列 nav，只保留顶栏/内容/浮层；hash 路由全部保留，跨分组深链同步宿主 `selectPanel`，刷新可恢复。独立 `console-proto/index.html` 四文件永久保留、不改不拆。
3. **Workspace=Service project（第一波）**：新增 plugin 路由 `GET|POST /core-console/service-projects`——GET 只投影 cored `ServiceDesc`（含 `agent://` 声明），POST 只为已声明 Service 准备本地目录；客户端经 `ctx.workspaces.create({path})` 注册 dsh Workspace（title=Service 名），新会话经 `ctx.sessions.create({workspaceId})` 绑定。旧会话不迁移、不归档、不删除；console 的「宿主全部会话」折叠为深链兼容入口，原生 Workspace 仍可访问旧数据。Service/Agent 归属真相=cored，Workspace/Session 归属真相=dsh store，两权威各管一面。
4. **§11 视觉与数据呈现**：控制台 CSS 变量映射宿主 `--dsw-*` token；字号 11/13/15/20/28、间距 4/8/12/16/24、卡片 10px 圆角/1px neutral/16px 内边距；语义色 success/warn/danger/neutral；图标 16px；正文 72ch；长说明改 `<details>`。总览三卡同高同基线（InSync 系统数/待审批/24h 失败率）；无 run=「等待触发」且不画阶段条；零实例=「待接入」中性；事件两行制+筛选计数；相对时间+绝对时间/时区；数字千分位与百分比一位小数。
5. **§11 交互**：搜索占位符统一中文，⌘K/Enter/Esc 快捷键真实可用；连接态收进 header 右侧，移除浮动徽标；标识符/面包屑可点且键盘可达；icon 按钮补 `aria-label`、焦点环可见；<1200px 主动收起宿主侧栏并提供抽屉按钮；15s 轻轮询与「更新于 x 分钟前」指示在册。
6. **锁定模式（E1/E2）**：profile patch 按真实行 id 禁用 `plugin-manager`/`tool-plugin-manager`/`plugin-inventory`/`schedule`/`ui-schedule`/`settings-controller`/`entry-customization`；禁用行不注册 UI/Remote，精确 API 冷启动返回 404。保留 `workspace`/`workspace-controller`/`ui-workspace`/`session-controller`——它们是 Service project 与旧会话访问的必需面，禁用会级联删掉 `session/*` 与整个侧栏。CLI 侧 web profile 目录 root 属主+不可写，非 root `dsh plugin add` 在锁文件写入处 EACCES。
7. **fork 评估（E3）**：本轮需求均可用 Slots、profile patch、文件权限表达，未触发 `dsh-fork.md` §2。真实可折叠父子分组、替换宿主导航模型、或在禁用 Workspace 后仍保留 `session/*` 才需要 fork；本轮不申请、不执行 fork。

**L55 验收线（探针编号 L55-\*；探针=acceptance/loop-55.md）**：
- L55-01 主侧栏「核心控制台」九项：Slots 注册 9 个 `main`/`sidebar.panellist` 对；DOM 见分组标题与九项标记；Welcome/总览无重复语义；需求提案为第九项。
- L55-02 无第二列 nav：console 内容壳无 `#side-nav`/自有 sidebar；原生入口可点切屏；全部原 hash 深链可恢复；独立 proto `file://` 200。
- L55-03 原生 token：抽查宿主入口与控制台正文 font-size/line-height/color/background/border-radius 同 token；卡片 padding=16、gap∈{8,12,16}、图标 16px；深浅色继承宿主。
- L55-04 §11 A/B：总览首屏含审批入口；字号阶梯、4 基数间距、四类语义色、卡片统一、每屏主 CTA≤1、字体栈/tabular-nums/72ch/展开说明机读通过。
- L55-05 §11 C：三卡同高同基线；无 run/实例/事件空态文案+下一步；零实例无绿满格；无 run 无阶段条；阶段中文全称+图标；事件两行+计数 chip；相对时间+绝对时区；数字格式一致。
- L55-06 §11 D：中文搜索占位符与真实快捷键；连接态在 header 且无浮动徽标；标识符/面包屑互跳；焦点环/aria-label；<1200px 抽屉截图；轮询/最后更新时刻可见。
- L55-07 Service project：`GET /core-console/service-projects` 返回 cored Service 投影；POST 准备目录；dsh Workspace 出现 title=Service 名；console 新建会话后 `workspace.sessionIds` 含新 SessionId；旧会话仍可访问；Ungrouped/宿主全部列表折叠。
- L55-08 锁定 E1：profile 禁用行在 dump-config 中 `disabled=true`；侧栏无插件/自动化/设置入口；对应 `POST /api/pluginManager/*`、`/api/pluginInventory/*`、`/api/schedule/*`、`/api/settings/*` 返回 404（或热卸载 error envelope，本轮按冷启动 404 验收）。
- L55-09 锁定 E2：web profile root 属主、目录不可写；非 root `dsh plugin --profile core-system add <fixture>` 失败且不触外网。
- L55-10 fork E3：报告含逐项触发条件评估；结论=本轮不触发、不 fork；若验收发现必须改宿主行为，转 `NeedsHuman` 申请。
- L55-11 回归与红线：E0–E7 + 能力 A/B/D 只读/交互基线不回退；零 console error；六仓 build/test/lint 绿；探针零外发；不 enable 任何 workflow。
- L55-12 截图与报告：总览原生态、Service Workspace 归组、窄屏抽屉、锁定侧栏截图在 `acceptance/shots/loop-55-*.png`；报告含 deviations、提交号与「待人接管项」。


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

### 1.33 对账轮增量：派单批准动作面 console 动作化 + 判定源族收口（2026-11-26，loop-60 轮——§1.32 §11.5 余量第一段收口 + §11.7 queue-2 活体复核）

**缺口根因（loop-60 续跑对账，承接崩溃前在制品 workservice@d81cc60/plugin@de8ea9d）**：
- ①动作本体残留缺口（v0.58 首版 UI 活体实证）：`dispDecide` 动作 Apply 发 `content:''`——repository 面语义=content 须为可解析文档根（400「文档根须为映射」）；loop-59「零 content noop」词形对 repo 面不成立（API 探针用骨架原文才过，console 动作本体未随行）。
- ②判定源族缺口（GAP-Q60-2，queue-2 活体复核实证）：`SyncApprovals.Sync` 判定源只认 `workflow:approve|reject`；kind=proposal 派单行的判定走提案通路 `console:approve|reject`（proposalFlip fromDraft 翻转稿既有串）→ 批准投影恒 pending、spawn 恒零值（活体：console:approve 判定行在账 rv2 ok 而投影不判——探针留档 `probe/loop-60/data/l60-dispatch-prop.json`）。
- ③队列 2 语义勘定：**非缺口**——proposal.md 规则 2 批准=单一判定（console:approve 即派单判定，无第二动作面）；缺口在 cored 投影判定源族未收编 console 族。

**实现拓扑（v0.58a：workservice@604fb28 + plugin@f36f199）**：
- workservice `DecisionJudgmentFamilies` 判定溯源串族表单点声明（`workflow:approve|reject`+`console:approve|reject` 两族——两类判定主体=wf 派单动作族×proposal 派单提案判定族，判定词汇同一 approve|reject 零新词形）+`SyncApprovals.Sync` 匹配改族表判定（族外串零翻转锚定）+`DecisionAction` proposal 分支改提案判定通路（`console:*` 串+reasonRef=判定串单点拼装）。
- plugin 动作判定 Apply 原文随行：动作前 `LIVE.get('v1/objects/<kind>/<name>?scope=')` 现读（kind 判别=DecisionAction matchingKeyOf 同键）原文零变更随行=判定行照落照判定；dry-run 预检同载荷同原文；空串词形废除锚进测试。
- 派单卡动作行（v0.58 既有）=收口后唯一 proposal 派单动作面：批准/驳回=提案判定通路同款动作（零旁路），判定终态=词形 chips 无按钮。

**L60 验收线（探针编号 L60-\*；探针=acceptance/loop-60.md；UI 段 e60-ui 9/9 green）**：
- L60-01 dry-run 预检零副作用：动作 dry-run 200 `action=dry-run` ∧ 投影词形不翻转（预检≠判定）。
- L60-02 动作拍判定行在账：`/v1/history` 新增 `workflow:approve` ok/noop 行（同拍判定行喂 Sync——判定窗=动作返回拍）。
- L60-03 同拍投影翻转：派单行 `approval.state=approved` ∧ `spawn={declared:true, wired:false, target:apply-workflow, rv=判定行 rv}`（红线 a 机械锚——批准≠拉起）。
- L60-04 回链闭环：`/v1/inbox` 挂起行降位拍即生效（v0.58 已判过滤）；驳回通路对称活体（`workflow:reject` → rejected ∧ spawn 零值键 ∧ 挂起行降位）。
- L60-05 族表收口回归：`TestProposalDispatchConsoleFamilySync`（proposal 派单行 × console:approve 判定行 → approved ∧ spawn 声明全链——漂移即红）；族外串零翻转锚定。
- L60-06 UI 活体：wf 配置 tab 派单行 pending → 批准/驳回动作在册 → 确认弹窗（判定串+wired 恒 false 红线词形+dry-run 乐观锁预检）→ chips 原地翻转+按钮摘除（终态守卫）；proposal 提交态主动作（批准=console:approve 判定通路）→ 派单行 approved+spawn 声明收口词形；截图 6 张（`loop-60-inbox-before/wf-dispatch-actions/approve-modal/wf-after-approve/proposal-submitted/proposal-after-approve.png`）。

**实现余量（下轮顺延）**：cored-lint 挂起根因=loop-60 误将 `cmd/cored` 产物装入 `<部署根目录>/bin/cored-lint`（19:12 起）——已自纠（重建 `cmd/cored-lint`，`files=49 findings=0 mirror=ok`）；GOMAXPROCS=1 下 cored（服务器形）对本轮 docsRoot 规模疑有活锁，未深究（非本轮面）。插件仓 `core_system` submodule pin 停 v0.53=近几轮既有实践（部署=工作树软链不依赖 pin）。



### 1.34 对账轮增量：needsHuman Escalate 行 digest 尾随空串收口 + 触发路径 spec.enabled 实时 honoring（2026-11-26，loop-61 轮——§1.25 展示面余量收口 + §1.10 L78 E3 余量段收口）

**缺口根因（对账选点——§4 表全行已收口后的余量清单顺延）**：
- ①队列 1（loop-59/60 顺延）：`flowbind.BuildInbox` 事件行 digest=`e.Type + " · " + e.Involved` 字面量拼装——involved 缺席（空/纯空白）=「Escalate · 」尾随分隔符悬空（页面可读性余量；watchdog Escalate involved=Session 锚恒在册，缺席词形=人工注入/其他产源事件行）。
- ②队列 2 选点（§1.10 L78 E3 余量段明文「触发接线检查 spec.enabled=下一段」——loop-38 起最久 declared 顺延）：启停=Apply 闭环止于对象面+审计面——触发路径（dispatch 命中→StartRun 落 run）不检查 spec.enabled，enabled=false 的锚照落 run（workflow.md §1「关闭即该规则不再触发、不再消耗」语义在引擎面缺席）。
- ③队列 3 评估：插件仓 `core_system` submodule pin 停 v0.53（46d7041）——README 自declared 约定=「submodule 每次指向最新（不锁死旧版）」，pin 停已违背仓内自declared 契约 → 判定须统一，bump 至 workservice HEAD（v0.62 代）随行提交。

**实现拓扑（v0.58b+v0.62：workservice@32c5d87+@b5d5610）**：
- 队列 1：`inboxDigestOf` 单点拼装 helper——involved 缺席=降级词形「`<Type> · （involved 缺席）`」，在册=既有词形不变；NeedsHuman/Escalate/ApprovalNeeded 三处事件行同款随行（零字面量散用）；纯展示面零判定语义（EventID 深链/类归属/机读判据全不变）。
- 队列 2：`internal/workflow/enabled.go`——`EnabledResolver`/`EnabledFunc` 判定面+`EnabledOf` 生效值纯映射（precedence=系统层 override 优先字典序首个→global 本体→零对象=缺省启用——与 `/v1/workflows` 聚合面 `effectiveObject` 同口径零双源漂移；未声明/不可解析=缺省启用 scheme.yaml `(=true)` 同源；判定缺席 ok=false=放行缺口可见不静默拦）；`RunOptions.EnabledRules`（Specs/Brakes 同款可选能力——缺省 nil=零闸既有行为面零翻转）+`StartRun` 受理路径闸判（enabled=false 锚=触发留痕仍在、run 不落、`disabled` 计数可见；判定在锁外解析面文件 IO 不持 r.mu——刹车生效值同拍面；在途 run 迁移判定零改动——ResumeSignal/Advance 不受开关作用，已完成轮次与回归记录保留）+`RunState.Disabled` 新载荷键（代际判别器）+`GET /v1/workflows/runs` disabled 键随行+装配层 `workflowEnabledResolver` 注入（`workflowDocObjects` 装配侧查找单点与 `workflowDocLookup` 共用——零缓存 apply 落库即生效热装载跟随）。

**L61 验收线（探针=acceptance/loop-61.md；UI 段 e61-ui 3/3 green）**：
- L61-01 digest 降级词形：Escalate involved='' 注入 → `/v1/inbox` 行 digest=`Escalate · （involved 缺席）` ∧ 无尾随分隔符悬空 ∧ `link=#/event/<eventId>` 深链不变 ∧ 类归属不变；历史空 involved 行同拍投影自愈；单测锚定 involved 有/无/纯空白三词形（回潮即红）。
- L61-02 enabled 闸三拍活体：precedence 放行拍（global:false ∧ override:true → 注入×3 全落 run ∧ disabled=0）→ 闸拦拍（override 翻 false → 注入×3 全拦 ∧ disabled 0→3 ∧ anchorRuns 恒值 ∧ started+1=flip 自身对账 run 如实入账）→ 复位放行拍（override 翻 true → anchorRuns+1 ∧ disabled 恒值——零缓存热装载 apply 落库即生效）；单测=拦/放行/判定缺席/precedence 四态+在途 run 迁移判定零改动。
- L61-03 UI 活体：收件箱屏降级词形行在册 ∧ 尾随分隔符行=0 ∧ involved 在册词形零回归；wf 聚合面 effective.enabled（override 生效词形）× runs disabled × anchorRuns 三面同源；截图 2 张（loop-61-inbox-digest/wf-enabled-agg.png）。

**实现余量（下轮顺延候选）**：object 触发声明（spec.triggers）不入 dispatch 订阅集合（订阅=scheme.dispatch 推导既有口径——对象级触发声明面随 connector watch 声明面扩展顺延）；E5b chat-backfill 已有 status 块结构化合并（§1.11 补注④ declared 在位——**loop-62 收口，见 §1.35**）；E6 泳道 approval 积压族扩 DocReview/Proposal 类（§1.13 declared 注记原样——**loop-62 积压族收口，见 §1.35**）。宿主 `/core-console/api` 代理不转发 POST（注入探针直打 cored loopback——loop-51 套路，探针纪律注记随行）。

### 1.35 对账轮增量：E5b chat-backfill 结构化合并收口 + E6 审批积压族扩与收件箱族内落点分化（2026-11-26，loop-62 轮——§1.11 补注④ 余量摘除 + §1.13/§1.25 积压族收口）

**缺口根因（对账选点——§1.34 余量注记顺延，点火队列顺序执行）**：
- ①队列 1（E5b，§1.11 补注④ declared 余量）：console 新建会话回填 `Agent.status.currentSession` 的写面在「Agent 文档已有 status 块」时**诚实跳过**（toast「currentSession 未回填（诚实余量）」）——已有 status 块的 Agent（生产 docsRoot 现状=core-headless agent.yaml 即是）在 console 新建会话后身份回填缺席，agent-comm 文档面 to 解析（status.currentSession.id 回填体）与归属过滤三层证据①沿旧值漂移。
- ②队列 2（E6，§1.13 余量注记 declared 原样）：事件流聚合面板「审批积压」计数=ApprovalNeeded 归档行单源——submitted 提案（v0.51 读面）与派单批准投影 pending 行（v0.56/0.57 读面）不入族；收件箱 ApprovalNeeded 族内条目落点=类级审批屏单一落点，dispatch 行的批准动作面（wf 详情配置 tab，v0.58 动作化屏）不可直达。
- ③评估项（声明面只评估，零改动）：object 触发声明面（spec.triggers 不入 dispatch 订阅集合——订阅=scheme.dispatch 推导既有口径，随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（workflow-runtime.md §11.2 余量行——红线 a 域，真实拉起仍 deferred）。

**实现拓扑（零 Go 改动——plugin 客户端面单仓收口）**：
- 队列 1：`mergeCurrentSession` 结构化合并纯映射（console-chat.js 导出 `__CC.chat.mergeCurrentSession`——DOM 无关 node --test 确定性）——三分支：①无 status 块=文末追加最小块（既有词形）；②有块无 currentSession=块内追加键组；③有 currentSession=子块**键级重写**（id/startedAt 翻新、docsLoaded 保位归零、其余子行原样保留）。零盲写红线=纯文本手术非 yaml 重编码（status 块外字节恒等）；同参回放=幂等 noop 词形（apply 面零新 rv）；预读口径缺席（无 metadata.name / tab 缩进）=ok=false 诚实降级不盲写（余量词形收窄为该形态）。调用点 `backfillCurrentSession` 改接线：结构化合并→既有 apply 通路（fieldManager=`console:chat-backfill` 不变、rv 乐观锁不变）；回执 `action=noop`（apply.md rule 1 幂等重入）=toast「幂等 noop · 同值零盲写」词形。
- 队列 2：`approvalBacklog()` 积压族单一真相函数——族=ApprovalNeeded 归档行 ∪ status=submitted 提案 ∪ 派单批准投影 pending 行三源（既有读面族语义扩展，零新写路径）；第三源行集=派单受理投影 `/v1/agents/dispatches`（v0.56/0.57 approval 键所在面——live 层既有 GET 读面新增快照键 `dispatches`；runs 面不载 approval 键，探针活体实证修正）；事件流聚合面板「审批积压」行消费族总数+族构成词形标注（三源分解可见+操作面落点：审批屏/提案详情/wf 配置）；`inboxOpOf` 类内落点分化：ApprovalNeeded ∧ kind=dispatch|dispatch-legacy → `wf/:name` 详情配置 tab（cored link=`#/wf/<锚>` 原值不改写，client 预置 `S.wfTab[<锚>]='config'` 后 go()——落地即动作行可见；tab 判据锚 `data-cc-inbox-tab`）、其余归档行=cored link 原值深链（对象编辑器屏）——计数与详情页解析同一函数无双源。

**L62 验收线（探针=acceptance/loop-62.md；UI 段 e62-ui 4/4 green）**：
- L62-01 结构化合并活体：既有 status 块 Agent（core-headless）经 console 新建会话 → `GET /v1/objects/Agent/core-headless?scope=global` content 的 `status.currentSession.id=<新 SessionId>` ∧ rv 前进 ∧ DocApplied 归档在册（fieldManager=console:chat-backfill）∧ 其余字段零盲写（spec 面/mount 声明逐字节保留——diff 只含 currentSession 增量）。
- L62-02 幂等 noop：同值回填重放 → apply 回执 `action=noop` ∧ rv 恒值（apply.md rule 1 幂等重入零提交零事件）；单测锚定三分支（有块键级更新/无块追加/有块无键块内追加）+同参回放幂等+未知子键保留+预读缺席两词形（回潮即红）。
- L62-03 积压族活体：事件流聚合面板「审批积压」=三源和（族构成词形标注在册）；单测锚定三源消费词形（回潮即红）。
- L62-04 UI 活体：chat 屏新建会话 toast=「已回填」族词形（余量词形摘除）∧ 事件流聚合面板积压族行在册（三源构成词形）∧ 收件箱 ApprovalNeeded dispatch 行落点=wf 详情配置 tab 活体（点行落地 `#/wf/<锚>` ∧ 配置 tab 激活 ∧ 批准/驳回动作行在册——动作本体不点=探针零判定副作用）；截图 4 张（loop-62-chat-backfill/backlog-family/inbox-dispatch/wf-config-actions.png）。

**实现余量（下轮顺延候选）**：object 触发声明面（spec.triggers 订阅集合——随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（workflow-runtime.md §11.2 余量行——红线 a 域，只随 agent-session 域落地轮评估）；E6 泳道族 DocReview 归档类行（本轮积压族已收 Proposal+派单两源，DocReview=草稿缓存行与 ApprovalNeeded 归档行已共屏审批——聚合面板族口径维持三源，DocReview 行深链已走类内落点——**loop-63 核验收口，见 §1.36**）。

### 1.36 对账轮增量：E6 泳道族源分化核验收口——积压族四源分解+族总数单点+DocReview 行真操作面补缺（2026-11-26，loop-63 轮——§1.35 余量注记第一候选核验）

**核验选点（对账——§1.35 余量注记顺延，点火队列顺序执行）**：E6 积压族三源（ApprovalNeeded 归档∪submitted 提案∪派单 pending）收口后，DocReview 类（草稿缓存行）与族的关系待核验——聚合面板族构成词形与草稿行实际操作面在「草稿在册」活体窗的词形一致性。对账结论：**族实为四源，词形只标三源**——`approvalBacklog()` 的归档项实为 `pendingApprovals()`（草稿∪归档两子源，§1.13 待审区口径）整集计入，`st.drafts` 草稿子源已入族但族构成词形未分化标注；顶部常驻入口（审批 badge/updateCounters/palette/Welcome「待审批」卡）只数 `pendingApprovals()`——提案与派单两源计数缺席，与聚合面板族总数双源漂移。**探针活体新缺口（acceptance 纪律「缺陷即修」）**：新对象首稿（草稿先于文档面落库——发现路径全走 DocReview 类）在编辑器屏落「对象不在册」死面——screenEditor 在册守卫只认文档面 ref，`hydrateEditor` face GET 404 即整链 reject；DocReview 行 cored link=`#/doc/…`（inboxDocLinkOf 编辑器屏深链）在该窗=真死链。

**实现拓扑（零 Go 改动——plugin 客户端面单仓收口）**：
- ①族源分化：`approvalBacklog()` 四源分解单一真相——`drafts=st.drafts.length`（DocReview 收件箱类同源读面）+`archive=pendingApprovals() filter kind==='event'`（归档子源单出——drafts∪归档两子源分化，§1.13 待审区口径零变更）+submitted+dispatchPending 既有两源；聚合面板族构成词形四源标注（「族=草稿待审（DocReview）N ∪ ApprovalNeeded 归档 N ∪ 提案 submitted N ∪ 派单待批 N」+落点「审批屏∪编辑器/提案详情/wf 配置」）。
- ②族总数单点：`backlogCount()=approvalBacklog().total` 单点函数——顶部常驻入口（审批 badge=updateCounters/__CC.approvalCount、palette 积压行、Welcome「待审批」卡值+note「四源积压」词形）全部换线同一函数（原先只数两子源=提案/派单计数缺席收口）。
- ③DocReview 行真操作面补缺（两段）：screenEditor 在册守卫增**在册稿窗降级草稿基座**（`!ref && draftRowOf(kind,scope,name)`→渲染编辑器壳——draft-only 工作副本；非稿缺席=既有不在册词形零变更，URL 手输名不冒充创建窗）；`hydrateEditor` face GET 404 在册稿窗=**不拒单降级基座**（face 缺席词形入信封 `{status:404,content:''}`——`faceAbsent` 会话态+rev chip「面缺席（在册稿基座——Apply=创建通路）」词形；E4 乐观锁/dry-run 三检查/dock 词形零变更——baseRV=稿 baseResourceVersion，draft-only 稿 Apply 落库=创建通路语义）；审批屏 header 注记「已批 N 稿不出现」（已批稿=草稿缓存清空——缺口可见性词形）；inboxOpOf DocReview 行 tag=「审批屏（草稿行深链=编辑器屏双落点）」、收件箱屏 dh-sub 与 INBOX_CLASS_META why 词形随行（cored link 原值不改写——红线 2）。

**L63 验收线（探针=acceptance/loop-63.md；UI 段 e63-ui green）**：
- L63-01 草稿在册活体：探针稿（fieldManager=`probe:loop-63`，对象=WorkService/global/l63-docreview-probe）经 `/core-console/drafts` 落稿 → 聚合面板「族=草稿待审（DocReview）1 ∪ …」四源分解词形在册 ∧ 收件箱 DocReview 行在册 ∧ cored link=`#/doc/WorkService/global/<锚>` 原值（非 `#/approvals`——核验点）。
- L63-02 草稿行真操作面：点行落地编辑器屏（非「对象不在册」死面）∧ 工作副本载稿 ∧ 草稿 tab apply dock enabled ∧「Apply（1 处变更）」词形（动作本体不点=探针零副作用）。
- L63-03 族总数单点：`__CC.approvalCount`=四源和（聚合面板分解四项算术和逐值对账）∧ badge 同值 ∧ Welcome 卡 note「四源积压」词形（旧「需要你处理」词形摘除）。
- L63-04 探针零副作用+归零诚实窗：DELETE 弃稿 → 草稿子源回基线（API 双读+事件屏词形双判）∧ DocReview 行消失 ∧ 无稿窗 `drafts=0` 归零诚实（badge=族总数不含草稿源）；锚对象零 apply 零事件（apply_log 零新增行）；UI 全程零 pageerror。

**实现余量（下轮顺延候选）**：object 触发声明面（spec.triggers 订阅集合——随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（workflow-runtime.md §11.2 余量行——红线 a 域，只随 agent-session 域落地轮评估）；E5a 冷会话空窗余量（§1.11 补注② declared 在位——**loop-64 评估维持 declared，见 §1.37 评估段**）；draft-only 稿 Apply 创建通路活体（本轮探针动作零点=零副作用纪律，通路语义已锚——随编辑器域轮活体化）。

### 1.37 对账轮增量：E5b chat-backfill 结构化合并余量词形收口——缩进自适应（混合缩进容忍）+ E5a 冷会话空窗余量评估（2026-11-26，loop-64 轮——§1.35 余量注记顺延第一候选）

**核验选点（对账——§1.35 余量注记顺延，点火队列顺序执行）**：`mergeCurrentSession` 结构化合并（§1.35 收口）预读口径缺席窗=「无 metadata.name **或** 全文任一行 tab 缩进」——tab 防御为整篇拒绝闸。手编 docsRoot 实形态（生产 Agent 文档现样=core-headless agent.yaml：connectorOps list 内嵌行首 tab 缩进，锚定块=2 空格）在该窗被误判缺席→结构化合并降级不回填——身份回填在混合缩进文档上缺席，agent-comm 文档面 to 解析（status.currentSession.id 回填体）沿旧值漂移。同窗余量：锚定块缩进宽硬编码 2 空格单值——全 4 空格缩进文档（YAML 合法词形）的追加分支产出与文档词形不对齐的键列。

**实现拓扑（零 Go 改动——plugin 客户端面单仓收口，纯映射语义零变更）**：
- ①缩进基准自适应：`ind`（锚定基准）=首个空格缩进非空行观测（ind=2|4 自观测，不再硬编码 2 空格单值）——首块缩进宽=锚定基准；追加分支（无 status 块文末追加/块内追加）键组缩进=基准×2，与锚定块词形族谱对齐。
- ②tab 防御闸收窄（缺席窗收窄）：整篇任一行 tab 拒绝 → **手术区限定面**（仅 status 块含 currentSession 子块的行首 tab=保守拒绝不盲写；文档其余部分（list 内嵌行等）tab 与本次手术零交=放行）。
- ③currentSession 子块成员识别=**纯列宽模型**（cs 键列宽=ind，其下任意更深列=成员区；首个 ≤ind 列非空行=子块终止——缩进族谱任意键宽各自处理）；身份三键清洗=按相对深度（任意空格深的 id/startedAt/docsLoaded——旧值行缩进宽与锚定基准无关）；重写键组缩进=**成员缩进观测**（缩进族谱对齐：同层键须同列=合法 YAML 词形；族谱多态=成员键宽各行不一（嵌套续行/脚踩）→ 保守拒绝不盲写；空子块=回退锚定基准（既有「cs 键在册无值」词形行为零回归））。
- ④纯映射语义零变更：零盲写=块外字节恒等；同参回放=幂等 noop；键级重写/块内追加/文末追加三分支不变；调用点通路零变更（fieldManager=`console:chat-backfill`、rv 乐观锁、apply.md rule 1 幂等回执词形不变——仅缺席 toast 注记词形随窗收窄）。

**L64 验收线（探针=acceptance/loop-64.md；单测=chat.test.ts L64 段 4 锚）**：
- L64-01 缺席窗收窄：混合缩进文档（生产词形=锚定块 2 空格+list 内嵌行首 tab）回填 ok=true ∧ 锚定块外字节恒等 ∧ 手术区外 tab 行原样保留（零盲写）。
- L64-02 缩进族谱对齐：全 4 空格文档重写分支新键组=8sp ∧ 追加分支=4sp 键+8sp 三键（锚定基准×2）∧ cs 键缩进分家（6sp 成员）=族谱内回填。
- L64-03 真缺席恒拒绝：无 metadata.name ∧ status 块或 currentSession 子块含 tab=ok=false 原文零改写（缺席窗下界不变）；族谱多态/嵌套续行=保守拒绝。
- L64-04 活体+UI：core-headless（生产 Agent 文档现形态）回填 rv 前进 ∧ 零盲写 diff ∧ 同值幂等 noop ∧ 既有 L62 探针锚零回归（2 空格单值词形）∧ UI 判据走 Playwright+截图。

**E5a 冷会话空窗余量评估（队列 2——零改动判定，§1.11 补注② declared 在位维持）**：评估结论=**维持 declared，零改动**。理由：①空窗词形=诚实降级既有口径（native 会话视图承载全史，console 深链历史如实标注同源余量；loadOlder 显式补拉已接仍空窗=UI 不冒充）——判据链无假面；②回填全史须 dsh session store 提供历史页回放读面——宿主读面（`ctx.remote.session.page`）现状=事件页游标（增量向前），历史回放面=宿主本体能力缺席，非 console 客户端可闭环（dsh-fork.md §2 触发条件未达：非「宿主能力已声明但插件不可达」——是宿主本体无该读面，不构成 fork 事由）；③成本/收益：冷会话全史回放仅影响「console 深链历史」单点展示（native 视图承载全史可用），改动须扩宿主协议面=跨域增量，不属 E5a 域。评估不改 declared 口径，不冒充收口。

**实现余量（下轮顺延候选）**：object 触发声明面（spec.triggers 订阅集合——随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（workflow-runtime.md §11.2 余量行——红线 a 域，只随 agent-session 域落地轮评估）；draft-only 稿 Apply 创建通路活体（§1.36 余量——随编辑器域轮活体化）。

### 1.38 对账轮增量：E6 四源积压词形单点复核——族构成声明单点收口 + draft-only 稿 Apply 创建通路活体评估（域内判据集实施）（2026-11-26，loop-65 轮——§1.36/§1.37 后现势复核，编辑器域顺延首候选）

**核验选点（对账——点火队列顺序执行）**：①积压族「四源积压」词形与 §1.37 后现势复核：`backlogCount()` 族总数单点（§1.36 收口）四消费点（审批 badge/updateCounters、palette 积压行、Welcome 卡值+note、聚合面板族构成行）现势=计数同源在位（同一 `approvalBacklog()` 族总数，无双源回潮）；漂移在**文字词形维度**——族构成词形三处字面量散用（Welcome note「四源积压（草稿/归档/提案/派单）」/palette「族总数四源」/聚合面板「族=草稿待审（DocReview）…」），任一处改族构成（如增第五源）须三处同步=双源漂移温床。②draft-only 稿 Apply 创建通路活体评估（§1.36 余量——编辑器域顺延首候选）：通路语义已锚（降级基座+dock enabled 活体 loop-63 实证），Apply 动作活体=真落库动作（once-only）——评估域内可行性并实施最小活体判据集。

**实现拓扑（零 Go 改动——plugin 客户端面单仓收口）**：
- ①族构成词形单点：`backlogFamilyNote()` 单点声明（short=`草稿/归档/提案/派单` ∧ long=`族=草稿待审（DocReview）`）——Welcome note/palette/聚合面板三消费点改单点拼装，渲染词形逐字节恒等（纯映射重构零语义变更）；族构成变更从此单点随行。
- ②draft-only 创建通路最小活体判据集（专用探针锚域内，零副作用域）：A 段=缺席窗诚实（锚无稿 404∧无面 404）→ 落稿（baseResourceVersion=0 创建稿，drafts POST `{"action":"staged"}` 词形）→ dry-run 三检查（apply 闸门既有面判定零改动：admit ①scheme②权限+缺席对象 dry-run 回执 `RV:0 Action:"dry-run"` 将创建哨兵——apply.go 既有词形，非本轮新增）∧ 同参幂等回放 → 零副作用反证（drafts 锚行恰 1 ∧ 对象面仍 404 ∧ apply_log 锚行=0）；B 段（UI）=faceAbsent 窗 rev chip「面缺席（在册稿基座——Apply=创建通路）」∧ 草稿 tab dock enabled ∧ dry-run 弹窗三检查 ✓（lock 行=「r0 == 面上现值（可落）」哨兵词形）∧ 确认键解锁（预检过才 enabled）∧ 零确认收尾（弃稿 DELETE → drafts 锚行=0 ∧ 对象面恒 404）。真落库终末点（「确认 Apply」一次点击）=once-only 真实动作，本轮零点——判据集在案 declared 登记，执行另轮决策。

**L65 验收线（探针=acceptance/loop-65.md；单测=inbox.test.ts L65 段 1 锚）**：
- L65-01 四消费点同源活体：Welcome 卡值=__CC.approvalCount ∧ note=拼装词形 ∧ palette 行同值同词形 ∧ 聚合面板族构成实数和=族总数=badge（1+11+1+1=14 活体）。
- L65-02 词形单点锚定：backlogFamilyNote() 在册 ∧ 三消费点单点拼装（正则锚）∧ 短/长词形字面量唯一 ∧ 渲染面零散用（回潮即红）。
- L65-03 dry-run 创建哨兵活体：锚域内 action=dry-run ∧ rv=0 ∧ 幂等回放同回执 ∧ apply_log 零判定行。
- L65-04 draft-only 窗 UI 活体：rev chip 降级基座词形 ∧ dock enabled ∧ 弹窗三检查 r0 哨兵词形 ∧ 零确认零落库 ∧ 弃稿回基线（drafts=0 ∧ 对象面 404）∧ 零 pageerror ∧ 截图。

**队列 3 余量对账（零改动判定）**：object 触发声明面（spec.triggers 不入 dispatch 订阅集合——grep 实证 flowbind 零词形命中，随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（红线 a 域，spawn wired 恒 false 零改动）；E5a 冷会话空窗（宿主读面现势零变化——§1.37 评估段维持 declared）。submodule pin=b5d5610=workservice HEAD 自然满足。

**实现余量（下轮顺延候选）**：draft-only 稿 Apply 创建通路**真落库执行拍**（判据集已锚 §1.38——专用锚域内 once-only：落稿→dry-run→确认→rv=1→DocApplied→账本留痕→弃稿验证清稿词形→锚留账收尾，随编辑器域轮）；object 触发声明面（随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（红线 a 域）；E5a 冷会话空窗（declared 维持）。

### 1.39 对账轮增量：draft-only 稿 Apply 创建通路真落库执行拍（§1.38 余量首候选——判据集在案 once-only 执行）（2026-11-26，loop-66 轮——§1.38 余量注记第一候选执行，编辑器域判据集闭环）

**核验选点（对账——点火队列顺序执行）**：§1.38 declared 登记「draft-only 稿 Apply 创建通路**真落库执行拍**」（判据集已锚——专用锚域内 once-only：落稿→dry-run→确认→rv=1→DocApplied→账本留痕→幂等复跑→锚留账收尾）本轮执行。通路=既有面零新代码（client 编辑器 apply dock 通路+宿主 `/core-console/apply|drafts` 既有路由+cored 既有 apply 写面——零 Go 改动零 plugin 改动，执行拍=判据集在既有实现上的活体走通）。专用探针锚 `l66-apply-probe`（kind=Agent scope=global；真落库锚对象不删=判别面语义注记域，点火队列明示授权）。

**执行拍实录（L66 验收线=探针 acceptance/loop-66.md；判据三段）**：
- 创建拍（API，e66-prep.mjs）：缺席窗诚实（无稿 404∧无面 404）→ 落稿 baseRV=0（`{"action":"staged","baseResourceVersion":0}`）→ dry-run 三检查（`action=dry-run ∧ rv=0` 创建哨兵∧幂等回放）→ 确认 Apply 真落库（fromDraft 非 dry-run 同载荷）→ `action=create ∧ rv=1` ∧ 回执 `event.type=DocApplied ∧ dedupKey=apply:<obj>:1`（eventId 同源）→ 落库四件对账（object 200 rv=1 ∧ apply_log 判定行 `r1 ok console:editor:agent/<锚>` ∧ event_log DocApplied 锚行=1）→ 稿清（rule 6：draft 404∧清单锚行=0）→ 幂等复跑拍（同正文二次落稿再真落库→`action=noop ∧ rv 恒=1` ∧ noop 行在账∧noop 亦清稿∧DocApplied 恒零新增）→ 无稿 apply=404 ErrNoDraft（`draft: 草稿不存在`）。
- UI 拍（e66-ui-verify.mjs）：编辑器活体（创建后窗 rev chip=r1∧「在册」badge）→ 手动编辑程序化落稿（chip「● 未 Apply（草稿 N 处变更）」∧ dock「Apply（N 处变更）」enabled）→ dock 弹窗三检查 ✓（lock 行=「r1 == 面上现值（可落）」**更新哨兵词形**）→ **确认键真点**（once-only）→ toast「已落库 r2（Revision+1）」。
- 终态复核（e66-final.mjs）：面 rv=2 恒 ∧ 稿清归零 → noop 复跑拍（对现面正文）→ `action=noop ∧ rv 恒=2` → 账本终态 apply_log 锚行=4（`noop:r2|ok:r2|noop:r1|ok:r1`——rv 降序∧同 rv 时刻降序=QueryApplies 既有机械序）∧ DocApplied 锚行=2（create+update；noop 恒零事件——防自我唤醒活体）→ UI 读活体（rev chip=r2 ∧ dock「Apply（无变更）」disabled=**noop 结构守卫词形** ∧ 历史 tab noop 顶行）。

**结构发现（判据词形校准两件——后续轮判据词形权威）**：①落库正文=稿正文∪`resourceVersion: N` 反写行（仓库写路径 rv 反写规范词形；缩进恒 2sp 与 loop-64 结构发现一致）——内容恒等判据落点=稿正文∪rv 反写行，非逐字节全等。②**UI 确认通路拍语义=dock 差异武装 ⇒ 只产 update**：编辑器手动编辑产生真实差异≠面上正文，确认键真点=rv 前进（Revision+1 toast）；**UI 侧 noop 结构不可达**（「Apply（无变更）」disabled+ACTIONS['doc-apply'] 空稿守卫「空草稿——无操作」零旁路=人点屏障面）——noop 词形活体由 API 复跑拍承载；§1.38 判据「noop 恒值或 ErrNoDraft 404 词形」两分支均活体在账（noop×2+ErrNoDraft×2）。

**队列余量对账（零改动判定）**：object 触发声明面（grep 实证 spec.triggers 零词形命中 flowbind——随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（红线 a 域维持 declared）；E5a 冷会话空窗（宿主读面现势零变化——维持 declared）；submodule pin=b5d5610=workservice HEAD 自然满足。**§1.38 余量首候选摘除（执行拍完成）——编辑器域余量后延候选=rev-content diff 面（历史 tab「点行 diff 上一版」如实标注维持）/落库 rv 反写行 UI 呈现。

### 1.40 编辑器域增量：历史 rv 正文读面（rev-content diff 面）——「点行 diff 上一版」余量当轮收口（2026-11-26，loop-67 轮——§1.39 余量首候选三路评估，判定②域内可实施）

**核验选点（对账——点火队列顺序执行）**：队列 1 三路评估——①宿主 GET `/core-console/api` 只透传 GET ∧ cored 侧无 rv 读面（现势 grep 实证 `v1/history` 唯一史面=apply_log 流水投影，无按 rv 取正文面）→ 若不可域内闭环则读面缺口评估顺延；②若判定域内可实施（如复用 git 后端读面开只读 rv content 投影）则最小实施+活体；③无据顺延不立。**评估实录（判定②）**：git 后端写路径既有面实证——每次 ok apply=一次 git commit（applyWrite 留痕段 `<fm> <action> <key> [reason]`）、blob 即含 `resourceVersion: N` 反写行（§1.39 判据词形校准①同源）⇒ **rv→commit 机械可寻址**，快照读面=纯读 git 裸库（`git log -- <rel>` 文件限定+`git show <sha>:<rel>`），零新持久状态零双源（渲染数据无双源红线 §5 规则 2）；宿主代理只透传 GET=只读面恰合（零写语义暴露）；非 fork 事由（dsh-fork.md §2 未达——cored+plugin 两仓域内即闭环）。

**实现拓扑（读半边 Go+消费半边 plugin——cored v0.62→v0.63 换代，loop-62…66 连续零 Go 改动后首代换代）**：
- ①Go 读半边（workservice v0.63）：`GitRepo.RevContent(ctx,kind,scope,name,rv)`——快照语义=该对象「**最新携带该 rv 反写行的提交**」时点正文（候选=git log 文件限定=对象自身历史∪手编 docsRoot 通道提交；**blob 元数据 resourceVersion=唯一 rv 判据**——提交消息不含 rv，防消息词形漂移错配；文末换行逐字节恒等=gitRaw 未修剪 stdout 通路）；`repository.ErrRevNotFound` 分立词形（与对象缺席 ErrNotFound 分立——审计不冒充）；noop 零提交/篡改零 rv→快照缺席恒可达=诚实词形；读面零副作用零写路径。apiserver `GET /v1/rev-content/{kind}/{name}?scope=&rv=`（200 快照词形 kind/scope/name/rv/content/source=git-backend；rv 缺席/非正整数=400；快照缺席=404 ErrRevNotFound；face 缺席=503 防御面——sqlite 后端诚实降级；旧构建 405=代际判别器）+`WithRevContent` 口面（具体方法不占冻结 Repository 签名——ApplyLogFace 同款）+装配 git 后端恒注入（type 断言 store2）。
- ②plugin 消费半边（v0.67）：`hydrateHistory` ok 行可点（`data-act="hist-diff"` data-rv/data-prev=投影行集内下一 ok 行——rv 降序 noop/审计行不产 rv 零位跳；起点行「对象起点（create，无上一版）」如实词形）+`hist-diff-box` diff 呈现面板（单处开合复点换内容；rev-content 读面现读=GET 快照零缓存；读面退化行内如实降级不冒充；r1=create 全文首览词形）；旧「点行 diff 上一版=rev-content 面余量（git show 面未开，如实标注）」自贬标注摘除（已收口不再自贬）。

**L67 验收线（探针=acceptance/loop-67.md；单测=workservice rev_content_test.go×2 五锚+plugin live.test.ts L67 段 1 锚；探针终拍 27/27）**：
- L67-01 部署判据：既有生产对象（core-headless）rv=1 快照 200 ∧ 快照 rv 反写行在册 ∧ 既有读面零回归；core-system `/proc` exe 判据=v0.63 代（旧代 b374e5a500420037→换代）。
- L67-02 缺席窗诚实：锚无面 404 ∧ 锚 rv=1 快照 404 ErrRevNotFound 分立词形。
- L67-03 锚域创建拍→快照域对账：create rv=1 → rv=1 快照 200 ∧ **逐字节=落库面（文末换行在册）** ∧ rv=2 缺席 404。
- L67-04 第二拍+历史不可变：语义差异 update rv=2 → rv=2 快照 200 ∧ rv=1 快照恒=第一拍词形。
- L67-05 点行 diff 判据（读面域）：两版快照分立 ∧ rv 反写行各自 1/2。
- L67-06 noop 复跑拍：同现面正文 → noop ∧ rv 恒=2 ∧ apply_log 锚行=3（`noop:r2|ok:r2|ok:r1`）。
- L67-07 UI 活体：历史 tab ok 行可点 ∧ 顶行 rv=2 ∧ noop 行不可点 ∧ 点行 diff 面板「r2 ← r1 · rev-content 读面现读（git 权威正文快照）」∧ add/del 行在册 ∧ 起点词形 ∧ 零 pageerror ∧ 截图。

**结构发现（判据词形校准——后续轮判据词形权威）**：①手编 docsRoot 通道=快照语义裁决——候选若限写路径消息键段，手编保 rv 修改被跳过→快照回退 apply 时点 blob（陈旧）→diff 对现读面失真；定案=「最新携带该 rv 反写行的提交」（手编保 rv 修改属于该 rv 状态；单测首拍按键段过滤实现误判 FAIL 即校准）。②rev-content 快照含文末换行（gitRaw 未修剪 stdout——TrimSpace 破坏逐字节恒等判据；既有 git() 调用点零迁移）。

**队列余量对账（零改动判定）**：object 触发声明面（spec.triggers 零词形命中——随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（红线 a 域维持 declared）；E5a 冷会话空窗（宿主读面现势零变化——维持 declared）；落库 rv 反写行 UI 呈现（meta tab rv 词形+历史 tab rv-no 直读在册——零缺口零改动）。

**实现余量（下轮顺延候选）**：object 触发声明面（随 connector watch 声明面扩展顺延）；watch-only 自监控闭环/developer-system 代码化调用（红线 a 域）；E5a 冷会话空窗（declared 维持）；编辑器域新增余量=无（rev-content diff 面收口后历史 tab 判据链完整）。

### 1.41 对账轮增量：cored-bridge.md §2 随行补记 rev-content 读面 + docsRoot 探针残留清场（§5 清场纪律执行）（2026-11-26，loop-68 轮——标准对账选点轮：队列 1 零变化判定+队列 2 文档面增量）

**核验选点（对账——点火队列顺序执行）**：队列 1 余量现势复核三项全**零变化判定**——①object 触发声明面：spec.triggers 在 flowbind 零词形命中（grep 实证零变化）∧ dispatch 订阅集合=表驱动（`/v1/triggers` types=["*"] 活体在运）；②watch-only 自监控闭环/developer-system 代码化调用（workflow-runtime.md §11.2 余量行——红线 a 域，spawn wired 恒 false 机械锚在运）；③E5a 冷会话空窗（宿主读面现势零变化——§1.37 评估维持 declared）。队列 2 现势复核出**一项文档面缺口=当轮增量**：rev-content 读面（loop-67 新面）已随 cored v0.63 在运+plugin v0.67 消费，而 cored-bridge.md §2 GET 端点清单**无 `/v1/rev-content` 行**——桥契约文档缺口（cored-bridge.md §2 是 console 读面契约的权威清单），非运行时缺口（面已在运活体）；判定=文档随行补记当轮收口（「改文档先于改代码」§5 规则 1 的文档域对账件）。队列 3：submodule pin=d3b6930=workservice@6853803（loop-67 已 bump——本轮 workservice 零提交=维持零改动）。

**实现拓扑（零 Go 改动零 plugin 改动——纯文档面增量+部署侧清场执行）**：
- ①cored-bridge.md §2 补记 `GET /v1/rev-content/{kind}/{name}?scope=&rv=` 行（词形族全量：200 快照词形 kind/scope/name/rv/content/source=git-backend/400 rv 词形/404 ErrRevNotFound 分立/503 face 缺席/405 代际判别器；快照语义=「最新携带该 rv 反写行的提交」+rv 判据=blob 元数据反写行+正文含文末换行+只读纯考古零写路径）+§1 文档存储后端行随行 **v0.63 在运代注记**（真实 sha/rev 记部署台账不入公开仓——R-PUB-3）。
- ②docsRoot 探针残留清场（console-adoption.md §5 清场纪律首执行——巡检 2026-11-26 发现）：`global/agents/{l59…l67 锚 5 件}+l64-ind4-anchor`、`global/proposals/l60-*11 件`、`global/workflows/l59-spawn-probe`、`systems/self-recursive-core/{connector-ops/l59+l60-*13 件+l62-backlog-probe,workflows/l60-*11 件+l62-backlog-probe}` 共 **43 件**移除+手编 docsRoot 通道 git commit（提交词形 `probe:loop-68 sweep remove…`——非 console:editor 前缀=不经 apply 管线零 DocApplied 零字段管理语义，与 loop-67 判据词形校准①手编通道同源）；**ops DB 账本不删**（apply_log/event_log 判定行与事件行在账=判别面语义注记——清场只净对象面不入审计）。
- ③队列 2 判据链复核拍：锚域 create→rev-content 快照逐字节恒等判据活体复核（**判据词形校准③=落库正文判据词形**——逐字节恒等对象=稿正文∪rv 反写行（loop-66 校准①），非裸稿正文；探针首拍以裸稿正文为期望误判 FAIL 即校准，快照面零缺陷）。

**清场结构发现（判据词形校准——后续轮判据词形权威）**：①**对象删除后 rev-content 历史 rv 快照恒可达**（快照语义=历史时点正文，git 权威在正文——历史不可变的延伸：已清锚 l67-rev-face-final 现势 objects 404 ∧ rv=2 快照 200 两态分立=审计不冒充的机械词形；cored-bridge.md §2 rev-content 行已随行注记）；②**清场后渲染面账本词形分立**——palette/对象行=零探针残留词形（对象残留断言域），Welcome 卡/编辑器历史 tab reasonRef 列=event_log 归档投影的 `probe loop-<n>` 摘要词形在册=账本不删域预期在册（非对象残留——残留断言勿扫事件账本词形域）；③探针非幂等自照应=判据锚自身留账（l68-face-sweep 首拍后=判别面域）——清场域断言=零探针残留词形（probe/l5x/l6x 前缀），判据锚留账在册属预期。

**L68 验收线（探针=acceptance/loop-68.md；prep 17/17+UI 5/5=22/22 终拍，锚 l68-face-sweep-c）**：
- L68-01 部署判据：既有对象读面零回归（rv=12 在运）∧ rev-content 既有对象 rv=1 快照 200 source=git-backend（v0.63 读面在运）。
- L68-02 清场判据：agents 清单零探针残留词形 ∧ 已清锚现势 404∧rv=2 快照 200 分立 ∧ history 账本行不删（count=3 在账）∧ 聚合面/inbox 投影零回归。
- L68-03 桥契约增量零回归：rv 词形族 400/404 分立 ∧ 宿主代理消费半边 200 git-backend（面行为零变更——文档面增量）。
- L68-04 桥契约文档机械面：§2 rev-content 行在册 ∧ §1 v0.63 注记在册。
- L68-05 判据链复核拍：锚域 create rv=1→快照逐字节恒等（稿正文∪rv 反写行，len=127）∧ 缺席锚 404 分立。
- L68-06 队列 1 零变化机械面：dispatch types 表驱动零 triggers 词形。
- L68-07 UI 拍：既有对象历史 tab 14 行 ok 行可点（hist-diff）∧ diff 面板「r12 ← r11 · rev-content 读面现读」词形+add/del 行 ∧ palette 对象行零残留∧历史 tab 账本 reasonRef 词形在册 ∧ 零 pageerror ∧ 截图 3 张（editor/history-diff/palette）。

**队列余量对账（下轮顺延候选）**：object 触发声明面（随 connector watch 声明面扩展顺延——零变化判定维持）；watch-only 自监控闭环/developer-system 代码化调用（红线 a 域维持 declared）；E5a 冷会话空窗（declared 维持）；编辑器域余量=无（历史 tab 判据链完整——L67-07 词形活体复核通过零回归）；docsRoot 清场=已执行（后续轮残留断言=每轮探针 P-02 判据位——回潮即红）。

### 1.42 对账轮增量：清场常态化首拍 + cored-bridge.md §2 桥契约机械对账复核 + 删除后快照两态分立新实证（2026-11-26，loop-69 轮——标准对账选点轮：队列顺延+零 Go 零 plugin 改动）

**核验选点（对账——点火队列顺序执行）**：队列 1 余量现势复核三项全**零变化判定维持顺延**——①object 触发声明面：spec.triggers 在 flowbind 仍零词形命中（grep 实证零变化，L69-06a）∧ dispatch 订阅集合=表驱动（`/v1/triggers` types=["*"] 活体在运——connector watch 声明面现势零变化，升格评估不触发）；②watch-only 自监控闭环/developer-system 代码化调用（workflow-runtime.md §11.2 余量行——红线 a 域，spawn wired 恒 false 机械锚在位=approval.go 单点 grep 实证 L69-06b）；③E5a 冷会话空窗（宿主读面现势零变化——§1.37 评估维持 declared）。队列 2 两件：①**清场常态化首拍**（P-02 残留断言判据位首次常态化执行）=四清场域对象清单零探针残留词形（现势：agents=仅 core-headless/proposals=0/workflows@global=2 件业务对象/connector-ops@systems=0——零回潮零清场动作）；②**cored-bridge.md §2 桥契约机械对账复核**（loop-68 补记后完整性复核）=代码路由集（apiserver HandleFunc 注册 43 条）↔ §2 端点行集（43 行）逐条对应零缺多（L69-05c 双向差集机械判定——「同范式随行补记」不触发，§2 清单完整）。队列 3：submodule pin=d3b6930=workservice@6853803（workservice 本轮零提交=维持零改动）。

**现势发现（判据词形随行校准）**：①**core-headless 载体已自然换代**——点火台账注记「载体持旧代 exe（deleted）」已过时：/proc 精确遍历三 cored 子进程（core-system/接入/core-headless 载体）exe sha 全=b1fe639b01922d23=v0.63 在运代（L69-01a）——三 web 同代零换代在运；②**l68 判据锚对象面已由巡检移除**（docsRoot git log `ed974c7` 探针对象不入权威文档库）——ops DB 账本行不删∧rv=1 历史快照恒可达：l68-face-sweep-c 现势 objects 404 ∧ rev-content rv=1 快照 200 两态分立（§1.41 结构发现①的**新实证形态**——删除后快照两态分立判据自此有活体锚恒可复验，后续轮判据锚）∧ history 账本行 count=1 在账（L69-03）；判据词形随行=「已清锚」域现势含 l68 锚（残留断言勿把 l68 锚对象缺席当异常——判据锚留账在判别面域=账本+快照，对象面现势缺席=预期）。

**实现拓扑（零 Go 改动零 plugin 改动——纯读面验证拍+文档面增量）**：探针=prep 14 项（部署判据/清场残留断言/删除后快照两态分立/投影零回归/桥契约机械对账/队列 1 零变化机械面）+UI 5 项（编辑器活体/历史 tab 点行 diff 零回归/palette 零残留∧账本词形域在册/零 pageerror）=**19/19 终拍零 pageerror**（脚本与数据分离 `<部署根目录>/probe/loop-69/`，node_modules 软链继承）；零写路径轮（无落稿无 apply——锚域借用 l68 留账锚作两态分立活体实证）；质量闸全绿（workservice go build/test/race + plugin npm 137 pass + personal-info 六仓 ✓ + mirror 基线 `files=18 findings=0 ok`）；零服务重启零 cookie 轮换（复用 loop-68 jar 恒有效）。

**L69 验收线（探针=acceptance/loop-69.md；prep 14/14+UI 5/5=19/19 终拍）**：
- L69-01 部署判据：三 cored 子进程 exe sha=v0.63 在运代（含 core-headless 载体——自然换代注记）∧ 既有对象读面零回归（rv=12）∧ rev-content 既有对象 rv=1 快照 200 source=git-backend。
- L69-02 清场残留断言首拍：四清场域（agents/proposals/workflows@global/connector-ops@systems）对象清单零探针残留词形（probe/l5x/l6x 前缀）——零回潮=零清场动作（清场常态化 P-02 判据位机械执行）。
- L69-03 删除后快照两态分立复核拍：l68 判据锚现势 404 ∧ rv=1 快照 200（rv 反写行在册）∧ history 账本行不删——历史不可变延伸新实证（巡检移除后形态）。
- L69-04 清场零回归：聚合面 count=7 ∧ inbox count=61 ∧ triggers types=["*"] 投影面零回归。
- L69-05 桥契约机械对账复核：§2 rev-content 行在册 ∧ §1 v0.63 注记在册 ∧ 代码路由集 43 条 ↔ §2 行集 43 行双向差集=0（零缺多——「同范式随行补记」不触发）。
- L69-06 队列 1 零变化机械面：flowbind 零 spec.triggers 词形 ∧ wired 恒 false 机械锚在位（approval.go）∧ dispatch types 表驱动。
- L69-07 UI 拍：既有对象历史 tab 14 行 ok 行可点（hist-diff）∧ diff 面板 r 词形+add/del 行 ∧ palette 对象行零残留∧历史 tab 账本 reasonRef 词形在册 ∧ 零 pageerror ∧ 截图 3 张（editor/history-diff/palette）。


### 1.43 对账轮增量：清场残留断言第二拍 + cored-bridge.md §2 机械对账解析器范式升格（缺行补记）+ 部署路径泄漏红线域收口（2026-11-26，loop-70 轮——标准对账选点轮：队列顺延+零现势变化判定+两缺口当轮收口）

**核验选点（对账——点火队列顺序执行）**：六仓 pull 零新提交（core_design@74a8efe/workservice@6853803/instance@2751a09/plugin@d3b6930——loop-69 时点即六仓 HEAD；CTX 声明面 997a7b2 与 KI-003 声明面 74a8efe 均已在 loop-69 读面内=CTX 专项判**零现势变化**）。队列 1 余量复核三项维持顺延，①**判据词形随行校准**：connector watch 桥声明面在册（`connectors.Connector` 接口 Watch 契约位+`watchsrc.Bridge` 装配桥+装配层 `ProviderImpl.Watch` 契约枚举+`--watch-source` 旗标缺省 off=零驱动零事件，event.md 规则 12 v0.30 watch 桥）——旧「零 Watch 驱动实现在仓」词形**过时摘除**；机械复核三词形=契约域零 receiver 实现（connectors/ 域零 `) Watch(`——repository 域 git/sqlite Watch 通道=声明面既有非 connector 驱动）∧ 生产装配旗标缺席（/proc cmdline 实证 --watch-source 不在列）∧ 订阅集合恒表驱动（live `types=["*"]`）→ spec.triggers 不入集合**零变化判定维持顺延**；②watch-only 自监控闭环/developer-system 代码化调用（红线 a 域——wired 恒 false 机械锚在位∧全仓零 `Wired:true` 词形∧零「真实拉起」词形，L70-03b）；③E5a 冷会话空窗（宿主读面现势零变化——§1.37 维持 declared）。**CTX 声明面对账专项（队列 2 第二件）**：scheme.yaml `conventions.context` 词汇在册∧core_design rule/rule_ctx.md R-CTX-1..6 在册∧运行时零落点（connectops-context 归 deploy-system ConnectOps 仓 R-ENG-3 生命周期域——workservice 全仓零词形 grep 实证）=**零变化判定同源顺延**（connector watch 声明面扩展轮首拍即含）。

**缺口清单当轮收口两件（本轮零代码改动≠零文档改动）**：①**P-01 部署路径泄漏红线域收口（R-PUB-3）**——personal-info 闸 instance 仓 FAIL=2 处 `/home/<用户>` 前缀部署路径词形（§1.33 loop-60 旧段 `bin/cored-lint`+§1.42 新段 `probe/loop-69`——后者 loop-69 提交引入，前漏后漏并存）→ 占位符 `<部署根目录>` 收口 → 闸恢复 ✓；跟踪文件零残留复扫（git ls-files × grep=0）；**personal-info 六仓 ✓ 自此入每轮质量闸必查判据位（回潮即红）**。②**P-03 桥契约 §2 机械对账解析器范式升格+缺行补记**——loop-69 复核=代码路由集↔硬编码转录清单 43↔43（转录面当时同构）；loop-70 升格=**文档侧行集机械解析直测**（§2 表格行首列端点词形+剥查询后缀）实测出**缺行 `GET /v1/proposals/{name}`**（v0.51 详情面旧只在清单主行载荷列内联——与 objects 单对象独立行范式不一致）→ 当轮补记独立行 → **43↔43 双向差集=0（可复现解析器）**；§2 注记升格词形随行。

**实现拓扑（零 Go 零 plugin 改动——文档域+判据域增量）**：探针=prep 14 项+UI 5 项=**19/19 终拍零 pageerror**（部署判据×3/清场第二拍×3=对象清单面+docsRoot fs 直扫面双域+l68 活体锚复核/队列 1 判据面×3/桥契约解析器×2/投影零回归/CTX 专项×2；脚本与数据分离 `<部署根目录>/probe/loop-70/`，node_modules 软链继承）；质量闸全绿（workservice go build/test/race+plugin npm 137 pass+personal-info 六仓 ✓（P-01 收口后）+mirror 基线 `files=18 findings=0 ok`）；零服务重启零 cookie 轮换（loop-68 jar 恒有效复用）；**零锚落库零写路径**（判据锚沿用 l68 留账锚活体复验——探针零对象面动作）。

**L70 验收线（探针=acceptance/loop-70.md；prep 14/14+UI 5/5=19/19 终拍）**：
- L70-01 部署判据：三 cored 子进程 exe sha=v0.63 在运代（pids=3）∧ 既有对象读面 rv=12 ∧ rev-content rv=1 快照 200 source=git-backend。
- L70-02 清场残留断言第二拍：四清场域对象清单零探针残留词形（Agent=1/Proposal=0/Workflow@global=2/ConnectorOps@systems=0）∧ docsRoot fs 直扫文件名域零残留（双域断言=P-02 判据位升格）∧ l68 活体锚两态分立（现势 404∧rv=1 快照 200）。
- L70-03 队列 1 零变化判据面：契约域零 receiver 实现∧生产装配旗标缺席（off）∧flowbind 零 spec.triggers 词形∧零 connectops-context 词形∧wired 恒 false 锚在位∧全仓零 Wired:true∧零真实拉起词形∧live types=["*"]。
- L70-04 桥契约机械对账升格：代码路由集 43↔文档侧行集 43 双向差集=0（解析器直测）∧ §2 升格注记+proposals/{name} 补记行在册。
- L70-05 投影零回归：聚合 count=7∧inbox=61∧types=["*"]∧events 面活体。
- L70-06 CTX 声明面对账：scheme conventions.context∧rule R-CTX-1..6 在册∧运行时零落点=零变化判定（同源顺延）。
- L70-07 UI 拍：历史 tab 14 行 ok 行可点（hist-diff）∧ diff 面板 r 词形+add/del ∧ palette 对象行零残留∧账本 reasonRef 词形在册 ∧ 零 pageerror ∧ 截图 3 张（editor/history-diff/palette）。

**队列余量对账（下轮顺延候选）**：object 触发声明面（判据词形已升格——零变化判定维持顺延，随 connector watch 声明面扩展轮）；watch-only 自监控闭环/developer-system 代码化调用（红线 a 域维持 declared）；E5a 冷会话空窗（declared 维持）；CTX 声明面（零运行时落点=同源顺延）；清场残留断言=第二拍通过零清场动作（P-02 判据位维持每轮必查）；§2 机械对账=解析器范式在位（下轮随行直测）。

### 1.44 对账轮增量：队列 1 三项+CTX 零变化判定维持顺延 + 清场残留断言第三拍（双域）+ §2 解析器范式随行直测（2026-11-26，loop-71 轮——标准对账选点轮：全零变化判定+三判据位随行直测全绿零缺口）

**核验选点（对账——点火队列顺序执行）**：六仓 pull 零新提交（core_design@74a8efe/workservice@6853803/instance@dad600b/plugin@d3b6930——loop-70 提交时点即六仓 HEAD=CTX 与队列 1 同源零变化基线成立）。队列 1 余量复核三项**维持顺延**：①object 触发声明面——loop-70 升格判据三词形全数复验（P71-03：connectors 契约域零 `) Watch(` receiver 实现∧生产装配 `--watch-source` 旗标 /proc cmdline 实证缺席（off=零驱动）∧live 订阅集合恒表驱动 types=["*"]）→ spec.triggers 不入集合零变化；②watch-only 自监控闭环/developer-system 代码化调用（红线 a 域——wired 恒 false 机械锚在位∧全仓零 `Wired:true` 词形）；③E5a 冷会话空窗（宿主读面现势零变化——§1.37 维持 declared）。CTX 声明面对账（队列 1 第四项）：conventions.context 词汇∧core_design rule/rule_ctx.md R-CTX-1..6 在册∧运行时零落点（connectops-context 归 deploy-system ConnectOps 仓 R-ENG-3 生命周期域）=**零变化判定同源顺延**。队列 2 三判据位随行拍全绿：**P-02 清场残留断言第三拍**（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立复核（现势 404∧rv=1 快照 200 含 rv 反写行词形）——零回潮零清场动作）；**§2 机械对账解析器随行直测**（代码路由集 43↔文档侧行集 43 双向差集=0——P-03 解析器范式随行直测在位，未回退硬编码转录清单，「同范式随行补记」不触发）；**P-01 personal-info 六仓必查**（✓×6 零回潮——判据位维持）。

**实现拓扑（零 Go 零 plugin 改动零文档面语义变更）**：探针=prep 15 项+UI 5 项=**20/20 终拍零 pageerror**（部署判据×3/清场第三拍×3=双域+l68 锚/队列 1 判据面×3/桥契约解析器×2/投影零回归/CTX×2/探针纪律×1；脚本与数据分离 `<部署根目录>/probe/loop-71/`，node_modules 软链继承）；质量闸全绿（workservice go build/test 23 包/race 7 并发包（eventbus/watchsrc/opslog/workflow/flowbind/metricsrc/repository——并发包清单按现势包位随行校准）+plugin npm 137 pass+personal-info 六仓 ✓+mirror 基线 `files=18 findings=0 ok`）；零服务重启零 cookie 轮换（loop-68 jar 恒有效复用）；**零锚落库零写路径**（判据锚沿用 l68 留账锚活体复验——探针零对象面动作）。

**L71 验收线（探针=acceptance/loop-71.md；prep 15/15+UI 5/5=20/20 终拍）**：
- L71-01 部署判据：三 cored 子进程 exe sha=v0.63 在运代（pids=3，四连轮零换代）∧ 既有对象读面 rv=12 ∧ rev-content rv=1 快照 200 source=git-backend。
- L71-02 清场残留断言第三拍：四清场域对象清单零探针残留词形（Agent=1/Proposal=0/Workflow@global=2/ConnectorOps@systems=0）∧ docsRoot fs 直扫文件名域零残留（双域断言=P-02 判据位维持）∧ l68 活体锚两态分立（现势 404∧rv=1 快照 200）。
- L71-03 队列 1 零变化判据面：契约域零 receiver 实现∧生产装配旗标缺席（off）∧flowbind 零 spec.triggers 词形∧零 connectops-context 词形∧wired 恒 false 锚在位∧全仓零 Wired:true∧live types=["*"]。
- L71-04 桥契约机械对账：代码路由集 43↔文档侧行集 43 双向差集=0（解析器随行直测）∧ §2 升格注记+proposals/{name} 补记行在册（零回退硬编码转录词形）。
- L71-05 投影零回归：聚合 count=7∧inbox=61∧types=["*"]∧events 面活体。
- L71-06 CTX 声明面对账：conventions.context∧R-CTX-1..6 六词全在册∧运行时零落点=零变化判定（同源顺延）。
- L71-07 探针纪律：全链宿主同源/loopback 读面+本地 fs+本地 grep——零外部端点零写路径零锚落库（KI-001）。
- L71-08 UI 拍：编辑器活体∧历史 tab 14 行 ok 行可点（hist-diff）∧ diff 面板 r 词形+add/del ∧ palette 对象行零残留∧账本 reasonRef 词形在册 ∧ 零 pageerror ∧ 截图 3 张（editor/history-diff/palette）。

**队列余量对账（下轮顺延候选）**：object 触发声明面（升格判据三词形零变化维持顺延——随 connector watch 声明面扩展轮）；watch-only 自监控闭环（红线 a 域维持 declared）；E5a 冷会话空窗（declared 维持）；CTX 声明面（零运行时落点=同源顺延）；P-02 清场残留断言=第三拍通过零清场动作（判据位维持每轮必查）；§2 机械对账=解析器随行直测范式维持（每轮随行直测勿回退硬编码转录）。

### 1.45 对账轮增量：队列 1 三项+CTX 零变化判定维持顺延（第三连拍）+ 清场残留断言第四拍（双域）+ §2 解析器范式随行直测（2026-11-26，loop-72 轮——标准对账选点轮：全零变化判定第三连拍+三判据位随行直测全绿零缺口）

**核验选点（对账——点火队列顺序执行）**：六仓 pull 零新提交（core_design@74a8efe/workservice@6853803/instance@6e6528b/plugin@d3b6930——loop-71 提交时点即六仓 HEAD=CTX 与队列 1 同源零变化基线第三连拍成立）。队列 1 余量复核三项**维持顺延**：①object 触发声明面——loop-70 升格判据三词形全数复验（P72-03：connectors 契约域零 `) Watch(` receiver 实现∧生产装配 `--watch-source` 旗标 /proc cmdline 实证缺席（off=零驱动）∧live 订阅集合恒表驱动 types=["*"]）→ spec.triggers 不入集合零变化；②watch-only 自监控闭环/developer-system 代码化调用（红线 a 域——wired 恒 false 机械锚在位∧全仓零 `Wired:true` 词形）；③E5a 冷会话空窗（宿主读面现势零变化——§1.37 维持 declared）。CTX 声明面对账（队列 1 第四项）：conventions.context 词汇∧core_design rule/rule_ctx.md R-CTX-1..6 在册∧运行时零落点=**零变化判定同源顺延第三连拍**。队列 2 三判据位随行拍全绿：**P-02 清场残留断言第四拍**（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立复核（现势 404∧rv=1 快照 200 含 rv 反写行词形）——零回潮零清场动作）；**§2 机械对账解析器随行直测**（代码路由集 43↔文档侧行集 43 双向差集=0——P-03 解析器范式随行直测在位，未回退硬编码转录清单，「同范式随行补记」不触发）；**P-01 personal-info 六仓必查**（✓×6 零回潮——判据位维持）。

**实现拓扑（零 Go 零 plugin 改动零文档面语义变更）**：探针=prep 15 项+UI 5 项=**20/20 终拍零 pageerror**（部署判据×3/清场第四拍×3=双域+l68 锚/队列 1 判据面×3/桥契约解析器×2/投影零回归/CTX×2/探针纪律×1；脚本与数据分离 `<部署根目录>/probe/loop-72/`，node_modules 软链继承 loop-68）；质量闸全绿（workservice go build/test 23 包/race 7 并发包（eventbus/watchsrc/opslog/workflow/flowbind/metricsrc/repository——并发包清单按现势包位随行校准）+plugin npm 137 pass+personal-info 六仓 ✓+mirror 基线 `files=18 findings=0 ok`）；零服务重启零 cookie 轮换（loop-68 jar 恒有效复用——五连轮）；**零锚落库零写路径**（判据锚沿用 l68 留账锚活体复验——探针零对象面动作）。

**L72 验收线（探针=acceptance/loop-72.md；prep 15/15+UI 5/5=20/20 终拍）**：
- L72-01 部署判据：三 cored 子进程 exe sha=v0.63 在运代（pids=3，五连轮零换代）∧ 既有对象读面 rv=12 ∧ rev-content rv=1 快照 200 source=git-backend。
- L72-02 清场残留断言第四拍：四清场域对象清单零探针残留词形（Agent=1/Proposal=0/Workflow@global=2/ConnectorOps@systems=0）∧ docsRoot fs 直扫文件名域零残留（双域断言=P-02 判据位维持）∧ l68 活体锚两态分立（现势 404∧rv=1 快照 200）。
- L72-03 队列 1 零变化判据面：契约域零 receiver 实现∧生产装配旗标缺席（off）∧flowbind 零 spec.triggers 词形∧零 connectops-context 词形∧wired 恒 false 锚在位∧全仓零 Wired:true∧live types=["*"]。
- L72-04 桥契约机械对账：代码路由集 43↔文档侧行集 43 双向差集=0（解析器随行直测）∧ §2 升格注记+proposals/{name} 补记行在册（零回退硬编码转录词形）。
- L72-05 投影零回归：聚合 count=7∧inbox=61∧types=["*"]∧events 面活体。
- L72-06 CTX 声明面对账：conventions.context∧R-CTX-1..6 六词全在册∧运行时零落点=零变化判定（同源顺延第三连拍）。
- L72-07 探针纪律：全链宿主同源/loopback 读面+本地 fs+本地 grep——零外部端点零写路径零锚落库（KI-001）。
- L72-08 UI 拍：编辑器活体∧历史 tab 14 行 ok 行可点（hist-diff）∧ diff 面板 r 词形+add/del ∧ palette 对象行零残留∧账本 reasonRef 词形在册 ∧ 零 pageerror ∧ 截图 3 张（editor/history-diff/palette）。

**队列余量对账（下轮顺延候选）**：object 触发声明面（升格判据三词形零变化维持顺延——随 connector watch 声明面扩展轮）；watch-only 自监控闭环（红线 a 域维持 declared）；E5a 冷会话空窗（declared 维持）；CTX 声明面（零运行时落点=同源顺延）；P-02 清场残留断言=第四拍通过零清场动作（判据位维持每轮必查）；§2 机械对账=解析器随行直测范式维持（每轮随行直测勿回退硬编码转录）。

### 1.46 对账轮增量：队列 1 三项+CTX 零变化判定维持顺延（第四连拍）+ 清场残留断言第五拍（双域）+ §2 解析器范式随行直测（2026-11-26，loop-73 轮——标准对账选点轮：全零变化判定第四连拍+三判据位随行直测全绿零缺口）

**核验选点（对账——点火队列顺序执行）**：六仓 pull 零新提交（core_design@74a8efe/workservice@6853803/instance@30a9cba/plugin@d3b6930——loop-72 提交时点即六仓 HEAD=CTX 与队列 1 同源零变化基线第四连拍成立）。队列 1 余量复核三项**维持顺延**：①object 触发声明面——loop-70 升格判据三词形全数复验（P73-03：connectors 契约域零 `) Watch(` receiver 实现∧生产装配 `--watch-source` 旗标 /proc cmdline 实证缺席（off=零驱动）∧live 订阅集合恒表驱动 types=["*"]）→ spec.triggers 不入集合零变化；②watch-only 自监控闭环/developer-system 代码化调用（红线 a 域——wired 恒 false 机械锚在位∧全仓零 `Wired:true` 词形）；③E5a 冷会话空窗（宿主读面现势零变化——§1.37 维持 declared）。CTX 声明面对账（队列 1 第四项）：conventions.context 词汇∧core_design rule/rule_ctx.md R-CTX-1..6 在册∧运行时零落点=**零变化判定同源顺延第四连拍**。队列 2 三判据位随行拍全绿：**P-02 清场残留断言第五拍**（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立复核（现势 404∧rv=1 快照 200 含 rv 反写行词形）——零回潮零清场动作）；**§2 机械对账解析器随行直测**（代码路由集 43↔文档侧行集 43 双向差集=0——P-03 解析器范式随行直测在位，未回退硬编码转录清单，「同范式随行补记」不触发）；**P-01 personal-info 六仓必查**（✓×6 零回潮——判据位维持）。race 闸并发包清单现势校准复核：goroutine 派生词形全仓扫描=仅清单 7 包在册（清单完备零调整——loop-71 校准词形「eventbus 现势包位」维持）。

**实现拓扑（零 Go 零 plugin 改动零文档面语义变更）**：探针=prep 15 项+UI 5 项=**20/20 终拍零 pageerror**（部署判据×3/清场第五拍×3=双域+l68 锚/队列 1 判据面×3/桥契约解析器×2/投影零回归/CTX×2/探针纪律×1；脚本与数据分离 `<部署根目录>/probe/loop-73/`，node_modules 软链继承 loop-68）；质量闸全绿（workservice go build/test 23 包/race 7 并发包+现势校准复核+plugin npm 137 pass+personal-info 六仓 ✓+mirror 基线 `files=18 findings=0 ok`）；零服务重启零 cookie 轮换（loop-68 jar 恒有效复用——六连轮）；**零锚落库零写路径**（判据锚沿用 l68 留账锚活体复验——探针零对象面动作）。

**L73 验收线（探针=acceptance/loop-73.md；prep 15/15+UI 5/5=20/20 终拍）**：
- L73-01 部署判据：三 cored 子进程 exe sha=v0.63 在运代（pids=3，六连轮零换代）∧ 既有对象读面 rv=12 ∧ rev-content rv=1 快照 200 source=git-backend。
- L73-02 清场残留断言第五拍：四清场域对象清单零探针残留词形（Agent=1/Proposal=0/Workflow@global=2/ConnectorOps@systems=0）∧ docsRoot fs 直扫文件名域零残留（双域断言=P-02 判据位维持）∧ l68 活体锚两态分立（现势 404∧rv=1 快照 200）。
- L73-03 队列 1 零变化判据面：契约域零 receiver 实现∧生产装配旗标缺席（off）∧flowbind 零 spec.triggers 词形∧零 connectops-context 词形∧wired 恒 false 锚在位∧全仓零 Wired:true∧live types=["*"]。
- L73-04 桥契约机械对账：代码路由集 43↔文档侧行集 43 双向差集=0（解析器随行直测）∧ §2 升格注记+proposals/{name} 补记行在册（零回退硬编码转录词形）。
- L73-05 投影零回归：聚合 count=7∧inbox=61∧types=["*"]∧events 面活体。
- L73-06 CTX 声明面对账：conventions.context∧R-CTX-1..6 六词全在册∧运行时零落点=零变化判定（同源顺延第四连拍）。
- L73-07 探针纪律：全链宿主同源/loopback 读面+本地 fs+本地 grep——零外部端点零写路径零锚落库（KI-001）。
- L73-08 UI 拍：编辑器活体∧历史 tab 14 行 ok 行可点（hist-diff）∧ diff 面板 r 词形+add/del ∧ palette 对象行零残留∧账本 reasonRef 词形在册 ∧ 零 pageerror ∧ 截图 3 张（editor/history-diff/palette）。

**队列余量对账（下轮顺延候选）**：object 触发声明面（升格判据三词形零变化维持顺延——随 connector watch 声明面扩展轮）；watch-only 自监控闭环（红线 a 域维持 declared）；E5a 冷会话空窗（declared 维持）；CTX 声明面（零运行时落点=同源顺延）；P-02 清场残留断言=第五拍通过零清场动作（判据位维持每轮必查）；§2 机械对账=解析器随行直测范式维持（每轮随行直测勿回退硬编码转录）。

### 1.47 对账轮增量：队列 1 三项+CTX 零变化判定维持顺延（第五连拍）+ 清场残留断言第六拍（双域）+ §2 解析器范式随行直测 + race 并发包清单现势校准复核（2026-11-26，loop-74 轮——标准对账选点轮：全零变化判定第五连拍+三判据位随行直测全绿零缺口）

**核验选点（对账——点火队列顺序执行）**：六仓 pull 零新提交（core_design@74a8efe/workservice@6853803/instance@a26ed59/plugin@d3b6930——loop-73 提交时点即六仓 HEAD=CTX 与队列 1 同源零变化基线第五连拍成立）。队列 1 余量复核三项**维持顺延**：①object 触发声明面——loop-70 升格判据三词形全数复验（P74-03：connectors 契约域零 `) Watch(` receiver 实现∧生产装配 `--watch-source` 旗标 /proc cmdline 实证缺席（off=零驱动）∧live 订阅集合恒表驱动 types=["*"]）→ spec.triggers 不入集合零变化；②watch-only 自监控闭环/developer-system 代码化调用（红线 a 域——wired 恒 false 机械锚在位∧全仓零 `Wired:true` 词形）；③E5a 冷会话空窗（宿主读面现势零变化——§1.37 维持 declared）。CTX 声明面对账（队列 1 第四项）：conventions.context 词汇∧core_design rule/rule_ctx.md R-CTX-1..6 在册∧运行时零落点=**零变化判定同源顺延第五连拍**。队列 2 三判据位随行拍全绿：**P-02 清场残留断言第六拍**（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立复核（现势 404∧rv=1 快照 200 含 rv 反写行词形）——零回潮零清场动作）；**§2 机械对账解析器随行直测**（代码路由集 43↔文档侧行集 43 双向差集=0——P-03 解析器范式随行直测在位，未回退硬编码转录清单，「同范式随行补记」不触发）；**P-01 personal-info 六仓必查**（✓×6 零回潮——判据位维持）。race 闸并发包清单现势校准复核（本轮机械增量）：行首派生词形（`^\s*go [a-zA-Z]`∧排除 *_test.go）全 internal 包扫描=清单内 watchsrc=1/workflow=2/metricsrc=1/repository=4 与 loop-73 台账逐包一致∧清单外包零行首派生——**清单完备零调整**；行内 `go func` 词形扫出 metricsinfo/permission/scheme/sessionliveness 四包仅测试文件行内词形=注释/字符串域假阳性（判据词形基准=行首派生——词形对齐注记在案，P74-08 机械断言入探针常态化）。

**实现拓扑（零 Go 零 plugin 改动零文档面语义变更）**：探针=prep 16 项+UI 5 项=**21/21 终拍零 pageerror**（部署判据×3/清场第六拍×3=双域+l68 锚/队列 1 判据面×3/桥契约解析器×2/投影零回归/CTX×2/探针纪律×1/race 清单校准×1；脚本与数据分离 `<部署根目录>/probe/loop-74/`，node_modules 软链继承 loop-68）；质量闸全绿（workservice go build/test 23 包/race 7 并发包 `-count=1` 复跑+plugin npm 137 pass+personal-info 六仓 ✓+mirror 基线 `files=18 findings=0 ok`）；零服务重启零 cookie 轮换（loop-68 jar 恒有效复用——七连轮）；**零锚落库零写路径**（判据锚沿用 l68 留账锚活体复验——探针零对象面动作）。

**L74 验收线（探针=acceptance/loop-74.md；prep 16/16+UI 5/5=21/21 终拍）**：
- L74-01 部署判据：三 cored 子进程 exe sha=v0.63 在运代（pids=3，七连轮零换代）∧ 既有对象读面 rv=12 ∧ rev-content rv=1 快照 200 source=git-backend。
- L74-02 清场残留断言第六拍：四清场域对象清单零探针残留词形（Agent=1/Proposal=0/Workflow@global=2/ConnectorOps@systems=0）∧ docsRoot fs 直扫文件名域零残留（双域断言=P-02 判据位维持）∧ l68 活体锚两态分立（现势 404∧rv=1 快照 200）。
- L74-03 队列 1 零变化判据面：契约域零 receiver 实现∧生产装配旗标缺席（off）∧flowbind 零 spec.triggers 词形∧零 connectops-context 词形∧wired 恒 false 锚在位∧全仓零 Wired:true∧live types=["*"]。
- L74-04 桥契约机械对账：代码路由集 43↔文档侧行集 43 双向差集=0（解析器随行直测）∧ §2 升格注记+proposals/{name} 补记行在册（零回退硬编码转录词形）。
- L74-05 投影零回归：聚合 count=7∧inbox=61∧types=["*"]∧events 面活体。
- L74-06 CTX 声明面对账：conventions.context∧R-CTX-1..6 六词全在册∧运行时零落点=零变化判定（同源顺延第五连拍）。
- L74-07 探针纪律：全链宿主同源/loopback 读面+本地 fs+本地 grep——零外部端点零写路径零锚落库（KI-001）。
- L74-08 race 清单现势校准：清单外包零行首派生词形∧清单内四包派生计数与 loop-73 台账逐包一致（清单完备零调整）。
- L74-09 UI 拍：编辑器活体∧历史 tab 14 行 ok 行可点（hist-diff）∧ diff 面板 r 词形+add/del ∧ palette 对象行零残留∧账本 reasonRef 词形在册 ∧ 零 pageerror ∧ 截图 3 张（editor/history-diff/palette）。

**队列余量对账（下轮顺延候选）**：object 触发声明面（升格判据三词形零变化维持顺延——随 connector watch 声明面扩展轮）；watch-only 自监控闭环（红线 a 域维持 declared）；E5a 冷会话空窗（declared 维持）；CTX 声明面（零运行时落点=同源顺延）；P-02 清场残留断言=第六拍通过零清场动作（判据位维持每轮必查）；§2 机械对账=解析器随行直测范式维持（每轮随行直测勿回退硬编码转录）；race 并发包清单=行首派生词形判据基准维持（P74-08 机械断言随行）。

### 1.48 界面用户视角改造：R-UX-3/4/5 + console-ui.md §13 落地（2026-11-26 用户裁决，loop-75 轮——纯 client 面改动：文案人话化+渲染优先+系统视角首屏零 Go 改动）

**权威依据**：core_design@c07bdcc rule.md R-UX-3（工程黑话禁入界面——「面」字族/E<n> 里程碑词形/「真数据」禁入一切界面文案；kind 降次级徽章；界面名+术语名双名制）+R-UX-4（内容展示渲染优先——markdown 默认视图、scheme/YAML 次级切换禁裸转储、结构化字段卡只读态、XSS 转义红线）+R-UX-5（视觉锚定 DeepSeek——dsh 原生 token 不自造第二套）；core_system_instance@2551756 console-ui.md §13（13.1 文案人话化/13.2 渲染优先/13.3 系统树=系统视角/13.4 判据）。

**实现拓扑（纯 plugin/client 改动——零 Go 零 cored）**：①文案人话化=client/*.js 界面文案字符串域清零「面」字工程词（~51 处词形→人话：cored 读面→系统文档库/运行面→运行状态/文档面→文档/权限面→权限/触发面余量→暂未接线等）+零内部里程碑词形（E<n>/L<n>-/P-0x/真数据/declared-deferred 出界面；reasonRef 落账语汇 'console E5:'→'console:chat-session-create'——审计域词形随行）；屏幕 3 现势整改点全收（§13.1 列举三处旧实证词形零残留——P75-03b 机械断言）。②渲染优先=**client/console-md.js 新模块**（最小自写 markdown 渲染器：标题/列表/表格/代码块/链接/粗斜体/引用/行内代码，零网络依赖零外部库）+**XSS 红线**（esc() 转义先于一切结构化解析+safeHref 链接白名单（http(s)/agent/system/session/doc/goal/desc/report/rule 五族，javascript:/data: 拒绝降纯文本）+零原文直插 href）+yamlToCards 结构化字段卡（R-UX-2 只读态映射：顶层键卡+人话释义 gloss+嵌套子卡+行内数组逐项 chips——最小 YAML 读侧投影 parseSimpleYaml）+rawDisclosure 折叠次级（原文/YAML 恒 details 收起——首屏禁裸转储）+**编辑器屏双视图**（正文=渲染默认（markdown 文档类 renderMarkdown / 对象 spec=yamlToCards 字段卡；S.edView 内存态刷新回默认）∧原文=textarea 次级切换（ACTIONS ed-view 显隐容器零 S.ED 重建——编辑/草稿/Apply 通路零变更）；input 事件同步渲染视图=双视图同源零漂移）。③系统视角=screenSystem 重构（§13.3）：首屏系统卡（data-syscard：名称/健康度（实例相位 InSync→运行正常）/实例数/文档版本/作用域+goal 一句话（声明 summary/goal/description 现读缓存））→入口卡四张（data-ent：事件/指标/文档/权限——人话标签+计数徽章+SVG 图标+副标题）→服务分组（服务实例/工作流/连接与凭据源人话标题；对话入口=chat/<agent> 点入会话屏）→系统声明卡（字段卡默认态+「YAML」details 折叠次级）→文档清单退 details 折叠次级（data-docs-fold 默认收起）。④视觉=R-UX-5 锚定：md/syscard 样式块零新色值常量（只消费既有 --panel-2/--border-2/--text-2/--accent 等 dsh 原生 token——L75-07 机械断言禁自造色板）。⑤测试=console-ux.test.ts 新 8 锚（§13.4 判据机械断言入 npm test）+既有锚词形随行人话化（live/inbox/scenario 三文件 7 处——机制锚零变更）；npm **145 pass 0 fail**（137 既有回归+8 新增）。⑥部署=dist 随行重建（pnpm link 软链即时生效——零重启零 patch）；docsRoot scheme 镜像随行同步（core_design@7cf6410/d9005aa/429c3b5 权威字节——lint mirror 闸 findings 1→0 mirror=ok 基线恢复，commit a0246bd）。

**L75 验收线（探针=acceptance/loop-75.md；prep 16/16+UI 11/11=27/27 终拍零 pageerror）**：
- L75-01 部署判据：三 cored 子进程 exe sha=v0.63 在运代（pids=3，八连轮零换代）∧ 既有对象读面 rv=13 ∧ rev-content rv=1 快照 200 source=git-backend。
- L75-02 清场残留断言第七拍：四清场域对象清单零探针残留词形∧docsRoot fs 直扫文件名域零残留∧l68 活体锚两态分立（现势 404∧rv=1 快照 200）。
- L75-03 §13.1 机械断言（双拍=npm L75-01/02+prep P75-03 同源独立复核）：dist/client.js 字符串域零违禁词形（面族+E<n>/L<n>-/P-0x/真数据/declared-deferred 命中=0）∧屏幕 3 旧实证词形零残留。
- L75-04 §13.2 渲染器机械断言：__CC.md 入 bundle∧esc 转义先于 renderMarkdown∧safeHref 白名单∧yamlToCards+rawDisclosure('YAML'/'原文') 双次级在册。
- L75-05 §13.3 系统视角机械断言：data-syscard/data-ent-cards/data-docs-fold 三词形在册∧入口卡人话标签（事件/指标/文档/权限）四卡在册。
- L75-06 投影零回归：聚合 count=7∧inbox=61∧types=["*"]∧events 面活体。
- L75-07 探针纪律：全链宿主同源/loopback——零外部端点零写路径零锚落库（KI-001）。
- L75-08 UI 拍（活体 DOM）：系统卡三 kv（健康度/实例数/文档版本）∧入口卡四张 ents=[docs,events,metrics,permissions]∧文档折叠次级默认收起∧对话入口 chat∧声明字段卡 count=5 默认态∧「YAML」details 收起∧首屏无裸 pre 转储∧编辑器默认渲染视图（render 可见 raw 隐藏 chip 正文高亮）∧渲染正文注入+原文折叠在册∧原文切换 textarea 可编辑（编辑能力零变更）∧Welcome 屏活体文本零违禁词形∧零 E<n> 命中∧零 pageerror∧截图 4 张（system-card/sys-decl-cards/doc-render/doc-raw-toggle）。

**判定**：§13.4 判据四项全绿（机械断言回潮即红入 npm test 常态化+活体 DOM+截图）；R-UX-3/4/5 落地零 Go 改动零 cored 改动（纯 client 面——任务红线维持）；kind 名降次级徽章（系统声明副注记+chip kind）主标题=用户词（服务实例/工作流/连接与凭据源/系统卡标题=系统名）；053dd1a 提案屏×上下文对照卡=余量项不阻塞（§13 主线收口后余力再做）。

### 1.49 提案×上下文对照卡：053dd1a + proposal.md §4.6 落地（2026-11-26 用户裁决，loop-76 轮——纯 client 面改动：对照卡+审批屏同屏零 Go 改动）

提交节点（intake-generate 对话式生成 + prop-submit 降级表单提交）对提案摘要跑上下文对照（concepts/proposal.md §4.6——client/console-ctx.js 新模块）：

- **装配与产出**：文档库索引现读（`v1/design-docs` repo/path/sha——宿主 loader 注入，模块零直接网络依赖；120s 缓存）× 确定性检索（中文主题词→basename 映射 + YAML 域关键词双通道）产 `conflicts`（双命中=主题+域——与现有文档可能冲突）/`supplements`（单命中=建议随行核对）；ref=`<repo>/<path>#<锚>` + hash（blob sha——git hash-object 对账同字节口径）；对照=辅助判定信息不改准入判定（准入仍=dry-run 三检查；取舍留 approval_log 既有人审通路）。
- **对话区独立卡**（不静默不折叠进其他）：`#intake-messages` 消息行尾 `data-ctx-card` 独立卡——冲突卡逐条 `<details>` 可展开（ref+hash 短形 summary+全形核对行+why）、补充卡一键「加入随行清单」（`ctx-supplement-add` → 会话内 taken 清单；批准派工后作为文档更新起点随载荷——载荷接线=余量）；消息行同步播报对照结果。
- **审批屏同屏携带**：详情屏 landing 卡内 `#pd-ctx-slot` 折叠次级（`data-ctx-approval`）——会话在册=完整对照卡；缺位=降级占位可见（不静默）+ 摘要现读补挂完整对照。
- **degraded 可见不阻断**：索引现读失败=degraded 卡（明确「不阻断提交」）；`ctxRunCheck` 失败链路零 throw 传染（`Promise.resolve(null)` 兜底）——提交按钮 disabled 逻辑零触碰。
- **复用**：会话内 byKey（kind|scope|name → sig=DJB2(yaml) 复用）——同键同摘要不重复装配（tagSig 语义的 client 侧复用）。
- L76-01 对照卡三态必现其一（conflicts/supplements/degraded——模块直测三态构造）∧冲突卡 details 可展开∧hash 短/全形在册∧补充卡一键按钮词形。
- L76-02 check 复用（sig 同→不重复装配，索引只现读一次）∧loader 失败=degraded 卡∧审批屏缺位降级可见（不静默）。
- L76-03 挂载词形在册（对话区独立卡/预览区/详情屏 slot/一键随行动作/setDocsLoader 注入）∧console-ctx.js 入 bundle 拼接序（console-md 后 console-live 前）。
- L76-04 对照卡文案零违禁词形（「面」族/E<n>/L<n>-/真数据——专锚）∧零新色值（dsh 原生 token 消费——ctx 样式块专扫）。
- L76-05 探针 UI 拍 11/11（U76-01a…05b）：对话模式在册∧对照卡三态其一（实测 conflicts 态：冲突 1+补充 2，文档 102 份现读）∧对话区独立卡∧预览区同卡∧一键随行按钮态翻转∧冲突卡可展开+hash 短/全形一致（6ca86566 ↔ hash=6ca86566eb11…）∧提交→详情屏跳转∧审批屏同屏携带（data-ctx-approval 在册+可展开）∧对照卡零违禁词形活体∧零 pageerror∧截图 3 张（ctx-card/ctx-approval/ctx-approval-open——PNG file 验证 1440×900，载体模型无图像输入机械面代替目检如实注记）。
- L76-06 探针纪律：全链宿主同源/loopback（KI-001）——探针对象 Proposal/global/l76（rv=1 submitted）验收后 docsRoot git rm 清场（commit 991dc82——loop-68 先例同法；apply 面无 delete 动作=写路径唯一红线照旧）；P-02 第八拍 CLEAN-OK（四域计数=loop-75 基线逐位一致+fs 直扫 l76* 归零+intake 会话=0+l68 活体锚两态分立）。

**判定**：§12 机读判据全绿（对照卡三态必现其一+冲突引用可展开 hash 一致+一键加入+审批屏同屏+rv=1 submitted+截图入报告+零 pageerror）；npm 151 pass（+4 本轮锚；fd33912 新代际 2 测试并入全绿）；lint mirror 闸 files=19 findings=0 ok（开局修复交接发现镜像漂移：docsRoot scheme 缺 core_design@2d43a1a StateModel/Finance 两行——sudo cp 同步+commit c069f1e 恢复基线）；R-UX-8 corectl/wake 桥新代际（e1daec2/e93069e/712f4de/fd33912）并行落库零冲突（fd33912 仅 src/index.ts 2 行——与本轮 client 层零交集）；业务侧 remote 交接档过期=已指 OneDev 且 ls-remote 通（推通路就绪）；R-UX-6/7 关注报告×对象工作台=下轮独立成轮（控制台首屏形态级+corerd 换代判据——超出本轮红线）。

### 1.50 对照卡降级重试 + R-UX-8 wake 桥活体验收（053dd1a 余量③ + console-ui.md §15，loop-77 轮——纯 client 面：重试按钮零 Go 改动；R-UX-8=部署侧既落能力首轮活体对账）

**降级重试（余量③收口）**：degraded 卡自带「重试对照」按钮（`ctx-retry`——免刷新整页）——`console-ctx.js` 新增 `refresh()`（清键+跳过 120s 索引缓存强制现读；失败态本就不缓存故重试恒现读）+ `yamlOf()`（预览 yaml 优先/会话字段重建——intake-generate 与 prop-submit 两提交入口同形摘要）；`check()` 给 cx 盖 kind/scope/name 戳（按钮 data 定位通道）；app 侧 `precheckFields()` 提取（prop-submit 字段读取口径单源化）+ propYaml 导出 `__CC`（摘要重建通道）；重试中可再点（幂等）；成功/再降级都重绘（新态可见）。测试 +L77-01（degraded 卡按钮在册+refresh 现读重装配+复用语义回归——refresh 只清键不破坏 sig 复用）；npm 153 pass（e2e 夹具随新代际 R-DOC-7 补 `--docs-backend git` 兼容旗标——cored 缺省 sqlite 后 `--docs` 需 `--docs-db`，测试夹具零迁移随行兼容）。

**R-UX-8 wake 桥活体验收（§15.3 六条机读判据全绿）**：本轮自身=端到端活体证据链——部署侧 `corectl loop --dedup cli-sqlite-check`（05:11:24）→ `/v1/events` LoopRequested 命中 → `/v1/agents/wakes` root 唤醒 accepted（origin=route route=root-agent）→ 宿主 loopCommand（ignite-loop.sh）05:11:50 拉起 core-headless=本轮会话本体。①events 命中+wakes root 在册 ✓；②单飞+pending：cli-rule-verify（05:17:22）在本轮运行中到达→无新进程（pgrep 复核恰一）→pending 持久化落盘 `~/.dsh/wake-pending.json`（0600——`{"dedupKey":"cli-rule-verify",...}`）；③宿主日志 spawned：宿主 stdout 走 socket 不可 grep（机械面替代=事件→唤醒→拉起三点时序互证+loopCommand 产物在册）；④CLI 无 `--server`/`CORED_ADDR` 走 `~/.dsh/cored.addr` 三级发现 ✓（本轮 corectl 全程零显式地址）且文件 0600 ✓；⑤载荷不进命令（spawn 参数恒空——wake.test 3 锚覆盖）；⑥缺 role 拒绝=cored 权限链既有测试覆盖（code 级证据注记）。外部 ignite 退役判据（停外部巡检后事件链独拉）现势成立：crontab 空、本轮拉起唯一通路=wake 桥。

**新代际随行注记**：本轮开局实证交接档基线多处过期——cored 已换代（45d79a068cff77c2，05:10 sqlite 重启窗；v0.63 b1fe639b 九连轮纪录止）；R-DOC-7 新代际三仓并行落库（core_design@98c9bd6→1a31dbc 含 512efbc/R-TYPE-3 规则验证、instance@43c5963、workservice@4aad073）；docsRoot scheme.yaml 处于未提交修改态（LoopRequested+importance 0-100+storage.docs sqlite 三处——内容已前移至 core_design@98c9bd6 口径、双 sha 一致 30d9c496+lint files=18 findings=0 mirror=ok 绿；按纪律不代收不代提交=上游部署侧收口中）；attention 端点仍 405（v1/attention 未注册——R-UX-6/7 换代判据未解锁，首屏改轮继续顺延）；docs-index 计数 103（loop-76 报 102 已过期）。


### 1.51 通用对象工作台：R-UX-7 + console-ui.md §14.5 落地（2026-11-26 用户裁决，loop-78 轮——纯 client 面改动：六片工作台+首屏取代零 Go 改动；R-UX-6 报告首屏=attention 端点 405 顺延，工作台为 §14.5 内不依赖 attention 的先行面）

**模块（console-obj.js 新增）**：六片纯函数+渲染——`tagGroups()`（tagType 词表归组，未分组殿后不冒充）+ `rulesFor()`（规则确定性命中：kind/scope/tag/正文引用四路来源显式列 `why[]`；零命中=空数组「无适用规则」不装假；索引缺席=degraded 可见）+ `sectionCompletion()`（DocType requiredSections 结构段完成度——预留）+ `ctxSummary()`（会话装配摘要人话化）+ `kindRegYaml()`（/v1/scheme/kinds 载荷行→声明卡 yaml，`md.yamlToCards` 同一渲染核）+ 六片渲染 `tagPanel/rulePanel/ctxPanel/opsPanel/schemePanel/contentPanel`（零 HTML 直插，缺片显式「无」）。规则文档族/tagType 词表=宿主注入 loader（同 console-ctx 范式：120s 缓存失败降级零直接网络依赖——规则文档族全文现读 design-docs `rule/` 前缀 + `*.metadatainfo` tag 词表）。

**屏本体（screenObjWorkbench）**：路由三形——`#/obj/:kind/:scope/:name`（三段主形）+ `#/obj/:kind`（kind 别名=该 kind 首个对象；首装未就绪=LIVE.ensure 后解析）+ `#/obj`（裸词=缺省对象首屏落地）；左=对象清单（tag 点选联动过滤器 `S.objFilter`，标识符全可点）+ 中=身份条（名称/kind 徽章/scope/rev/相位 chip）+六片 + 右=对话栏（一等片：活跃会话计数投影+「就地开聊」深链 `chat/<agent>` 携带对象引用——内嵌输入窗=报告主界面轮同体量项，诚实余量不画假）。规则片引用深链=设计文档工作台 `designdoc/:repo/:path`（path 整段单次编码 %2F——involvedRoute 同词形）。首屏取代（§14.0）：entry.js 面板 route=`#/obj`（空段/裸词重定向工作台）+ console-data 侧栏首位=「对象工作台」；`#/welcome` 保留为旧路由别名域（§14.0 取代表逐位落地）。css `.obj-layout` 布局块（dsh 原生 token 零新色值）。测试 +L78-01（模块直测：分组殿后/命中来源显式/零命中不装假/降级显式/%2F 深链词形/六片空态词形/声明投影）+L78-02（接线在册：三路由/loader 注入/六片挂载词形/动作处理器/拼接序 console-md 后 console-live 前）+L36-03 锚随行（#/obj 入口锚）；npm 155 pass 0 fail。

**UI 拍（loop-78，e78-ui.mjs 7/7 零 pageerror）**：①工作台模块在册+路由活（#/obj 三段落身份条 kind 徽章）；②首屏落地活体（`#/`→空段重定向→`#/obj`→缺省对象→工作台 `#/obj/Workflow/global/deploy-system-workflow`，viewLen 14504）；③六片齐全+对话栏（tags/rules/ctx/ops/content/scheme+chatrail 七挂载词形全在 DOM）；④tag 点选联动在册（本窗对象无 tag 声明=联动词形活体+诚实空态注记）；⑤规则片活体（规则文档族 8 份现读、Workflow 对象命中 6 条、来源 chips 7 个显式）；⑥对象互跳（规则原文可点→designdoc 深链可达 `rule%2Frule_type.md` 编辑器在册）；⑦全程零 pageerror。

**根因修复随行（页面级 error 一次，缺陷即修收口）**：首屏取代的空段重定向词形冲突——entry 面板首挂 `panelForHash(hash)!==nav → location.hash=nav.route` 强写 `#/welcome`，与 app render 空段 `location.replace(objRoute(...))` 互搏产生「读 'kind' of undefined」错误面；收口=面板 route 与 console 空段重定向统一 `#/obj` 词形（面板归位与 console 重定向零互搏）+ 裸 `#/obj` 由 route 处理器自身落缺省对象（挂载时序内自洽不依赖 onChange）。

**新代际随行注记（如实）**：attention 端点三实例 GET/POST 全 405（本轮开局复测 45797/44171/41189——现行 cored 代 45d79a06 仍未含，R-UX-6 报告首屏解锁判据缺席=顺延第 2 轮）；cored 三进程 sha=45d79a068cff77c2 零换代；docsRoot scheme.yaml 未提交态第 2 连拍（双 sha 30d9c496 一致+lint files=18 findings=0 mirror=ok 绿——按纪律不代收不代提交，连 3 拍则询问部署侧裁决）；docs-index 103 现读。


### 1.52 任务中心/任务详情/关注报告三面 + task spawn 桥 + 工作台 Task/Session 深链收口（R-UX-6 + console-ui.md §16/§14 + task-scheduler.md §4，loop-79 轮——三 cored 换代 3fa671f0 后 GET /v1/attention 与 /v1/tasks 双解锁活体落地）

**插件侧（mountTaskSpawnBridge）**：`src/index.ts` 新增 `POST /task/spawn` loopback 桥（与 `mountWakeBridge` 同族）：固定命令 `config.taskSpawnCommand` 未设=503 带原因；载荷零 shell 拼接（`taskPath` 只经 stdin 喂命令）；单飞=`taskId` 锁文件白名单 sanitize + 进程活性判定（活 pid=`already-running`，陈旧锁清后重派）；回执 `{ok,status:spawned|already-running,sessionHint}`；地址经 `CORE_SYSTEM_TASK_SPAWN_ADDR` 环境回填并写 0600 地址文件（`taskSpawnAddrFile`）；测试 `taskspawn.test.ts` 三锚（spawn+锁落盘 / 陈旧锁重派+活锁单飞 / 503+400+404）。

**前端模块（console-tasks.js）与三屏（#/tasks · #/task/:id · #/report）**：
1. **词形与双形态归一**：`groupTasks()` 确定性五组人话词形（正在做=`running|verifying` / 等人=审批词形原因 `blocked|failed` / 卡住=其余 `blocked|failed` / 完成=`done|canceled` 徽标如实 / 排队=`queued|ready` 与未知相位原词不丢行）；`statusOf/specOf` 双形态归一——同时兼容 `GET /v1/tasks` 列表扁平行（`tasks_face.go` `taskRow` 顶层 `phase/title/dependsOn/lastAction/lastError/agentSession`）与 `GET /v1/tasks/{scope}/{name}` 详情嵌套形（`spec.*` + `status.*`）；`runningCount()` 只数 `running` 不编并发上限；`sessionChips()` 按 `agentSession` 反查在册任务（未关联=「未关联在册任务」，清单不可读=整片不显）；`evidenceRoute()` 已知路由词形（`inbox/approvals/tasks/s/wf/event/task/session/obj` 及 `Kind/scope/name`）可点，未知词形=纯文本不冒充；`windowLabel()` 同时兼容 `attention.go` `{from,to}` 窗口对象（换算 `24h`）与字符串，消解 `[object Object]`；loader 注入（tasks 15s / attention 60s / 单任务恒现读，失败落 null 不缓存失败态）。
2. **屏面与深链**：`#/tasks` 任务中心（运行中计数+五组列表行+对话深链+空态/降级显式）；`#/task/:id` 任务详情（≤2 次点击可达：在做什么/卡在哪/下一步三行+任务声明卡+任务状态卡+会话深链）；`#/report` 关注报告（降级横幅+事实栏+一句话综述+severity 排序关注卡+「本窗口已澄清」折叠+数据可信度页脚+右侧常驻对话栏 `chat/<agent>`）；工作台 `objOpsFor()` 补齐 `Session` kind（「会话详情」→`#/session/:id`）与 `Task` kind（「任务详情」→`#/task/:id`）操作片深链（loop-78 队列 3① 收口）；entry.js 侧栏新增「关注报告」「任务中心」（11 入口成对注册，`CONSOLE_SEGS` 收录 `report/tasks/task`）。测试 +L79-01/L79-02 + L36-02 随行（9→11），npm 160 pass 0 fail。

**UI 拍（loop-79，e79-ui.mjs 7/7 零 pageerror）**：①`console-tasks` 模块在册（`windowLabel` `{from,to}`→`24h`）；②`#/report` 关注报告活体（真实 `GET /v1/attention` 200：5 张关注卡+综述+facts+clear 折叠+页脚 `窗口 24h`+右对话栏，零 `[object Object]`）；③报告证据深链可点跳达 `#/event/...`；④`#/tasks` 任务中心活体（真实 `GET /v1/tasks` 扁平行归一：`运行中 1`+「正在做」组含 `调度器冒烟探针`+最近动作在册）；⑤`#/task/:id` 任务详情 ≤2 次点击可达（三行+声明卡+状态卡齐全）；⑥工作台 `#/obj/Task/...` 操作片「任务详情」深链可点跳达 `#/task/:id`；⑦全程零 pageerror。

**新代际与镜像随行注记**：三 cored 实例同代换代为 `3fa671f024640569`（`GET /v1/attention`、`GET /v1/tasks`、`GET /v1/objects/Task` 三实例全 200）；`core_design@2b8a6e8` scheme 新增 `TaskCancelRequested/TaskConflictResolved` 后，`docsRoot/core/scheme.yaml` 镜像同步（双 sha `b1d4034f` 一致，`cored-lint` `files=18 findings=0 mirror=ok`）；`docsRoot` `scheme.yaml` 未提交态第 3 连拍——按纪律不代收不代提交，于本轮报告显式提请部署侧裁决。

### 1.53 工作台 v0.65 上下文/trace 读面对接 + 编辑器 sqlite `doc-history`/`rev-content` 历史修补 + 关注报告当前循环卡（R-UX-7 深化 + R-DOC-9 + R-DOC-7 + console-ui.md §16.1 C，loop-80 轮）

**工作台 v0.65 读面对接（console-obj.js + console-app.js）**：
1. **双向 trace 与相关对象投影**：`console-obj.js` 新增 `setTraceLoader`/`setContextFindLoader`（`ensureTrace`/`ensureRelated`，模块零直接网络依赖）+ `traceRouteOf()`（三段与多段 scope 精确映射 `obj/<Kind>/<scope>/<name>`，非三段不编假路由）+ `tracePanel()`（呈现 `implements` 实现自 / `implemented_by` 被实现 / `verified_by` 验证关联，支持可点深链、章节锚点、对齐版次、`stale=true`「待对齐」告警徽及未解析标注，降级/404 未入索引/全空三态显式不装假）+ `relatedPanel()`（接入 `GET /v1/context/find?q=&tags=&k=6`，剔除自身后按相关性得分 0-100 展示前 5 条相关对象与命中原因，全可点互跳）并统一装配于工作台「上下文」片（保留 `data-obj-ctx` 会话装配摘要向后兼容）。
2. **标签「补标」与对象编辑判据缺陷即修**：`tagPanel(groups, { editRoute })` 补齐 §14.5「补标」入口（深链 `#/doc/:kind/:scope/:name` 走既有草稿→Apply 写路径，零旁路）；活体实测发现 `scheme.yaml` 全 19 类 builtin 标记恒为 `true`，原 `!kindReg.builtin` 导致工作台「补标」与「编辑草稿」全对象缺席→即修为 `!!(kindReg && kindReg.storage)`，存储型对象编辑与补标入口双恢复。

**编辑器历史 tab sqlite `doc-history` / `rev-content` 体验修补（R-DOC-7 规则 4）**：
1. **`rv=1` 误跳修复与 `source` 双后端分立**：修复 `ACTIONS['hist-diff']` 原 `rv === 1 ? Promise.resolve(null)` 导致点击起点版 `r1` 恒报「快照暂不可读」的真实缺陷；取消「git 权威正文快照」硬编码，改按响应权威字段 `source` 经 `revSourceLabel()` 如实区分 `sqlite-doc-history`（「sqlite 逐次正文账」）与 `git`（「git 正文快照」）。
2. **双轨历史同屏与 `prev` 缺席优雅回退**：`hydrateHistory()` 并行拉取 `GET /v1/history/{kind}/{name}`（ops DB `apply_log` 审计流水）与 `GET /v1/doc-history/{kind}/{name}`（sqlite `doc_history` 逐次正文翻页账——git 后端 503 静默降级不报错），新增 `data-doc-history="1"` 逐次快照区块可直接点行 diff；当旧迁移对象（如 `Agent/global/core-headless` `r13`）的上一版 `r12` 在 `doc_history` 缺席（404）时，不再整块报错，而是优雅回退展示 `r13` 全文并诚实标注上一版快照缺席。

**关注报告当前循环卡（console-tasks.js + `#/report`，console-ui.md §16.1 C）**：
- `console-tasks.js` 新增纯函数 `loopCard(wakesBody, sessionsBody, opts)` + `relAge()`，复用既有 `LIVE.state.wakes`（`GET /v1/agents/wakes`）与 `LIVE.state.sessions`（`GET /v1/sessions`），零新端点零前端自建状态：按 `type=LoopRequested` 选最新唤醒并分 `active`（1h 内）/ `recorded`（历史唤醒）/ `idle`（无循环+`corectl loop` CLI 点火指引）/ `degraded`（双面不可达）四态；**显式标注「会话型任务（无 workflow run）」**，附 `[看完整对话]`、`[任务中心]`、`[触发事件]` 三深链。

**测试与 UI 拍（loop-80）**：`console-ux.test.ts` 新增 `L80-01/02/03` 三锚，**`npm test` 163 pass 0 fail**；UI 拍（`e80-ui.mjs` 零写操作、**8/8 零 pageerror**）：①`console-obj/tasks` 新能力在册；②工作台 `#/obj/Agent/global/core-headless` 上下文片活体接入 `/v1/trace` + `/v1/context/find`（5 条相关对象）+ 标签「补标」按钮；③相关对象深链可点互跳 `#/obj/Group/global/core-operators`；④`#/report` 当前循环卡活体（`active` 态含最近 `LoopRequested` 唤醒 + 「会话型任务（无 workflow run）」显式标注 + 深链，零 `[object Object]`）；⑤编辑器历史 tab（`Task/self-recursive-core/probe-smoke-1`）呈现 `doc_history` 4 条快照并点 `r5` diff `r4`（`source=sqlite-doc-history` 标注「sqlite 逐次正文账」）；⑥点 `r1`（`rv=1` 修复）成功现读首版全文；⑦`Agent/global/core-headless` 点 `r13`（`r12` 404）优雅回退展示当前版全文与诚实缺席说明；⑧全程零 `pageerror`。

### 1.54 Workflow 页与审批页联动深化 + supplements 派单载荷接线 + 提交字段单点即修（loop-81）

> 对应 loop-80 队列 1①②③（`console-ui.md` §16.1 C / E / F + `proposal.md` §4.6 对照卡余量①②）+ 随行缺陷即修（`precheckFields` 悬空引用）。纯 `plugin/client` 增量，零 Go 零 cored 改动。

**Workflow 详情页环绕循环卡与运行抽屉深化（`console-tasks.js` + `console-app.js`，`console-ui.md` §16.1 C/E）**：
1. **`loopCardFor` 与 `wakeRunWord` 抽提**：`console-tasks.js` 抽提纯函数 `wakeRunWord(w)`（按 `dedupKey` 区分「loop 会话型任务」与「事件对账 run」）与 `loopCardFor(wakesBody, sessionsBody, opts)`（支持调用方指定锚属性 `data-wf-loop` vs `data-report-loop` 并在非报告页显式叠加「loop 唤醒≠该 workflow run」关系说明，报告页零词形污染）。
2. **`#/wf/:name` 页头挂载 + 运行抽屉**：`wfLoopCard()` 在存在 `LoopRequested` 唤醒时于工作流页头挂载 `data-wf-loop` 环绕循环卡（零新读、零前端自建状态，复用 `LIVE.state.wakes` + `LIVE.state.sessions`）；运行抽屉头部追加 `data-wf-run-kind="reconcile"`（「事件对账 run」）与 `loop-relation` 关系徽；`SessionLog` 空态由死胡同改为 `sessLogSlotHtml()`——活性面有活跃会话时直接给 `#/session/:id` 真实深链（最多 3 条），无活跃会话时诚实说明原因，不假画全文。

**审批页来源/背景深链与已决账备注列（`console-app.js`，`console-ui.md` §16.1 F + 对照卡余量②）**：
1. **待审项来源行与背景深链**：新增 `approvalSourceLine(d)`（草稿卡片头部按真实字段呈现优先级/提出人/提案详情深链/非 console 来源 `fieldManager`，无字段不猜）与 `approvalBgLink(obj)`（覆盖 `Proposal`/`Task`/`Workflow` 三类真实详情页深链 `data-ap-bg`，同时接入无稿 `ApprovalNeeded` 卡片与 `approval_log` 已决表）。
2. **已决账 `approval_log` 备注列与取舍标注**：表头新增「备注」列，`approvalLogNote(r)` 纯翻译账面既有字段（`fieldManager`/`reasonRef`/`obj`），**实测即修**：`console:approve`/`console:reject` 按 `obj` 前缀区分「提案判定（批准/驳回）」与非提案对象的「审批落库（批准/驳回）」，不再把 `ConnectorOps` 草稿批准误标为「提案判定」；对冲突取舍文本如实标注「未在册（对照摘要=辅助判定不落本账——`proposal.md` §4.6）」，零冒充。

**对照卡余量① `supplements` 派单载荷接线与 `precheckFields` 悬空引用即修（`console-app.js`）**：
1. **`supplements` → `docsUpdate`**：点击「一键随行」（`ACTIONS['ctx-supplement-add']`）将补充文档记入 `window.__CC.ctx.taken` 并在预览 yaml 同步补行；提交面 `prop-submit` 将 `taken` 清单单出为 `f.docsUpdate`，由 `propYaml()` 写入提案稿 `spec.docsUpdate`（纳入 `known` 白名单，不走杂散字段通路），批准翻转 `status` 时原稿携带随派单载荷下发（`proposal.md` §4.6）。
2. **缺陷即修（`precheckFields` 悬空引用）**：核对提案提交通路时发现 `prop-submit` 与 `ctxRunCheck` 两处仍调用已删函数 `precheckFields()`；即修收口为单点函数 `intakeFieldsOf(st)`（以 `st.fields` 为单一真相，数组/文本验收统一归一为换行串），并补回归锚 `L81-05` 锁死防回潮。

**结构段完成度片观察（队列 2）**：活体实探 `/v1/objects/DocType` 仍为 `count=0`，继续诚实等待 `DocType` 对象入册后再接入真数据。

**测试与 UI 拍（loop-81）**：`console-ux.test.ts` 新增 `L81-01..05` 五锚，**`npm test` 168 pass 0 fail**；Playwright 活体 UI 拍（`e81-ui.mjs` 零写操作、**8/8 零 pageerror**）：①`loopCardFor`/`wakeRunWord` 在册且词形分立；②`#/wf/core-workflow` 页头环绕循环卡（`active` 态 + 关系词形 + 会话型任务标注）；③运行抽屉「事件对账 run」徽 + 3 条活跃会话深链；④`#/approvals` 审批页 25 处 `[data-ap-bg]` 背景深链 + 已决表 20 行含「备注」列与取舍说明 + 非提案行如实标「审批落库（批准）」；⑤`ctx.taken` 随行清单通路在册；⑥提案屏锚与 `docsUpdate` 机械锚双覆盖；⑦`#/report` 报告版循环卡零回潮污染；⑧全程零 `pageerror`。

### 1.55 会话死亡接手裁决 + 概念可见性 V 批落地 + loop-82 客户端批收口 + 审批摘要三态锚即修（loop-83）

> loop-82 会话 14:21 死亡（loop.log 尾=flush on a closed handle）无报告；本轮接手两项裁决并收口死前工作。纯 `plugin/client` + `core_system/web` 增量，零 Go 零 cored 改动。

**裁决 1（dist/src 漂移）**：watchdog 关注的「hydrateTitles 43 行会话标题注水」经 `-S` 全史搜=**从未进入任何提交**——该改进发生在 chat v3（`2b2c681` 会话屏 v3 重建含 sessionRowHtml2 族）之前且已被其取代，非源码丢失；死前盘上真实状态=**概念可见性 V 批完整在 src 而 dist 落后**，按「源码与产物一致性」纪律 V 批整体提交（`workservice@65aaaf6`，web 57 pass 0 fail，esbuild 双跑同 sha `7f2cbf84` 可复现），插件仓 pin 随行（`plugin@e306dd7`；V 批另推 `web-v-batch` 分支保持 gitlink 可解析——main 上有 style-unification agent 并行 WIP 不 rebase 不代收）。
**裁决 2（rv=4 死声称任务）**：四任务 running「拉起中（spawn）」但 `corectl sessions`=0=死声称（cored 重启后旧 spawn 会话全灭、旧 pid 已不存在）；本轮不动写面（勿盲撞并发上限），调度器自愈已重拉——`concept-visibility` rv=6 attempts=1，14:59 三个 core-headless 新进程真实 CPU 活跃（会话租约登记待 agent 首个 heartbeat，下轮观察判据）。
**概念可见性 V 批（workservice@65aaaf6，审计 22 项中 17 项）**：V-01 tag 聚合页（`#/docs/tag/:tag` 第三段=过滤预填+`tags.js` 新屏）+V-03 依赖 chip 深链+V-04 待批行运行详情直达+V-05 会话活性 chip 深链+V-06 chunk/topDocs 对象工作台互链+V-07 Running 徽运行深链+V-08 refs 补 Runbook/DriftReport/DocReview 族+V-10 会话页回链 task/event（`status.agentSession` 反查零编造）+V-11 系统详情 tasks/drafts/runs 三区块+V-12 connector 列互链+V-14 `#/proposals/:name` 直达展开+V-15 批闸后指引+V-16 tagType 词表真源+V-19 BugDoc 入 DOC_KINDS+V-20 模板假卡退役=真对象卡+零在册诚实空态+V-21 通知送达投影落面+V-22 词形复查；**V-02/09/13/17/18 五项未落如实注记**（素材在册后续批）。
**loop-82 客户端批收口（死前已实现未提交，本轮验收后随批提交）**：§16.1 E① `#/wf/:name` 流程图视图关联在册任务卡（机械键=`Task.spec.touches.objects` 写集声明触及本 workflow——scheme.yaml `objects: []ref` 同源；节点级映射契约未携带=不猜按 workflow 级关联；清单不可读=降级词形；异步注水防陈旧守卫 route+name 双检）；§16.1 D② 会话页头触发 wake 上下文卡（最新 `LoopRequested` dedupKey+状态+事件深链+相对时刻；sessionId↔wake 无机械键=卡上显式「非断言本会话由其触发」；`LIVE.state.wakes` 15s 缓存+onChange 单次挂钩守卫）；§16.1 F③ 审批待审行关联任务摘要；§16.1 D 增强 sessionChips 命中任务相位徽+最近动作；L82-01/L82-02 测试锚。
**活体即修（审批摘要三态锚，plugin@4dd7f60）**：U83-04 探针实证 aprel 槽锚只打在命中态——活体唯一待审=Proposal 对象恒零命中致锚恒缺席；即修三态锚 `data-ap-task-rel`=命中数/`0` 零关联/`unreadable` 清单不可读（`aprel-*` 槽容器恒在），L82-02 断言随行三态。
**文档面缺口即修**：instance 仓 S/C/审计三批漏 metadatainfo 侧车（R-DOC-6 FAIL×3）→ 补三篇侧车，`metadatainfo.sh` ✓ 48 篇。

**测试与 UI 拍（loop-83）**：`npm test` **178 pass 0 fail**（L82-01/02+三态锚随行）；web **57 pass**；Playwright 双壳活体拍 `e83-ui.mjs`（零写操作、**11/11 零 pageerror**）：旧壳①loop-82 批四纯函数在册②写集机械键 Kind 命中/撞名不误判③零关联词形+wake 卡深链带 dedupKey/eventId④审批页 aprel 三态槽（anchors=[0,0,0]）⑤会话页不在宿主清单=诚实缺席词形（槽不在=正确降级）⑥流程图 tab 关联任务卡计数头+口径词形；v2 壳⑦V-01 tag 聚合页零崩⑧V-14 提案直达零崩⑨V-20 假模板词形退役⑩welcome 零新增 error⑪全程零 pageerror。

### 1.59 分派链 split-brain 裁决复位 + 孤儿认领归档域收窄 + F-01 入口转正（loop-87）

> 新代三 cored（e5533dfc，18:00 重启窗口）活体闭环实测：孤儿认领**生效但被双调度器竞速抵消**——authority 与 executor 各自 cored 各持独立 ops 库共享同一 docs 任务库，两边调度器都对 console-audit 判据；executor 依其库 17:35 running 锚点在 18:05:11 TTL 到点把刚拉起 4.5 分钟（leaseTtl 30m）的任务判 failed（rv9「租约过期回收重试超上限 attempts=2/2」）。本轮=裁决复位+根因收窄修复+F-01 入口转正。

**活体闭环实录（新代三判据逐项）**：① /proc 直测三 cored exe sha=e5533dfc27077040 一致（18:00 重启窗口零部署动作生效——loop-86 落位项闭环）；② 孤儿认领活体达成：authority 首拍 `adopted=true`，17:35 running 锚点进归档（但其库 core-system.db 无 17:35 running 行——该事件落 executor 库 core-headless.db，跨库失明实证）；③ 任务被拉起：18:00:34 ready→18:00:39 running attempts=2→task-spawn 真拉起 executor host+子 cored+会话写盘（`task-cored-task-843599648`）。④ 但 18:05:11 executor cored 依其库锚点 TTL 判 failed（maxAttempts=2 即上限）——**拉起 4.5m < leaseTtl 30m 即误杀**。⑤ 裁决复位（authority 经 apply 落账 rv10）：phase=verifying，lastAction 写明 split-brain 竞速事实与执行会话证据链（执行会话继续跑，verifying→done 合法通路）。

**根因收窄修复（workservice@070b3e6，L87-01）**：`adoptOrphanLeases` 认领归档域收窄——认领域=「本库归档可见的 running 判定」；在册 running 本库无 running 行=跨域 running（另一实例判定面）→不认领租约起点（不进 TTL 回收路=不误判 failed）+跨域计数日志面；L84-01 原锚全绿+L87-01 回归锚（空档库+在册 running→零认领）。结构性余量如实注记：双实例共享 docs 库的 split-brain 现势未根除（两实例都判据），根治项=scheduler 装配门控（allowApply 才跑调度器）→下一代码轮（涉及新代部署窗口）。

**F-01 入口转正（plugin@28e0ec6 pin 070b3e6，L87-02）**：`/core-console` 与 `/core-console/` 注册为公开壳页 200——34 屏扫描 P0-1（主入口 404、唯一可达词形 /core-console/v2 与任务验收判据「/core-console/ 与 /core-console/v2 均 200」冲突）；公开词形=opts 不声明 reject 键（in 判别区分「未声明栅栏=公开放行」与「显式声明缺席=fail-closed 401」，既有 fail-closed 词形零改动）；数据/写面（api/apply/drafts/ws）栅栏零改动；静态壳页只产 HTML 模板无数据泄漏面。活体生效待宿主重启窗口（plugin src 已落、运行面 plugin 随宿主）。

**部署面随行**：部署 bin 换装=cored sha 前 16=**194873c741f84baf**（trimpath 可复现构建：workservice@070b3e6；非 trimpath 构建因模块版本词形差异不可复现——本轮起 Go 换装一律 trimpath）；旧代备份 `cored.bak-l87-1795717200`（=e5533dfc）；`corectl` 未变（f7259a71944ff1d2 仍权威——本轮零 corectl 改动）。运行代现势=三 cored 仍 e5533dfc（重启窗口后 194873c7 生效）。




| 增量 | 内容 | 验收 |
|---|---|---|
| E0 | §1.2 代理超时修复 + §1.3 连接三态（rotated 指引）【已完成 2026-11-23：机器侧 SSE 心跳（§1.2）+ 三色设计定稿（§1.5），实现落 E1；探针=acceptance/loop-35.md】 | 断连面板可用≥1 个自替换周期 |
| E1 | plugin 注册 slot 壳：八入口导航 + hash 路由骨架 + 连接态灯【实现拓扑与细化验收=§1.6；主案验证通过=顶层导航扩展位（panellist+main 成对注册），回退案未动用】 | 八入口可点、刷新可恢复路由（细化=L36-01…07） |
| E2 | Welcome 大屏 + 系统树（cored 读面：scheme/objects）【已完成 2026-11-23：读面通路=`/core-console/api` 宿主只读代理+cored `GET /v1/events`（§1.8）；五屏真数据=Welcome/系统树/系统详情/对象 viewer/事件详情，其余屏 proto mock 待各自 E 轮；探针=acceptance/loop-37.md】 | 健康度/树真实数据；标识符全可点（细化=L37-01…07） |
| E3 | Workflow 运行管理（列表+详情+运行抽屉）【已完成 2026-11-23：数据面=cored v0.37 `GET /v1/workflows` 聚合投影+run involved 键（§1.9）；写面=宿主 `POST /core-console/apply`（主体宿主注入，唯一写入口零旁路）；启停=override 语义闭环（红线 b）；探针=acceptance/loop-38.md】 | 运行次数/相位/涉及文档可见，启停=Apply 闭环（细化=L38-01…06） |
| E4 | 文档编辑器（草稿→Apply 全流程，dry-run 三检查）【已完成 2026-11-24：数据面=cored v0.38 `GET /v1/history` 应用史投影（apply_log 审计账——历史 tab 权威）；写面=宿主 `POST/DELETE /core-console/drafts` 草稿通道+既有 apply 通路（dry-run 三检查：admit ①scheme②权限零副作用+乐观锁=回执 rv 与稿 baseRV 客户端比对）；屏=viewer 全线升编辑器（四 tab+吸底 dock+确认弹窗）；LLM 提案=非 console 前缀稿队列（mock 对话输入摘除）；探针=acceptance/loop-39.md】 | LLM 提案→人点 Apply→Revision+1 全链路（细化=L39-01…06） |
| E5 | Agent 会话 + 运行器四选 + 终端 tab（dsh 内置 PTY 为主，gotty 跨机兜底；provider 映射=内嵌 dsh/claude-code 现成 subagent provider，opencode/gotty 自写 SubagentProvider——cross-agent.md §5.7）【拆分裁决=§1.11：**E5a 已完成 2026-11-24**——会话屏真数据换装（数据源=dsh session store §3.7 裁决）+发消息真通路（session.prompt queue/steer）+ConnectorOps 卡渲染判别器（声明集判别）+身份回填（status.currentSession=SessionId 文档面落点）+ServiceInstance→Agent 对话跳转；终端 tab=内置 PTY roster 只读+attach 余量标注；探针=acceptance/loop-40.md。**E5b 已完成 2026-11-25**——agent-comm 四 op 工具面（宿主 plugin ctx.tools.register，工具名=协议 op 名裸用；envelope v0.1 全字段校验+to 解析三步+mailbox 幂等落账，§1.12）+声明集种子（WorkService/ConnectorOps agent-comm+core-headless mount 经 apply 落库）→「收到 ConnectorOps 卡」真调用活体达（R-ENG-3 归属注记 core_design rule/rule_eng.md）；探针=acceptance/loop-41.md】 | 能对 Service agent 发消息并收到 ConnectorOps 卡【E5a 细化=L40-01…08；E5b 细化=L41-01…06（真调用卡活体已达=E5 全行收口）】 |
| E6 | 事件流/审批/连接页 + 详情页矩阵互跳【已完成 2026-11-25：数据面=零 Go 改动（读面复用裁决 §1.13）——事件流=三泳道 `eventLaneOf` 映射+聚合面板实数（成功率/token=n/a 不冒充）；审批=待审区（草稿缓存∪ApprovalNeeded 归档）+diff 现读+批准=Apply 全流程复用（dry-run 三检查→fromDraft 落库，fieldManager=console:approve）+驳回=DELETE 弃稿+批量=同 kind 顺序 Apply；连接页=三组 objects 枚举+编辑器 ConnectorOps 第五 tab「运行面」（agent-comm=comm 落账活体：op 计数/拓扑/消息日志 token 打码/envelope v0.1 表）；agent-comm.ts=CommJournal 环形落账（token 值永不入账）+index.ts=`GET /core-console/comm` 读路由（fail-closed 同款）；事件详情=run 反查（eventId 命中→#/wf/:name/r/:n）+/v1/triggers/resolve 锚链——event→run→workflow→doc 链路活体走通；探针=acceptance/loop-42.md】 | event→run→workflow→doc 链路走通（细化=L42-01…07） |
| E7 | 场景面四页 + tag 过滤 + 虚拟滚动大列表【已完成 2026-11-25：数据面=读面复用+一 Go 增量（workservice v0.39 `/v1/events` until 游标——半开窗 [since,until) 向后分页，EventQuery 六参）；事件全局/场景面=screenEventsCore 共用核（过滤条同款+until 滚动加载+合成压测窗=客户端合成展示层不入归档 KI-001 裁决 §1.14）；metrics=空投影诚实空态+即席查询 404 不冒充；docs=scope 枚举+spec.metadata.tags 现读一等过滤器（rv 键缓存+WorkService 读面缺口守卫不发 400 fetch）；permissions=Role/Group/Agent 文档面+挂载声明现读溯源+挂载反查表；收口清扫=总览/palette/文档行真数据+manualTick/newGoal 诚实化（mock 渲染面归零）；探针=acceptance/loop-43.md（prep 21/21+UI 53/53+verify 21/21 含补验；千级合成窗扫掠到底 1665ms/DOM 22 行有界/零 console error/零 4xx）】 | 千级事件滚动流畅（细化=L43-01…07） |
| 对账轮 R-1 | WorkService 单对象读面收口【已完成 2026-11-25（loop-44，§1.15）：storage 模板归 global 桶（声明面 scheme.yaml/concepts/layout.md 四处同步）+docsRoot 迁移（根级 workservices→global/workservices+对象 scope 声明修正）+plugin 两处诚实守卫摘除；探针=acceptance/loop-44.md（prep 27/27+UI 53/53+verify 28/28；旧代双口径 400→新代 scope=global 200 实证）】 | 单对象 GET 可寻址+守卫摘除+迁移零残留（细化=L44-01…05） |
| 对账轮 R-2 | metrics 数据面装配开启 + 阈值声明面最小样本源【已完成 2026-11-25（loop-45，§1.16）：三 profile 锚 `--metrics-source` 装配开启（carrier 随载体重启轮换代）+docsRoot notify 对象 observation.metrics 最小声明（桥点火演示口径）+metricsrc.BindWorkservice involved 三段同构（kind/scope/name 惯例——console 事件链两段死链修正）+采样器窗口半开对齐 E7 纪律；cored-bridge v0.31 stale 余量注记修正；探针=acceptance/loop-45.md】 | `/v1/metrics` 真实样本+MetricThreshold 落 run 三段 involved 可导航（细化=L45-01…07） |
| 对账轮 R-3 | approval_log 审批判定独立账【实现拓扑与细化验收=§1.17（loop-46）：opslog approval_log 表+读写面（schema v0.46 修订——v0.9 A44 声明收编落地）+apiserver 两写钩子（批准 granted/驳回 rejected——驳回零留痕缺口收口）+`GET /v1/approvals` 读面+console 审批屏「已决账面」现读区块】 | 批准/驳回判定独立账面可查（细化=L46-01…07） |
| 对账轮 R-4 | metrics 阈值声明面 apply 事件驱动热重绑【实现拓扑与细化验收=§1.18（loop-47）：桥契约重构（样本流桥级单通道+Source=纯绑定声明——重绑 O(1) 零通道抖动）+`Bridge.Rebind` 绑定表整体替换（零绑定=合法等待态，no-source 终态退场）+`StartRebind`（DocApplied×WorkService 过滤+积压合并+失败保旧表自愈）】 | 阈值声明 apply 落库即生效免重启（细化=L47-01…07） |
| 对账轮 R-5 | docsRoot 存量对象净入 lint 面【实现拓扑与细化验收=§1.19（loop-48）：checker 存量面应用点=workservice `cmd/cored-lint`（五闸=路径注册/可解析/身份一致/spec 准入/凭据来源，写路径同清单）+scheme 镜像漂移闸（双源系对账收口）+core_design lint/docsroot-admission.sh wrapper（R-TYPE-2 双向可追溯）】 | 存量坏对象可检出且与写面判定一致（细化=L48-01…06） |
| 对账轮 R-6 | Role/Group 文档面对象 + 权限矩阵 Role 列激活【实现拓扑与细化验收=§1.20（loop-49）：core-docs 内容轮（global/roles/admin + global/groups/core-operators——声明面在位的纯数据轮）+console live 小对象现读扩 Role/Group+permissions 屏「Role 授权矩阵」spec 现读区块；零 Go 改动=装载/热装载/ApprovalNeeded 产源皆既有】 | docsRoot Role/Group 对象净入授权面+involved 实体化+UI 矩阵激活（细化=L49-01…07） |
| 对账轮 R-7 | workflow 执行模型绑定面：execution 判别器 + apply 即实现骨架物化【实现拓扑与细化验收=§1.21（loop-50）：workservice v0.49 `internal/flowbind`（绑定物化器=装配期枚举+DocApplied×Workflow 热路径，走 apply 闸门 fieldManager=workflow:bind，origin=workflow-bind 所有面）+聚合面 execution 投影+scheme.yaml ConnectorOps flow 声明+docsRoot workflow-engine 宿主 WorkService+console workflows 屏执行 chip】 | apply 即同名 ConnectorOps 骨架出现且 diff 可查+决策面 execution=unbound 可见（细化=L50-01…09） |
| 对账轮 R-8 | apply-workflow agent 派单面：骨架物化即派单受理投影【实现拓扑与细化验收=§1.22（loop-51）：workservice v0.50 flowbind `dispatch.go`（DispatchLog 环=wake 同构——created/updated 即派单，noop/skipped 不派单，autoLevel=ask 数据面）+`GET /v1/agents/dispatches` 读面+console wf 详情骨架态派单行；受理≠拉起——真实拉起=dsh 会话挂载 declared-deferred】 | 骨架物化即 apply-workflow 派单受理投影可查且幂等/所有面/元数据变更零噪音（细化=L51-01…09） |
| 对账轮 R-9 | build 生效链判别面：骨架产物 digest ↔ apply_log 绑定行 rv 对账 + 流程图骨架节点升格 + apply-workflow 拉起投影面【实现拓扑与细化验收=§1.29（loop-57）：workservice v0.55 flowbind `execution.go`（Reconcile 判别投影——skeletonRv↔lastBindRv 对账 chain 三词 consistent\|divergent\|absent 缺口词形可见+NodesOf 单点真相）+聚合面行集四新键 reconcile/executionFlow/executionDigest/executionHistory+派单行 nodes 键（拉起输入面首件）+console 生效链列/详情行/流程图骨架节点×run 相位对账投影（节点态四词着色 ◉✓○⤫）；真实执行仍 observe（红线 a）】 | 骨架 digest↔绑定行 rv↔execution 绑定态三件联动可查∧链分裂/divergent 缺口可见∧流程图节点态着色数据面可查∧UI 截图（细化=L57-01…11） |
| 用户裁决 能力 B | 需求提交流：console 提交需求 → Proposal 对象 → 审批 → 自动落文档/派工【实现拓扑与细化验收=§1.24（loop-52）：workservice v0.51 `internal/proposal`（分流 watcher=DocApplied×Proposal 订阅——approved 即 apply-workflow 派单 kind=proposal 行/auto-approve 引擎自写 fieldManager=proposal:auto/高危提交 ApprovalNeeded 自产 source=core）+`GET /v1/proposals` 读面+apiserver `console:reject` 对称扩展（rejected 行+ApprovalRejected 事件）+core_design kind:Proposal+concepts/proposal.md+console「需求提案」屏（表单/列表/详情/批准/驳回）】 | 界面提交→Proposal 在库（rv=1 submitted）∧批准→approved+派单投影+eventId 同源∧驳回→rejected+无派单∧分流可配（细化=L52-01…09） |
| 用户裁决 能力 A | 设计文档在线编辑：console 屏幕 6 直接改 md → Apply → git commit【实现拓扑与细化验收=§1.26（loop-53）：workservice v0.52 `internal/docrepo`（受限文件面路线②——`--design-repo` 白名单+git HEAD 读面+三检查 403/400/409+权限域 core/design-docs+本地 commit 不 push）+`/v1/design-docs*` 面+plugin `/core-console/design-docs` 写路由+console 屏 6「设计文档」页签+`#/designdoc` 工作台（文件树/编辑器/diff/Apply）+审批屏 DesignDoc 稿；cored-bridge.md §2.4+scheme.yaml Role 词汇 core/*】 | 打开概念文档→编辑 Apply→目标仓新 commit+DocApplied 同源+审计在账∧409/403/400 判据三件∧UI 截图（细化=L53-01…08） |
| 用户裁决 能力 D | 需求提案对话式录入 + R-UX-1 通用对话交互框架 + R-UX-2 scheme 驱动控件【实现拓扑与细化验收=§1.27（loop-54）：workservice v0.53 `internal/scheme/widgets.go`（8 类控件机读派生+`Scheme.Replace` 热刷新）+`internal/intake`（R-UX-1 六步对话引擎：自由描述多字段抽取/自动补充/缺失冲突询问/提交节点生成+三重 dry-run 字段级归因/会话版本留痕不入公共库）+`/v1/intake/*` 面+plugin `/core-console/intake` 写路由+console 通用对话录入组件与 scheme 控件渲染器（`#/proposals` 默认对话态+字段卡双向同步+预览确认+降级表单+对象编辑器 scheme 控件面板）】 | 零起点 ≤6 轮对话字段全绿∧只问缺失冲突项∧生成对象过三重 dry-run 且失败定位字段∧确认后 rv=1 submitted（高危产 ApprovalNeeded）∧控件=scheme 映射且改 scheme 自动反映∧降级表单可用∧UI 截图（细化=L54-01…07） |
| 用户裁决 能力 C | console 原生整合 + Workspace 按 Service + §11 全量整改【实现拓扑与细化验收=§1.28（loop-55）：dsh Slots 主侧栏九项+壳去第二列 nav+宿主 token/字号/间距/数据呈现/交互全量整改；plugin `/core-console/service-projects` + `ctx.workspaces`/`ctx.sessions` 最小 Service→Workspace 映射；profile patch 锁定+目录权限；零 dsh 安装包改动】 | 九项/无第二列 nav/独立页 200∧原生 token∧Service project 与新会话归组∧旧会话可访问∧E1/E2 API 404+CLI 拒绝∧E3 不 fork∧截图与回归全绿（细化=L55-01…12） |
| 对账轮 R-10 | agent-session 域 SelfHeal 注入执行面真实接线 + 派单 ask 批准动作面【实现拓扑与细化验收=§1.30（loop-58）：workservice v0.56 sessionliveness SelfHealBridge 接口+SetSelfHealBridge 装配（env CORE_SYSTEM_SELFHEAL_ADDR 回填——dsh 宿主 loopback listener→sessionController.prompt mode=queue 注入固定词「继续」）+BeatSource 观测续租（不触发 SessionHealed）+心跳防伪（HTTP 面拒收 source=watchdog）+flowbind approval.go（DispatchLog 同拍挂 pending 批准投影→Apply workflow:approve\|reject ok 行原地翻转 approved\|rejected）+派单行 approval 键；spawn 接线=declared-deferred，approved 派单投影≠拉起】 | 注入停滞→prompt 注入「继续」（healed-by-beat 词形）∧失败重试不静默∧纯观测回归不破∧心跳防伪 400∧批准投影翻转可查（细化=L58-01…07） |
| 对账轮 §1.25 | console 通知中心收件箱（四类汇总页面兜底）【实现拓扑与细化验收=§1.31（loop-58）：workservice v0.56 `flowbind.BuildInbox`+`GET /v1/inbox`（NeedsHuman∧Escalate/ApprovalNeeded+批准挂起/Proposal submitted/DocReview 草稿四类机械自分类——行 link=console 深链路由，watchdog={approvals,pending,approveIdle} 真实词形）+console `#/inbox` 屏（四类 chips/条目深链/空态显式/watchdog 观测面）+总览 metric 卡+palette 动作+inboxCount 回落口径】 | 四类待办计数可查∧条目可点达操作面∧无通道=页面兜底可见∧空态显式（细化=L58-UI-01…04） |
| 对账轮 §1.32 | 收件箱四类深链操作面活体判定+事件回链闭环+spawn 接线声明投影【实现拓扑与细化验收=§1.32（loop-59）：workservice v0.57 批准投影行集升格（ApprovalNeeded 挂起行进行集——计数=行数同源不翻倍+`ApprovalSpawnDeclaration` 纯函数——派单行 `spawn` 键 `{declared,wired:false,target,approvalId,rv,eventId}` 判定权威=apply_log 行）+console 类内 op 落点消费与轻刷新回链判据；真实拉起仍 deferred（红线 a——wired 恒 false 机械锚）】 | 四类各自落点屏渲染活体∧挂起行进行集（幽灵计数收口）∧操作完成 inbox 下次装载反映∧spawn 声明词形 wired=false∧截图（细化=L59-01…05+L59-UI-01…04） |
| 对账轮 §1.33 | 派单批准动作面 console 动作化+判定源族收口【实现拓扑与细化验收=§1.33（loop-60）：workservice v0.58 动作面 console 动作化（`disp-approve\|disp-reject`=Apply 判定通路+同拍判定行在账+挂起行已判过滤）+v0.58a 判定源族收口（`DecisionJudgmentFamilies` 族表=workflow:\*+console:\* 两族——GAP-Q60-2 活体实证缺口收口）+plugin 动作判定 Apply 原文随行（content='' 活体 400 收口）】 | dry-run 零副作用∧动作拍判定行在账∧同拍投影翻转+spawn 声明（wired=false）∧回链闭环拍即生效∧驳回对称∧proposal 全链收口词形∧UI 截图（细化=L60-01…06） |
| 对账轮 §1.34 | needsHuman Escalate 行 digest 尾随空串收口+触发路径 spec.enabled 实时 honoring【实现拓扑与细化验收=§1.34（loop-61）：workservice v0.58b `inboxDigestOf` 单点拼装（involved 缺席=降级词形「（involved 缺席）」——纯展示面零判定语义）+v0.62 `EnabledRules` 规则开关判定面（`EnabledOf` precedence=系统层 override→global 本体→零对象缺省启用，聚合面 effectiveObject 同口径）+StartRun 受理路径闸判（run 不落 disabled 计数可见）+装配层 resolver 注入（零缓存热装载）】 | digest 降级词形∧eventId 深链不变∧历史行投影自愈∧enabled 闸三拍活体（precedence 放行/闸拦/复位放行）∧disabled 新载荷键∧在途 run 零改动∧UI 截图（细化=L61-01…03） |
| 对账轮 §1.35 | E5b chat-backfill 结构化合并收口 + E6 审批积压族扩与收件箱族内落点分化【实现拓扑与细化验收=§1.35（loop-62）：零 Go 改动 plugin 客户端面——`mergeCurrentSession` 结构化合并纯映射三分支（键级重写/块内追加/文末追加，零盲写=块外字节恒等，同参回放=幂等 noop，预读缺席=诚实降级）+`approvalBacklog()` 积压族三源单一真相（ApprovalNeeded 归档∪submitted 提案∪派单 pending）+`inboxOpOf` 族内落点分化（dispatch 行→wf 配置 tab 批准动作面）】 | 结构化合并活体（已有 status 块 Agent 回填 rv 前进∧其余字段零盲写）∧同值幂等 noop∧积压族三源聚合+构成词形∧收件箱 dispatch 行落点 wf 配置∧UI 截图（细化=L62-01…04） |
| 对账轮 §1.36 | E6 泳道族源分化核验收口：积压族四源分解+族总数单点+DocReview 行真操作面补缺【实现拓扑与细化验收=§1.36（loop-63）：零 Go 改动 plugin 客户端面——`approvalBacklog()` 四源分解单一真相（草稿待审∪ApprovalNeeded 归档∪submitted 提案∪派单 pending——drafts∪归档两子源自 pendingApprovals 分化）+`backlogCount()` 族总数单点（badge/updateCounters/palette/Welcome 卡同一函数——提案/派单两源计数缺席收口）+在册稿窗降级草稿基座（screenEditor 在册守卫+hydrateEditor face 404 不拒单——新对象首稿 DocReview 行真操作面，「对象不在册」死面收口）】 | 草稿在册活体（四源分解词形∧DocReview 行 link=编辑器屏深链非审批屏）∧草稿行真操作面（编辑器+apply dock enabled）∧族总数单点（approvalCount=四源和∧badge 同值）∧零副作用收尾（弃稿回基线∧无稿窗归零诚实）∧UI 截图（细化=L63-01…04） |
| 对账轮 §1.37 | E5b chat-backfill 结构化合并余量词形收口：缩进自适应（混合缩进容忍）+ E5a 冷会话空窗余量评估【实现拓扑与细化验收=§1.37（loop-64）：零 Go 改动 plugin 客户端面——缩进基准自适应（ind=首个空格缩进行观测，追加键组=基准×2 族谱对齐）+tab 防御闸收窄（整篇拒绝→手术区限定面：仅 status 块/currentSession 子块 tab=拒绝，手术区外 tab 放行）+currentSession 子块成员=纯列宽模型（任意更深列=成员区）+重写键组缩进=成员缩进观测（族谱对齐；多态/嵌套续行=保守拒绝；空子块回退基准）+纯映射语义零变更（零盲写/幂等 noop/三分支不变）；E5a 冷会话空窗=评估维持 declared（诚实降级口径+宿主历史回放读面缺席≠fork 事由）】 | 混合缩进文档回填活体（生产词形 ok=true∧块外字节恒等∧手术区外 tab 保留）∧缩进族谱对齐（4 空格文档 8sp 重写/4sp 追加∧cs 键分家 6sp 族谱内回填）∧真缺席恒拒绝（无 metadata.name/手术区 tab）∧同值幂等 noop∧既有 2 空格锚零回归∧UI 截图（细化=L64-01…04） |
| 对账轮 §1.38 | E6 四源积压词形单点复核：族构成声明单点收口+draft-only 稿 Apply 创建通路活体评估（域内判据集实施）【实现拓扑与细化验收=§1.38（loop-65）：零 Go 改动 plugin 客户端面——`backlogFamilyNote()` 族构成词形单点声明（short∧long）三消费点（Welcome note/palette/聚合面板）单点拼装（backlogCount 计数单点 §1.36 既有零回潮——文字词形散用漂移温床收口）+draft-only 创建通路最小活体判据集（A 段 API=缺席窗诚实+落稿 baseRV=0 创建稿+dry-run 三检查创建哨兵 rv=0+幂等回放+零副作用反证 apply_log=0；B 段 UI=faceAbsent 降级基座词形+dock enabled+弹窗三检查 r0 哨兵词形+零确认+弃稿回基线）；真落库 once-only 执行拍=declared 判据集在案（零副作用纪律——本轮零点）】 | 四消费点同源活体（卡值=badge=族构成实数和）∧词形单点锚定（回潮即红）∧dry-run 创建哨兵（action=dry-run∧rv=0∧幂等∧apply_log=0）∧draft-only 窗 UI（chip 词形∧dock enabled∧r0 哨兵词形∧零确认零落库∧弃稿回基线）∧零 pageerror∧UI 截图（细化=L65-01…04） |
| 对账轮 §1.39 | draft-only 稿 Apply 创建通路真落库执行拍（§1.38 余量首候选——判据集在案 once-only 执行）【实现拓扑与细化验收=§1.39（loop-66）：既有面执行拍零新代码（client 编辑器 apply dock+宿主 apply/drafts 路由+cored apply 写面——零 Go 改动零 plugin 改动）；专用锚 l66-apply-probe 域内三段=创建拍（缺席诚实→落稿 baseRV=0→dry-run rv=0 哨兵→**create rv=1**→DocApplied eventId 同源→apply_log r1 ok 判定行→稿清 rule 6→noop 复跑拍→ErrNoDraft 404）+UI 拍（编辑器活体→手动编辑落稿→弹窗三检查 r1 更新哨兵→**确认键真点**→真落库 toast）+终态复核（rv=2 恒∧apply_log 4 行 noop:r2\|ok:r2\|noop:r1\|ok:r1∧DocApplied=2 恒∧UI noop 结构守卫词形）；判据词形校准两件=落库正文∪rv 反写行∧UI 确认通路=dock 差异武装只产 update（noop 结构不可达——API 复跑拍承载）】 | create 拍 rv=1∧apply_log 判定行（create∧rv=1∧console fieldManager）∧DocApplied 事件行∧稿清归零∧幂等复跑（noop 恒值+ErrNoDraft 双分支在账）∧UI 确认活体+真落库 toast∧锚留账收尾（rv=2 对象在册不删=判别面域）∧零 pageerror∧UI 截图（细化=§1.39 执行拍实录三段） |
| 对账轮 §1.40 | 历史 rv 正文读面（rev-content diff 面）——历史 tab「点行 diff 上一版」余量当轮收口【实现拓扑与细化验收=§1.40（loop-67）：三路评估判定②域内可实施——读半边 Go（workservice v0.63 `GitRepo.RevContent` 快照语义=最新携带该 rv 反写行的提交+blob 元数据 rv=唯一判据+ErrRevNotFound 分立+gitRaw 未修剪 stdout+`GET /v1/rev-content` 词形族+`WithRevContent` 口面+git 后端恒注入装配）+消费半边 plugin（v0.67 hydrateHistory ok 行可点 hist-diff+hist-diff-box diff 面板+起点词形+余量标注摘除——零缓存零写路径）；cored v0.62→v0.63 换代+gate 同步；判据词形校准=手编 docsRoot 通道快照语义裁决∧快照含文末换行】 | 既有对象 rv=1 快照 200∧锚缺席窗 404 分立词形∧create→快照逐字节恒等（文末换行在册）∧第二拍 update→rv=2 快照∧rv=1 恒（历史不可变）∧两版分立+rv 行各自 1/2∧noop 复跑 rv 恒+apply_log 3 行∧UI 点行 diff 活体（noop 不可点+面板词形+add/del）∧零 pageerror∧UI 截图（细化=L67-01…07） |
| 对账轮 §1.41 | cored-bridge.md §2 随行补记 rev-content 读面+docsRoot 探针残留清场（§5 清场纪律执行）【实现拓扑与细化验收=§1.41（loop-68）：队列 1 三项零变化判定（object 触发声明面/watch-only 红线 a 域/E5a declared）+队列 2 文档面缺口当轮收口——cored-bridge.md §2 补 `GET /v1/rev-content` 行（词形族全量+快照语义+对象删除后历史快照恒可达注记）∧§1 v0.63 在运代注记（sha/rev 入部署台账不入公开仓）；docsRoot 43 件探针残留移除+手编通道 git commit（ops DB 账本不删=判别面域）；判据词形校准三件=落库正文判据词形（稿正文∪rv 反写行）∧删除后快照延伸两态分立∧清场后渲染面账本词形分立（残留断言勿扫事件账本词形域）；零 Go 零 plugin 改动】 | 部署判据（v0.63 读面在运）∧清场判据（零残留词形+已清锚 404∧快照 200 分立+history 行不删）∧桥契约增量零回归（词形族分立+宿主代理）∧文档机械面（§2 行+§1 注记）∧判据链复核（快照逐字节恒等）∧UI 零回归（点行 diff 活体+零 pageerror）∧UI 截图（细化=L68-01…07） |
| 对账轮 §1.42 | 清场常态化首拍+cored-bridge.md §2 桥契约机械对账复核+删除后快照两态分立新实证【实现拓扑与细化验收=§1.42（loop-69）：队列 1 三项零变化判定维持顺延（object 触发声明面/watch-only 红线 a 域/E5a declared——connector watch 声明面现势零变化升格不触发）+队列 2 两件——①P-02 残留断言判据位常态化首拍（四清场域对象清单零探针残留词形，零回潮零清场动作）②§2 代码路由集 43 条↔行集 43 行双向差集=0（loop-68 补记后完整性复核——「同范式随行补记」不触发）；现势发现两件=core-headless 载体已自然换代（三 web 同代 v0.63）∧l68 判据锚对象面巡检移除（两态分立活体锚恒可复验——账本+快照在判别面域）；零 Go 零 plugin 改动】 | 部署判据（三 cored 子进程 sha=v0.63 含载体）∧清场残留断言首拍（四域零残留词形）∧删除后快照两态分立（l68 锚现势 404∧rv=1 快照 200∧history 行不删）∧投影面零回归（聚合/inbox/triggers）∧桥契约机械对账（§2 双向差集=0）∧队列 1 零变化机械面（flowbind 零 triggers 词形∧wired 锚在位）∧UI 零回归（点行 diff 活体+零 pageerror）∧UI 截图（细化=L69-01…07） |
| 对账轮 §1.43 | 清场残留断言第二拍+cored-bridge.md §2 机械对账解析器范式升格（缺行补记）+部署路径泄漏红线域收口【实现拓扑与细化验收=§1.43（loop-70）：六仓零新提交=CTX 声明面对账专项判零现势变化（R-CTX-1..6+conventions.context 在册∧运行时零落点=connectops-context 归 deploy-system 域同源顺延）+队列 1 判据词形随行校准（connector watch 桥声明面在册——旧「零 Watch 驱动实现」词形过时摘除；升格判据=契约域零 receiver 实现∧生产装配旗标缺席（--watch-source off）∧live types=["*"]）；缺口收口两件=①P-01 personal-info 闸 instance FAIL（§1.33/§1.42 两处部署路径词形——R-PUB-3）→ 占位符收口六仓 ✓（自此入每轮质量闸必查判据位）②P-03 §2 行集机械解析直测出缺行 GET /v1/proposals/{name}（loop-69 复核=代码↔硬编码转录清单非文档侧直测）→ 当轮补记独立行 43↔43 双向差集=0 可复现解析器；零 Go 零 plugin 改动，零锚落库零写路径】 | 部署判据（三 cored 子进程 sha=v0.63）∧清场残留断言第二拍（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立）∧队列 1 判据面升格三词形∧桥契约解析器直测双向差集=0∧投影零回归∧CTX 专项零变化判定∧UI 零回归（点行 diff 活体+零 pageerror）∧UI 截图（细化=L70-01…07） |
| 对账轮 §1.44 | 队列 1 三项+CTX 零变化判定维持顺延+清场残留断言第三拍（双域）+§2 解析器范式随行直测【实现拓扑与细化验收=§1.44（loop-71）：六仓零新提交=CTX 与队列 1 同源零变化基线+队列 1 三项零变化判定维持（object 触发声明面升格判据三词形全数复验/watch-only 红线 a 域 wired 恒 false/E5a declared）+CTX 声明面零变化同源顺延（conventions.context∧R-CTX-1..6 在册∧运行时零落点）+队列 2 三判据位随行拍全绿（P-02 第三拍双域零残留+l68 锚两态分立复核；§2 解析器随行直测 43↔43 双向差集=0 未回退硬编码转录；P-01 personal-info 六仓 ✓ 零回潮）；零 Go 零 plugin 改动零文档面语义变更，零锚落库零写路径】 | 部署判据（三 cored 子进程 sha=v0.63 四连轮零换代）∧清场残留断言第三拍（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立）∧队列 1 判据面三词形零变化∧桥契约解析器随行直测双向差集=0∧投影零回归∧CTX 零变化判定∧探针纪律零外发∧UI 零回归（点行 diff 活体+零 pageerror）∧UI 截图（细化=L71-01…08） |
| 对账轮 §1.45 | 队列 1 三项+CTX 零变化判定维持顺延（第三连拍）+清场残留断言第四拍（双域）+§2 解析器范式随行直测【实现拓扑与细化验收=§1.45（loop-72）：六仓零新提交=CTX 与队列 1 同源零变化基线第三连拍+队列 1 三项零变化判定维持（object 触发声明面升格判据三词形全数复验/watch-only 红线 a 域 wired 恒 false/E5a declared）+CTX 声明面零变化同源顺延第三连拍（conventions.context∧R-CTX-1..6 在册∧运行时零落点）+队列 2 三判据位随行拍全绿（P-02 第四拍双域零残留+l68 锚两态分立复核；§2 解析器随行直测 43↔43 双向差集=0 未回退硬编码转录；P-01 personal-info 六仓 ✓ 零回潮）；零 Go 零 plugin 改动零文档面语义变更，零锚落库零写路径】 | 部署判据（三 cored 子进程 sha=v0.63 五连轮零换代）∧清场残留断言第四拍（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立）∧队列 1 判据面三词形零变化∧桥契约解析器随行直测双向差集=0∧投影零回归∧CTX 零变化判定∧探针纪律零外发∧UI 零回归（点行 diff 活体+零 pageerror）∧UI 截图（细化=L72-01…08） |
| 对账轮 §1.46 | 队列 1 三项+CTX 零变化判定维持顺延（第四连拍）+清场残留断言第五拍（双域）+§2 解析器范式随行直测【实现拓扑与细化验收=§1.46（loop-73）：六仓零新提交=CTX 与队列 1 同源零变化基线第四连拍+队列 1 三项零变化判定维持（object 触发声明面升格判据三词形全数复验/watch-only 红线 a 域 wired 恒 false/E5a declared）+CTX 声明面零变化同源顺延第四连拍（conventions.context∧R-CTX-1..6 在册∧运行时零落点）+队列 2 三判据位随行拍全绿（P-02 第五拍双域零残留+l68 锚两态分立复核；§2 解析器随行直测 43↔43 双向差集=0 未回退硬编码转录；P-01 personal-info 六仓 ✓ 零回潮）+race 闸并发包清单现势校准复核（goroutine 派生词形全仓扫描=清单 7 包完备零调整）；零 Go 零 plugin 改动零文档面语义变更，零锚落库零写路径】 | 部署判据（三 cored 子进程 sha=v0.63 六连轮零换代）∧清场残留断言第五拍（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立）∧队列 1 判据面三词形零变化∧桥契约解析器随行直测双向差集=0∧投影零回归∧CTX 零变化判定∧探针纪律零外发∧UI 零回归（点行 diff 活体+零 pageerror）∧UI 截图（细化=L73-01…08） |
| 对账轮 §1.47 | 队列 1 三项+CTX 零变化判定维持顺延（第五连拍）+清场残留断言第六拍（双域）+§2 解析器范式随行直测+race 并发包清单现势校准复核【实现拓扑与细化验收=§1.47（loop-74）：六仓零新提交=CTX 与队列 1 同源零变化基线第五连拍+队列 1 三项零变化判定维持（object 触发声明面升格判据三词形全数复验/watch-only 红线 a 域 wired 恒 false/E5a declared）+CTX 声明面零变化同源顺延第五连拍（conventions.context∧R-CTX-1..6 在册∧运行时零落点）+队列 2 三判据位随行拍全绿（P-02 第六拍双域零残留+l68 锚两态分立复核；§2 解析器随行直测 43↔43 双向差集=0 未回退硬编码转录；P-01 personal-info 六仓 ✓ 零回潮）+race 闸并发包清单现势校准复核（行首派生词形全仓扫描=清单内 watchsrc=1/workflow=2/metricsrc=1/repository=4 与 loop-73 台账逐包一致∧清单外包零行首派生=清单完备零调整；行内 `go func` 词形四包假阳性域识别——判据词形基准=行首派生，P74-08 机械断言入探针常态化）；零 Go 零 plugin 改动零文档面语义变更，零锚落库零写路径】 | 部署判据（三 cored 子进程 sha=v0.63 七连轮零换代）∧清场残留断言第六拍（对象清单面+docsRoot fs 直扫面双域零残留+l68 活体锚两态分立）∧队列 1 判据面三词形零变化∧桥契约解析器随行直测双向差集=0∧race 清单校准（清单外包零行首派生）∧投影零回归∧CTX 零变化判定∧探针纪律零外发∧UI 零回归（点行 diff 活体+零 pageerror）∧UI 截图（细化=L74-01…09） |
| 界面用户视角 §1.48 | R-UX-3/4/5+§13 落地（loop-75）：文案人话化（字符串域零「面」族+零里程碑词形——双拍机械断言）+渲染优先（console-md.js 渲染器+XSS 红线+字段卡/YAML 次级+编辑器双视图）+系统视角首屏（系统卡+入口卡四张+文档退折叠次级）+dsh 原生 token（零新色值断言）【实现拓扑与细化验收=§1.48；纯 plugin/client 零 Go 零 cored】 | §13.4 判据四项全绿（npm 145 pass+prep 16/16+UI 11/11 零 pageerror+截图 4 张）∧mirror 基线 files=18 findings=0 ok（镜像随行同步 commit a0246bd）∧探针零外发零锚落库 |
| 提案×上下文对照卡 §1.49 | 053dd1a+§4.6 落地（loop-76）：console-ctx.js 对照模块（确定性检索 conflicts/supplements+ref+hash）+提交节点随行（intake-generate/prop-submit 双入口）+对话区独立卡（冲突可展开/补充一键随行）+审批屏同屏携带（折叠次级+缺位降级可见）+degraded 不阻断+sig 复用【实现拓扑与细化验收=§1.49；纯 plugin/client 零 Go 零 cored】 | §12 机读判据全绿（三态必现其一+hash 一致+一键加入+审批屏同屏+rv=1+截图+零 pageerror——UI 11/11）∧npm 151 pass（+4 L76 锚）∧mirror files=19 findings=0 ok（开局修复镜像漂移 commit c069f1e）∧P-02 第八拍 CLEAN-OK（探针 l76 清场 commit 991dc82） |
| 降级重试+R-UX-8 活体 §1.50 | 053dd1a 余量③+console-ui.md §15（loop-77）：对照卡降级重试（ctx-retry 按钮+refresh/yamlOf+cxs 盖戳+precheckFields 单源化）+R-UX-8 §15.3 六条活体对账（本轮自身=wake 桥拉起证据链+cli-rule-verify 运行中到达单飞 pending 持久化）+新代际随行对账（cored 45d79a06/R-DOC-7 三仓/attention 405 顺延）【实现拓扑与细化验收=§1.50；纯 plugin/client 零 Go 零 cored】 | npm 153 pass（+L77-01；e2e 夹具补 --docs-backend git 兼容）∧UI 拍 6/6 零 pageerror（降级→重试→恢复活体链路+103 份现读）∧R-UX-8 判据①②④⑤ 活体+③⑥ 机械面替代注记∧mirror files=18 findings=0 ok（双 sha 30d9c496）∧P-01 六仓 ✓∧P-02 第九拍 CLEAN-OK（四域基线一致零残留） |
| 通用对象工作台 §1.51 | R-UX-7+console-ui.md §14.5（loop-78）：console-obj.js 新模块（六片同一套——tagType 分组/规则确定性命中四路来源显式/结构段完成度/ctx 摘要/kinds 载荷声明投影 kindRegYaml/六片渲染纯函数）+screenObjWorkbench 屏本体（#/obj/:kind/:scope/:name+kind 别名两段+裸词缺省对象三路由；左清单 tag 联动/中六片/右对话栏——对话=一等片深链带对象引用）+loader 注入（规则文档族全文现读+metadatainfo tagType 词表，120s 缓存失败降级）+首屏取代 Welcome（§14.0：entry 面板 route=#/obj+空段/裸词重定向+侧栏首位）+css 布局块零新色值【实现拓扑与细化验收=§1.51；纯 plugin/client 零 Go 零 cored——R-UX-6 报告首屏（#/v1/attention）仍 405 顺延，工作台=§14.5 内不依赖 attention 的先行面】 | npm 155 pass（+L78-01/L78-02+L36-03 锚随行）∧UI 拍 7/7 零 pageerror（六片齐全/规则 8 份现读命中 6/规则原文 designdoc 深链可达/首屏 #/obj→缺省对象活体）∧mirror files=18 findings=0（双 sha 30d9c496——scheme 未提交态沿用）∧P-01 六仓 ✓∧P-02 第十拍 CLEAN-OK |
| 任务中心与关注报告 §1.52 | R-UX-6+console-ui.md §16/§14+task-scheduler.md §4（loop-79）：插件 mountTaskSpawnBridge（POST /task/spawn 固定命令+stdin 喂 taskPath+单飞锁）+console-tasks.js 模块（groupTasks 五组人话词形+statusOf/specOf 列表扁平行与详情嵌套形双形态归一+runningCount+sessionChips+evidenceRoute+windowLabel `{from,to}`→`24h` 消解 `[object Object]`+loader 注入）+app 三屏（#/tasks 任务中心·#/task/:id 任务详情·#/report 关注报告）+工作台 objOpsFor 补 Session/Task 操作片深链（loop-78 队列 3①）+entry 侧栏 11 入口【实现拓扑与细化验收=§1.52；三 cored 换代 3fa671f0 后 /v1/attention 与 /v1/tasks 双解锁活体】 | npm 160 pass（+L79-01/L79-02+taskspawn 3 锚+L36-02 随行）∧UI 拍 7/7 零 pageerror（#/report 活体 5 卡+窗口 24h 零 `[object Object]`+证据深链可点 / #/tasks 扁平行归一运行中 1+正在做组 / #/task/:id ≤2 次点击三行+双卡 / 工作台 Task 操作片深链跳达）∧mirror files=18 findings=0（双 sha b1d4034f 同步）∧P-01 六仓 ✓∧P-02 第十一拍 CLEAN-OK |
| 工作台 trace/上下文+sqlite 历史+循环卡 §1.53 | R-UX-7 深化+R-DOC-9+R-DOC-7+console-ui.md §16.1 C（loop-80）：console-obj.js 接入 `/v1/trace/{kind}/{scope}/{name}`（双向 `implements/implemented_by/verified_by`+`stale` 待对齐徽+可点互跳）与 `/v1/context/find`（Top5 相关对象）+标签「补标」入口+工作台编辑判据 `!kindReg.builtin`→`kindReg.storage` 活体缺陷即修；编辑器历史 tab 接入 `/v1/doc-history/{kind}/{name}` 双轨呈现+修复 `hist-diff` 误跳过 `rv=1`+`revSourceLabel` 区分 `sqlite-doc-history` 与 `git`+`prev` 404 优雅回退；console-tasks.js 新增 `loopCard()`（`#/report` 当前循环卡四态+「会话型任务（无 workflow run）」显式标注）【实现拓扑与细化验收=§1.53；纯 plugin/client 零 Go 零 cored】 | npm 163 pass（+L80-01/02/03）∧UI 拍 8/8 零 pageerror（工作台 `/v1/trace`+`/v1/context/find` 5 条+互跳+补标 / `#/report` 循环卡 active / 历史 tab `doc_history`+r5 diff r4+r1 起点修复+Agent r13 prev 404 回退）∧P-03 52↔52=0∧mirror files=18 findings=0（双 sha b1d4034f）∧P-01 六仓 ✓∧P-02 第十二拍 CLEAN-OK |
| Workflow/审批联动+supplements 载荷+引用即修 §1.54 | console-ui.md §16.1 C/E/F + proposal.md §4.6 对照卡余量①②（loop-81）：console-tasks.js 抽提 `loopCardFor`/`wakeRunWord`；`#/wf/:name` 页头挂载 `wfLoopCard` 环绕循环卡（显式标注「loop 唤醒≠该 workflow run」与「会话型任务（无 workflow run）」）+运行抽屉追加「事件对账 run」型徽与 `SessionLog` 空态活跃会话深链（`sessLogSlotHtml`）；`#/approvals` 新增待审项来源行 `approvalSourceLine` + `Proposal/Task/Workflow` 背景深链 `approvalBgLink` + 已决账 `approval_log` 备注列 `approvalLogNote`（区分提案判定与非提案审批落库，标注冲突取舍未在册）；`supplements` 随行清单经 `propYaml` 写入 `spec.docsUpdate` 随派单载荷下发；即修 `precheckFields` 悬空引用收口为 `intakeFieldsOf`【实现拓扑与细化验收=§1.54；纯 plugin/client 零 Go 零 cored】 | npm 168 pass（+L81-01..05）∧UI 拍 8/8 零 pageerror（`#/wf/core-workflow` 页头循环卡 active+关系词形 / 运行抽屉 run 型徽+3 条活跃会话深链 / `#/approvals` 25 处背景深链+已决表 20 行备注列+非提案审批落库区分 / `ctx.taken` 随行清单 / `#/report` 循环卡零污染）∧P-03 52↔52=0∧mirror files=18 findings=0（双 sha b1d4034f）∧P-01 六仓 ✓∧P-02 第十三拍 CLEAN-OK |
| 会话死亡接手+V 批落地+loop-82 收口+三态锚 §1.55 | 会话死亡接手裁决（loop-83）：裁决 1=hydrateTitles 全史零提交非丢失（chat v3 取代）+死前 V 批 src 完整 dist 落后→按一致性纪律整体提交（workservice@65aaaf6 web 57 pass+esbuild 可复现 7f2cbf84；V-01..22 中 17 项：tag 聚合页/依赖与待批与 Running 深链/refs 三族补/会话回链/系统详情三区块/提案直达/假卡退役/通知投影等，V-02/09/13/17/18 五项未落如实注记）+plugin pin 随行（e306dd7；V 批另推 web-v-batch 分支避 style agent 并行 WIP）；裁决 2=四任务死声称（running spawn×4∧sessions=0）不动写面+调度器自愈重拉实证（concept-visibility rv=6 attempts=1+三 core-headless 新进程 CPU 活跃）；loop-82 客户端批收口（§16.1 E① 流程图关联任务卡机械键=spec.touches.objects 写集声明+D② 会话页 wake 上下文卡非断言词形+F③ 审批行任务摘要+sessionChips 相位徽随行+L82-01/02 锚）；活体即修=审批摘要三态锚（data-ap-task-rel=命中数/0/unreadable——此前锚只打命中态而活体唯一待审=Proposal 恒零命中）；文档面缺口即修=S/C/审计三批 metadatainfo 侧车补三篇（R-DOC-6 ✓ 48 篇）【实现拓扑与细化验收=§1.55；纯 plugin/client+web 零 Go 零 cored】 | npm 178 pass（+L82-01/02+三态锚）∧web 57 pass∧UI 拍 e83-ui.mjs 11/11 零 pageerror（旧壳四纯函数+机械键判别+审批三态槽 anchors=[0,0,0]+会话页诚实缺席+流程图关联卡 / v2 壳 V-01 tag 页+V-14 提案直达+V-20 假卡退役）∧P-03 52↔52=0∧mirror files=18 findings=0（双 sha 一致）∧P-01 六仓 ✓∧metadatainfo 48 篇 ✓∧P-02 第十四拍 CLEAN-OK（活体零 l 前缀对象+fs 直扫归零） |
| V 批归并 main+孤儿租约认领+P-03 基准校准 §1.56 | V 批 22/22 归并 main（loop-84）：merge(main b849a6b) S+C 批全集 × V 批全量（42287ab——冲突 3 文件裁决：chat.js C 批 v4 保留（V-10 已吸收为 paintLinks+chat.css 迁形）/i18n 拆分架构保留+V 批 audit 屏键补 i18n-en.js 一行/dist 重建双跑同 sha bc9bb38b；web 79 pass=66 C 批锚∪V 批锚并集）+test(scheduler+scheme) 本机布局解耦（9912093——/Users/friddle 硬编码→CORE_SYSTEM_SCHEME env 同源词形优先，缺省不破 Mac 布局）+fix(scheduler) 孤儿租约认领（7adf16b——cored 重启进程内 leases 清零→孤儿 running 永不回收永不重拉且占额阻塞派单（console-audit-20261126 自 14:13 悬挂 2h+ 实证：ops event_log running 判定后零事件）；补口=本进程首拍扫 event_log 归档 dedup=task:<id>:running 认领租约起点→既有 TTL 回收路；L84-01 -race 回归锚+scheduler/sessionliveness/eventscope/contextidx 四包 race 闸全绿）+P-03 桥契约基准校准 43→60（cored-bridge.md §2 补 9 行：v0.66 四读面 events/{eventId}/loop/current/snapshot/stream+sessions/{id}/context 三面+V-18 code-audit/findings+更早已在码的 DELETE objects——60↔60 双向差集=0 复绿，e74-prep.mjs 判据数字随行校准）+chat-revamp 任务 verifying→done 机械复核收口（rv=6 经 corectl apply 落账）【实现拓扑与细化验收=§1.56；web+Go（scheduler/scheme 测试）零 cored 换代——本修复待宿主重启窗口生效】 | web 79 pass∧go 30 包全绿∧plugin npm 181 pass∧UI 拍 e84-ui.mjs 9/9 零 pageerror（v2 壳 V-01 tags 真数据 17 篇∪8 tag+audit 屏零崩+chat v4 三段式+零 inline style 按钮+旧壳回归）∧P-03 60↔60=0∧cored-lint files=18 findings=0 mirror=ok（scheme 双 sha 29e1f0e5）∧P-01 六仓 ✓（loop-next.md 存量 6 处部署路径经本轮占位化重写复绿——历史提交词形不回写如实注记）∧P-02 第十五拍 CLEAN-OK（六域 l 前缀=0）∧DocType count=0 第四连拍 |
| R-PUB-1 收口+代际裁决+台账复核 §1.57 | R-PUB-1 收口（loop-85）：instance 仓 loop-next.md 点火契约词形占位化重写（`<部署 bin>/corectl loop`——P-01 最后 1 处部署绝对路径，六仓复绿 ✓×6）+运行代际裁决（活体三 sqlite cored /proc exe sha=1c4cfb54（13:51 构建）＜孤儿租约修复提交 7adf16b（16:37）→**运行代不含本修复**，重启窗口仍属部署侧；loop-84 报告 sha 词形 3fa671f0 已过期如实校正——/proc 直测为准）+任务台账四任务复核（style rv=5/concept rv=7/chat rv=6 三 done 落账完整；console-audit rv=4 running「拉起中」维持不动写面——待重启窗口孤儿认领→TTL 回收→重拉闭环）【零代码改动轮——纯收口+对账；探针产物 probe/loop-85/e85-p03.mjs（P-03 解析器随行直测）】 | P-01 六仓 ✓×6+metadatainfo 50 篇 ✓∧P-03 60↔60 双向差集=0∧P-02 第十六拍 CLEAN-OK（六域 l 前缀=0）∧DocType count=0 第五连拍∧go 30 包全绿+scheduler/sessionliveness/eventscope/contextidx 四包 -race 绿∧web 79 pass∧plugin npm 181 pass∧cored-lint files=18 findings=0 mirror=ok（scheme 双 sha 29e1f0e5）∧任务台账复核（三 done+console-audit 待重启如实注记） |
| 新代 bin 落位+代际裁决修正+判需否决 §1.58 | loop-86：代际裁决修正——/proc 直测三活体 cored exe sha=1c4cfb54 **且磁盘 `<部署 bin>/cored` 同 sha**（mtime 13:51＜7adf16b 16:37）→loop-85「宿主重启窗口换新代」前提不成立（只重启会用旧 bin 拉起、修复永不生效——代际裁决纪律强化=**/proc sha ↔ 磁盘 bin sha 对比**再判定）；处置=沿既有部署事实路径（bin=friddle 属主历次换装处）从 workservice@7adf16b 重建换装：新代 cored sha 前 16=e5533dfc27077040（含孤儿租约认领+C 批 chat-stop 桥面）/corectl=f7259a71944ff1d2，旧代备份 cored.bak-l86-oldgen-1795712592，Text file busy→同目录 rename 换装（活体进程继续跑旧 inode 至重启窗口），隔离 DB 启动冒烟 ✓（scheme kinds=19/doctypes=21/eventtypes=23/dispatch=25 装配词形全正常，38699 端口已停）；本轮不自行重启活体（cored.addr 权威面=本 loop 链点火依赖，自保+不动 systemd 宿主）——运行代现势=活体三 cored 仍旧代，console-audit rv=4 维持不动写面，重启后闭环判据已写交接档（sha 一致+TaskStateChanged ready attempts=1+chat-stop 复核）；分支清理事实核正=agent/concept-visibility 已并入 main（is-ancestor true）而 origin/web-v-batch（65aaaf6）**非 main 祖先**（loop-85「已并入 42287ab」词形不准确——42287ab 不存在；实际=V 批产物 tags.js/concept-visibility.test.mjs 在 main 全部落面+web 79 pass 实证=内容被后续提交语义取代）；渲染器扩展判需实测=core-docs 18 篇零任务列表/脚注命中→判需不成立如实延迟【零代码改动轮——部署面 bin 换装+报告/交接档；探针产物零新增（P-03 沿用 e85-p03.mjs）】 | P-01 六仓 ✓×6+metadatainfo 50 篇 ✓∧P-03 60↔60 双向差集=0（code=60 doc=60 缺=0 多=0）∧P-02 第十七拍 CLEAN-OK（六域 l 前缀=0：Agent=0/Proposal=0/Workflow=2/ConnectorOps=2/Task=4/DocType=0）∧DocType count=0 第六连拍∧go 30 包全绿+scheduler/sessionliveness/eventscope/contextidx 四包 -race 绿（L84-01 锚含内）∧web 79 pass∧plugin npm 181 pass∧cored-lint files=18 findings=0 mirror=ok（scheme 双 sha 29e1f0e5）∧新代启动冒烟 ✓（隔离 DB） |
| 分派链 split-brain 复位+认领域收窄+F-01 入口转正 §1.59 | loop-87：新代三判据活体闭环实测（/proc sha=e5533dfc 一致✓/孤儿认领生效（authority 首拍 adopted=true）✓/任务真拉起（18:00:39 running attempts=2→executor host+子 cored+会话写盘）✓）**但被双调度器竞速抵消**——authority/executor 各持独立 ops 库共享 docs 库，executor 依其库 17:35 running 锚点 18:05:11 TTL 判 failed（拉起 4.5m<leaseTtl 30m 误杀，rv9 attempts=2/2 超上限）；裁决复位 rv10=verifying+lastAction 写明竞速事实与执行会话证据链（verifying→done 合法通路）；根因收窄=workservice@070b3e6 `adoptOrphanLeases` 认领归档域收窄（本库归档无 running 行的在册 running=跨域 running→不认领不回收+L87-01 锚）——结构性余量如实注记（split-brain 现势未根除，根治=scheduler 装配门控 allowApply→下一代码轮）；F-01=plugin 4620d7c/pin 28e0ec6 `/core-console(/)` 公开壳页 200（34 屏 P0-1；公开词形=opts 不声明 reject 键+fail-closed 401 既有词形零改动+数据/写面栅栏零改动+L87-02 锚）；部署 bin 换装=194873c741f84baf（trimpath 可复现——非 trimpath 构建因模块版本词形不可复现，本轮起 Go 换装一律 trimpath）旧代备份 cored.bak-l87-1795717200【Go（scheduler）+plugin 路由批；plugin 运行面生效待宿主重启窗口】 | plugin npm 189 pass（+L87-02；console-v2.test 入 npm test 计数随行）∧go 30 包+scheduler -race 绿（L87-01/L84-01 双锚）∧UI 拍 e87-entry 4/6（入口 200×2 FAIL=运行面 plugin 未换代如实预期/E87-04 sha 一致 PASS/E87-05 壳活体 PASS/零 pageerror PASS）∧P-01 六仓 ✓+metadatainfo 50 篇 ✓∧P-03 60↔60=0∧P-02 第十八拍 CLEAN-OK∧DocType count=0 第七连拍∧cored-lint mirror=ok |
| 整机重启窗口闭环+split-brain 第四实证+A 象机械根因+台账清零 §1.60 | loop-88：**整机重启窗口**（03:45:12 三 unit 同拍 active；三 cored /proc sha 直测全=dmm13b8d=磁盘 bin——第二实例 代际随行零动作达成；MainPID 276/277=node 启动器 sha 同值非代际判据——/proc 直测纪律再证）；**split-brain 第四实证（C 象 070b3e6 后仍误杀）**=操作员 04:00:39 SSH→corectl 复位 failed 任务→executor cored 3070（其库归档含 04:00:53 running→**同域**认领=收窄不覆盖）04:30:55 TTL 刀判 failed rv13（core-headless.db apply_log scheduler:lease-recover 归因；authority 零 04:30 行=写者归属；执行会话 pid 3052 活体在跑）→裁决复位 rv14 verifying（loop-88-splitbrain-adjudication 词形）→执行体 04:53:29 终写 **done rv15**（409 重读自然收敛）；**A 象机械根因破案=SQLite applyWrite 跨进程 TOCTOU**：SELECT 事务外+进程内单写者队列+多进程共享 docs 库（authority/执行体均 --allow-apply）→rev10 双写同基 rv 双行（04:00:48.721/.918 同字节活体实证）+rv 可回退（18:46 陈旧快照把 rv10 打回 rv9）+已删行可复活（l87 in-row rv=2 实证）；Git 后端 HEAD 基准跨进程防竞而 SQLite 无=防御不对称；**修法定判**=DSN `_txlock=immediate`+SELECT 入事务（L88-01 跨进程双写只一方 rv 前进/L88-02 缺席+expectRV>0=conflict 语义保全锚）——A/B/C/D 四象同根因一修，调度器装配门控（allowApply 闸）降级为纵深防御可选；**D 象破案为伪**=l87-tick-probe 复活 ×2 非调度器复活已删对象（status 写面只 upsert 现行行），是 loop-87 18:02:24 删除落**隔离 docs face X**（18:00:31-18:22:34 权威面+执行体曾跑 X 面）——A 面从无删除（doc_history 零 delete 留痕行）rv 链 1→8 线性自洽；僵尸本 face rv8 直删（04:37:48，本库首个 console:delete 留痕行）；**X 面实体未获**（tmp 下 l86-boot/l86-build/l87-build 三目录零 db）=待追查项；**console-audit 收口闭环**=执行会话第三拍全程活体取证（running→误杀→复位→done）+任务台账清零（四 Task 全 done 活动任务=0）+产物五连提交 workservice@9fe0d02+plugin@e31f5cc pin+磁盘 cored=71f00fd6（04:42 trimpath）——三活体仍 dmm13b8d 差一代下窗随行；**F-01 生效拍 5/5 全绿**（重启窗口后 /core-console 与 /core-console/ 与 /core-console/v2 三 200+POST 405+api 无凭证 401 fail-closed 保全；api 词形勘定=/core-console/api/v1/*）【执行体代码半（五连提交）；裁决复位+l87 删尸+取证=运维半；探针产物 probe/loop-88/】 | P-01 六仓 ✓×6+metadatainfo 50 篇 ✓∧P-03 60↔60=0∧P-02 第十九拍 CLEAN-OK（l 前缀=0 含 l87 再删；DocType 第八连拍 count=0）∧go 30 包全绿+四包 -race（9fe0d02 树）∧web **80** pass∧plugin **189** pass（首拍 188/1=env 污染假信号——CORE_SYSTEM_SCHEME 词形使 apply(ctx,{}) 走 autoSpawn 提供 url='' 桥；env -u 干净重跑 189/0——测试环境纪律入册）∧cored-lint files=18 findings=0 mirror=ok（scheme 双 sha 29e1f0e5）∧F-01 生效拍 5/5∧任务台账四 done 清零∧docsRoot 零新提交零脏树 |

| TOCTOU 修复落地+WAL 层失效模态破案+调度器硬闸 §1.61 | loop-89：**队列 1 落地=workservice@d16f283**（applyWrite/applyDelete 现行行 SELECT 移入立即事务+DSN `_txlock=immediate`（sqliteDSN 辅助词形）——BEGIN IMMEDIATE 起事务即持写锁、基线读取与翻页写入原子；noop/conflict/缺席分支全随事务回滚点落账；断言锚 sqlite_crossproc_test.go 自含辅助=修复前 HEAD 可编译红/绿对照：L88-01 锁形判据（写事务开启后第二进程 BEGIN IMMEDIATE 必 busy 拒）+双实例同基竞速（恰一胜者/rev=1 历史恰一行/rv 不回退）+L88-02 缺席+expectRV>0=conflict 不复活——**红拍实测**：修复前 HEAD 同基竞速双胜（两实例同拍 update rv=2=loop-88 rev10 同基双行缺陷逐字复现）→修复后恰一胜者+conflict 败者）；**X 面破案=非独立文件，是 A 面同文件的 WAL 易失层**（五物证：①docs 主文件 mtime 钉死 18:00:31.187=关停检查点拍后零合并 ②WAL/shm 出生双 18:00:34.618 单次创建 ③WAL 头 ckpt-seq=0 从未检查点 ④窗口 18:00-18:46 全对象 doc_history 零行 ⑤ops 库同时窗 rv3=core-system.db/rv4=core-headless.db 两行写入——写者=当时 alive 的 authority+executor 两代 cored、cmdline 均指 A 面路径（loop.log:111231 实证）→18:00:39-18:02:24 的 rv3/rv4/删除帧曾进 A 面 WAL 后被毁（陈旧 wal-index 失步覆写——18:22:34 那代 ops 主文件有关停检查点戳而 docs 主文件无=该代 cored 关闭时挂的 docs 非 A 面文件态）；**判词修正**：loop-88「隔离 docs face X 文件」不成立，X=WAL 层；**新模态入册=已提交帧销毁（比丢更新更狠）——TOCTOU 修复不覆盖 WAL 层失效，写面单进程化=唯一部署面手段**→loop-88「调度器门控降级可选」判词反转为**必做**）；**队列 2 升必做落地=workservice@cb6326a**（cored main.go 调度器装配加 `*allowApply` 硬闸——scheme runtime.taskScheduler.enabled 仍第一热读开关、本闸=部署面第二开关；stderr 状态行词形随行 off（…或进程无 --allow-apply）；活体双向 probe 无旗标=off ✓/有旗标=on ✓——执行会话自带 headless cored 等零 apply 权限进程不再持调度器=多代 cored 并存时写面归 authority 单进程）；**部署随行**=磁盘 bin 换装 **0c5c0f2e**（trimpath，cb6326a 树含 TOCTOU 修复+硬闸，mv 原位换 inode 不扰活体；旧代 71f00fd6 备份 cored.bak-l88-1795833945）+push origin 9fe0d02→cb6326a；**unit 自杀风险实测在册**=本 loop 会话宿主（30949/30965/本 shell）cgroup 实测全在 dsh-core-system.service 内（loop-87 cgroup escape 本轮未做）→**本轮内 systemctl restart=自杀，换代留待下一重启窗口**（三活体现势 ddd13b8d/ddd13b8d/71f00fd6，下窗后三活体=0c5c0f2e）；**运行面现势注记**=活体仍 ddd13b8d 旧代（无 TOCTOU 修复无硬闸）——修复生效窗=下轮重启后，期间多进程写面动作维持 409 重读重放纪律；P-01 配对核=52 篇 .metadatainfo 全配对（唯二例外处置：console-audit/loop-88.md 配偶本轮补（toctou/wal tag）；86 篇 acceptance/loop-*.md 历史档缺配偶=基线态沿 gitignore R-PUB-3 分层例整轮一票通过）；**F-01 复拍词形增补**=/v2 裸拍 401 非 F-01 回归=jar 过 2h token 轮换期（dsh-auth-<随机> cookie 名随宿主会话生灭）——F-01 五点判据须 gate 握手新鲜 jar（journalctl 抓 token+/proc/<gate pid>/environ 抓 GATE_KEY→curl -L -c jar http://127.0.0.1:3090/?key=<KEY>&token=<TOKEN>）后拍得（本轮 jar=probe/loop-89/jar.txt 5/5 全绿复现）【代码两提交全运维落地半+X 面破案=本轮主项；探针产物 probe/loop-89/（go-test.log+go-race.log+npm-plugin/npm-web.log+lint.json+jar.txt）】 | P-01 六仓 ✓×6+metadatainfo 配对 52 篇 ✓∧P-03 60↔60=0（e85-p03.mjs）∧P-02 第二十拍 CLEAN-OK（corectl get Task 活体 l 前缀=0 四 done）∧DocType count=0 第九连拍（诚实等待）∧go 30 包全绿（cb6326a 树两度全跑）+scheduler/repository/sessionliveness/eventscope/contextidx 五包 -race 绿∧plugin **189** pass（env -u 干净跑）∧web **80** pass∧cored-lint files=18 findings=0 mirror=ok（scheme 双 sha 29e1f0e5 未变）∧F-01 生效拍 5/5（新鲜 jar）∧docsRoot 零新提交零脏树∧任务台账四 done 清零维持 |
| 重启窗口换代 0c5c0f2e 三活体同步+硬闸活体生效+P-01 判据代换 §1.62 | loop-90：**队列 1 落地=重启窗口换代**（外科通路第三度实证+首次带保活项：接手自判本会话宿主 47553+headless cored 47569 在 dsh-core-system cgroup 内→`sudo mkdir /sys/fs/cgroup/unified/dsh-loop-90 && sudo sh -c 'echo <pid> > cgroup.procs'` 双迁出（headless=已 0c5c0f2e 新代=必保活体）→`systemctl restart dsh-core-system` 06:34:06+`restart dsh-接入实例` 06:34:47 随行（第二实例 代际随行承诺闭环）→三活体 /proc/exe sha=**0c5c0f2e×3 全同步**（authority 49284/接入实例 49414/headless 47569）——运行面 TOCTOU 修复+调度器硬闸**生效窗达成**；必死集=unit 自有根 275+authority 旧代 481（ddd13b8d，备份 cored.bak-l88-pre-9962590-1795754590 sha 实测=ddd13b8d 在册）——会话+headless 零死亡实证（loop-89 自杀风险词形闭合）；**硬闸活体实证**=部署面双向 probe 词形全绿（有旗标=`任务调度器=on(tick=5s maxConcurrent=4 perService=2 perRepo=1 leaseTtl=30m0s maxAttempts=2 spawn=on(...)/task/spawn)`/无旗标=`off（...或进程无 --allow-apply）`）+活体 cmdline 旗标在位词形（49284/49414=--allow-apply、47569=无）；**F-01 5/5 全绿**（新鲜 jar：GATE_KEY=gate environ+web token=新宿主 journalctl 06:34:09 行→gate 回环 3090 握手 200——词形增补=cookie 域钉 127.0.0.1，五点须打 gate 回环代理面非 web 直连，web 直连=六点全 401 假阴性实测入册） | **P-01 判据代换（本轮纪律增量）**=「✓×6」词形代换为**脚本退出码实测**——命中 R-PUB-1 病灶两处（loop-next.md 行 27 IP+行 47 部署绝对路径；病灶定代=loop-88 起路径命中在册、loop-89 换代词引入 IP 命中→历两轮「✓×6」词形与实测偏差如实注记）→占位符化（`<内网web面>`/`<部署根目录>`）→**六仓 PASS 全绿**（退出码实证）；metadatainfo 配对核=**53 篇侧车全配对**（非 acceptance 区唯一缺配偶=friddle_decision.md=R-PUB-2 台账 script 排除项基线态）；**apply 通路单点核验（队列 2=WAL 纵深裁决）**=headless cored 47569 POST /v1/apply=**405**（引擎未装配）vs authority 49284=**400**（引擎在位空 body 语义错误）→写端点单点=authority 唯一、headless 零写面→WAL 多写者风险随硬闸**闭合**（双 cored 同挂 docs 库=读面共享无碍；裁决=队列 2 无需再探）【探针产物 probe/loop-90/（pre-restart-snapshot+sched-gate-evidence+stderr-on/off+jar+handshake+f01+四测试日志+lint.json）】 | P-01 六仓退出码 ✓×6（两病灶修后）∧P-02 第二十一拍 CLEAN-OK（Task count=4 四 done 无 l 前缀；四域 l 前缀=0）∧P-03 60↔60=0 PASS∧DocType 第十连拍 count=0（诚实等待）∧go 30 包全绿（cb6326a 树）+scheduler/repository/sessionliveness/eventscope/contextidx 五包 -race 绿∧plugin **189** pass（env -u 干净跑）∧web **80** pass∧cored-lint files=18 findings=null mirror=ok（scheme sha 29e1f0e5 未变）∧F-01 生效拍 5/5（gate 回环新鲜 jar）∧docsRoot 零脏树∧apply 通路单点核验 405/400 词形实证 |
| 零代码收口转正+判据词形再校准 §1.63 | loop-92：接手自判 cgroup=session-4636.scope（不在 dsh-core-system→零 restart 需求、外科通路零动用）；三活体 cored /proc exe md5=a4c0b45e…（与磁盘 bin 同值）；headless 执行体随本会话在册（loop-91「GONE」按会话期口径校正）。基线漂移四项实修（均文档侧、部署面零换装）：①<部署实例> README 部署实例名占位符化（P-01 R-PUB-1 两命中→六仓 rc=0×6）②core_design 补 interface/session 两元数据侧车（69 md=69 配对）③cored-bridge.md §2 补 docs-export/config、session-config、session-config/writebacks、workflows/service-spawns 四路由行，P-03 基准 60→64（双向差集=0）④docsRoot scheme 镜像同步 core_design@f8504b3（cored-lint drift→ok，双 sha ad37a3c4）。F-01 词形校正=/core-console/v2 的 302→/core-console/ 为设计行为（-L 后 200），405 点=只读代理 POST /core-console/api/v1/scheme（apply 路由 POST 空 body=400 属正常语义）。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 144 md=52 配对+91 gitignored 历史层+1 排除项∧P-02 第二十三拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十二拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律、rc=0 fail=0）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）【探针产物 probe/loop-92/（run-baseline.sh + e92-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt）】 |
| 零代码收口常态维持+R-PUB-1 判据漂移实修 §1.64 | loop-93：接手自判 cgroup=/system.slice/dsh-core-system.service（**在 unit 内**，与 loop-92 的 session-4636.scope 词形漂移；部署面零换装→无 restart 需求、外科通路零动用）；三活体 authority 377551 / 接入实例 377601 / headless 382914（新 PID，loop-92 的 378394 已重启），/proc exe md5 全=a4c0b45e…=磁盘 <部署 bin>/cored；corectl md5=f8b9c0a0… 未动。基线漂移实修=R-PUB-1 §1.63 行 <部署实例> 实例名占位符化（P-01 instance rc=1→0，六仓复绿；committed instance@432595c）；instance md 144→146（+2 acceptance 历史层，配对 52 不变，分层例一票维持）；其余判据全绿（P-02 第 23 拍 / P-03 64↔64=0 / npm 101+139 / go 31+5 race / lint files=18 findings=null mirror=ok 双 sha ad37a3c4 / F-01 200/200/200/405/401×2 / DocType 第 13 拍 count=0 诚实等待）。脏项裁决=plugin M core_system+package-lock.json、instance workflow 在制改动均非本轮，维持不动。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 146 md=52 配对+93 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第二十三拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十三拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）【探针产物 probe/loop-93/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt）】 |
| 零代码收口常态维持+基线全绿 §1.65 | loop-94：接手自判 cgroup=/system.slice/dsh-core-system.service（**在** unit 内，与 loop-93 同——部署面零换装→无 restart 需求、外科通路零动用）；三活体 authority 377551 / 接入实例 377601 / headless **385425**（新 PID，loop-93 的 382914 已随会话重启），/proc exe md5 全=a4c0b45e…=磁盘 <部署 bin>/cored；corectl md5=f8b9c0a0… 未动；三活体 --scheme 均指 core_design 权威源（scheme 双 sha ad37a3c4）。六仓 HEAD 与 loop-93 交接完全一致（无新提交）。全套基线接手即全绿、无判据漂移需实修；instance md 146→147（+1=loop-93 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin M core_system+package-lock.json、instance workflow 在制改动均非本轮，维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 147 md=52 配对+94 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第二十四拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十四拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-94/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-94.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.66 | loop-95：接手自判 cgroup=/system.slice/dsh-core-system.service（**在** unit 内，与 loop-94 同——部署面零换装→无 restart 需求、外科通路零动用）；三活体 authority 377551 / 接入实例 377601 / headless **386993**（新 PID，loop-94 的 385425 已随会话重启），/proc exe md5 全=a4c0b45e…=磁盘 <部署 bin>/cored；corectl md5=f8b9c0a0… 未动；三活体 --scheme 均指 core_design 权威源（scheme 双 sha ad37a3c4）。六仓 HEAD 与 loop-94 交接完全一致（无新提交）。全套基线接手即复测全绿、无判据漂移需实修；instance md 147→148（+1=loop-94 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin M core_system+package-lock.json、instance workflow 在制改动均非本轮，维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 148 md=52 配对+95 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第二十五拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十五拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-95/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-95.stdout）】 |
| 换代随行+陈旧交接档续跑+基线复绿 §1.67 | loop-96：接手自判 cgroup=`/user.slice/user-0.slice/user@0.service/app.slice/dsh-subprocess-392375-508ce9a9225a.scope`（**不在** dsh-core-system unit，与 loop-93~95 的 unit 内词形漂移；部署面已换代但三活体 exe 同盘→零 restart 需求、外科通路零动用）；ignite 源仍为 loop-94 陈旧交接档（loop-95 完成正文与 §1.66 却未推进 loop-next.md），按「盘面权威>提示词」确认 loop-95 已落 `instance@1a53e76` 后不重做已完成部分。三活体 authority **389265** / 接入实例 **389313** / headless **392392**（新 PID，loop-95 的 377551/377601/386993 已随服务重启换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0… 未动；三活体 `--scheme` 均指 core_design 权威源（双 sha ad37a3c4）。换代来源=并发开发流 workservice@cca8ace（approval-judge org 前缀补全+被审物 REST 读取）10:56 换代 cored（a4c0b45e→75be0305）、10:57 重启三 unit，非本轮动作；全套基线换代后复测全绿、无判据漂移需实修。instance md 148→149（+1=loop-95 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮，维持不动。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 149 md=52 配对+96 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第二十六拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十六拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-96/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-96.stdout）】 |

| 零代码收口常态维持+基线全绿 §1.68 | loop-97：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-93~95 同、与 loop-96 的 dsh-subprocess scope 词形漂移；部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-96 交接档（mtime 已前进，交接链无缺口）。三活体 authority 389265 / 接入实例 389313 / headless **394508**（本会话自带执行体 cored，loop-96 的 392392 已随上轮会话退出），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指 core_design 权威源（双 sha ad37a3c4）。六仓 HEAD 与 loop-96 交接完全一致（无新提交；docsRoot@774ee83 零脏树）。全套基线接手即复测全绿、无判据漂移需实修；instance md 149→150（+1=loop-96 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮，维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 150 md=52 配对+97 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第二十七拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十七拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-97/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-97.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.69 | loop-98：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-97 同——部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-97 交接档（mtime 已前进，交接链无缺口）。三活体 authority 389265 / 接入实例 389313 / headless **396204**（本会话自带执行体 cored，loop-97 的 394508 已随上轮会话退出，非换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指 core_design 权威源（双 sha ad37a3c4）。六仓 HEAD 与 loop-97 交接完全一致（无新提交；docsRoot@774ee83 零脏树）。全套基线接手即复测全绿、无判据漂移需实修；instance md 150→151（+1=loop-97 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮，维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 151 md=52 配对+98 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第二十八拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十八拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-98/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-98.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.70 | loop-99：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-98 同——部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-98 交接档（mtime 已前进，交接链无缺口）。三活体 authority 389265 / 接入实例 389313 / headless **397855**（本会话自带执行体 cored，loop-98 的 396204 已随上轮会话退出，非换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指 core_design 权威源（双 sha ad37a3c4）。六仓 HEAD 与 loop-98 交接完全一致（无新提交；docsRoot@774ee83 零脏树）。全套基线接手即复测全绿、无判据漂移需实修；instance md 151→152（+1=loop-98 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮，维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 152 md=52 配对+99 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第二十九拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第十九拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-99/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-99.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.71 | loop-100：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-99 同——部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-99 交接档（mtime 已前进，交接链无缺口）。三活体 authority 389265 / 接入实例 389313 / headless **399785**（本会话自带执行体 cored，loop-99 的 397855 已随上轮会话退出，非换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指 core_design 权威源（双 sha ad37a3c4）。六仓 HEAD 随并发流前进一项：core_design 7c36ea1→ff8a69c（R-ENG-9 数据零编造规则入 rule_eng.md，11:27:44 并发提交、非本轮动作；scheme/桥契约/元数据侧车零改动，基线在该提交后复测），其余五仓与 docsRoot@774ee83 零脏树一致。全套基线接手即复测全绿、无判据漂移需实修；instance md 152→153（+1=loop-99 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮，维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 153 md=52 配对+100 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第三十拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第二十拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-100/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-100.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.72 | loop-101：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-100 同——部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-100 交接档（mtime 已前进，交接链无缺口）。三活体 authority 389265 / 接入实例 389313 / headless **402489**（本会话自带执行体 cored，loop-100 的 399785 已随上轮会话退出，非换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指权威设计源（双 sha ad37a3c4）。六仓 HEAD 与 loop-100 交接完全一致（无新提交；core_design 维持 ff8a69c、docsRoot@774ee83 零脏树）。全套基线接手即复测全绿、无判据漂移需实修；instance md 153→154（+1=loop-100 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮（后者 blame 现势仍在并发在制、无决策档认领），维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 154 md=52 配对+101 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第三十一拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第二十一拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-101/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-101.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.73 | loop-102：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-101 同——部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-101 交接档（mtime 已前进，交接链无缺口）。三活体 authority 389265 / 接入实例 389313 / headless **404419**（本会话自带执行体 cored，loop-101 的 402489 已随上轮会话退出，非换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指权威设计源（双 sha ad37a3c4）。六仓 HEAD 与 loop-101 交接完全一致（无新提交；core_design 维持 ff8a69c、docsRoot@774ee83 零脏树）。全套基线接手即复测全绿、无判据漂移需实修；instance md 154→155（+1=loop-101 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮（后者 mtime 现势 2026-11-27 17:06 未再写、无决策档认领），维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 155 md=52 配对+102 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第三十二拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第二十二拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-102/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-102.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.74 | loop-103：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-102 同——部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-102 交接档（mtime 已前进，交接链无缺口）。三活体 authority 389265 / 接入实例 389313 / headless **406040**（本会话自带执行体 cored，loop-102 的 404419 已随上轮会话退出，非换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指权威设计源（双 sha ad37a3c4）。六仓 HEAD 与 loop-102 交接完全一致（无新提交；core_design 维持 ff8a69c、docsRoot@774ee83 零脏树）。全套基线接手即复测全绿、无判据漂移需实修；instance md 155→156（+1=loop-102 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮（后者 mtime 现势 2026-11-27 17:06 未再写、无决策档认领），维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 156 md=52 配对+103 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第三十三拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第二十三拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-103/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-103.stdout）】 |
| 零代码收口常态维持+基线全绿 §1.75 | loop-104：接手自判 cgroup=`/system.slice/dsh-core-system.service`（**在** unit 内，与 loop-103 同——部署面零换装→无 restart 需求、外科通路零动用）；ignite 源=loop-103 交接档（mtime 已前进，交接链无缺口，diff/md5 逐字一致）。三活体 authority 389265 / 接入实例 389313 / headless **407619**（本会话自带执行体 cored，loop-103 的 406040 已随上轮会话退出，非换代），`/proc/<pid>/exe` md5 全=**75be0305…**=磁盘 `<部署 bin>/cored`；corectl md5=f8b9c0a0 未动；三活体 `--scheme` 均指权威设计源（双 sha ad37a3c4）。六仓 HEAD 与 loop-103 交接完全一致（无新提交；core_design 维持 ff8a69c、docsRoot@774ee83 零脏树）。全套基线接手即复测全绿、无判据漂移需实修；instance md 156→157（+1=loop-103 acceptance 档 finalize 后计数，配对 52 不变，分层例一票维持）；脏项裁决=plugin `M core_system`+untracked `plugin/package-lock.json`、instance `M examples/workflows/gh-issue-trigger.yaml` 均非本轮（后者 mtime 现势 2026-11-27 17:06 未再写、无决策档认领），维持不动。零代码零换装轮。 | P-01 六仓 rc=0×6 + core_design 69/69 + instance 157 md=52 配对+104 unpaired（含 acceptance 历史层）+1 排除项∧P-02 第三十四拍 CLEAN-OK（Task count=8 七 done 一 canceled；Agent=1/Proposal=2/Workflow=4/ConnectorOps=5 域 l 前缀=0）∧P-03 64↔64=0∧DocType 第二十四拍 count=0（诚实等待）∧plugin npm 101 pass / web 139 pass（env -u 纪律）∧go 31 包 ok + 五包 -race 绿∧cored-lint files=18 findings=null mirror=ok（scheme 双 sha ad37a3c4）∧F-01 200/200/200/405/401×2（gate 回环新鲜 jar）∧docsRoot HEAD=774ee83 零脏树∧六域 l 前缀=0【探针产物 probe/loop-104/（run-baseline.sh + e93-p03.mjs + 各 rc/log + lint.json + jar.txt + f01-fivepoint.txt + run-104.stdout）】 |

## 5. 执行红线（对 loop 的约束）

1. **不改文档面语义**：console 是观测/操作面，一切写操作（启停/编辑/批准/重跑）=Apply 走既有写路径；发现设计不合理→改文档先于改代码（acceptance 纪律）。
2. **渲染数据无双源**：全部来自 cored 读面+ops DB；console 不自建持久状态。
3. **R-PUB**：真实域名/IP/token/部署路径不入仓，用占位符；运行时验收产物落 acceptance/（gitignore）。
4. **交互契约以 proto 为准，实现落在 dsh plugin 里**（用户裁决 2026-11-24）：`dsh-core-agent/console-proto/`（Mac 侧，四文件，file:// 直开；机器侧副本 `<本机proto副本目录>` 由巡检 rsync 同步，实际路径记台账）是交互与信息结构对照物，**独立页永久保留**；但实现必须经 dsh Slots 贡献进 dsh web client（dsh-plugin-core-system），不得做成独立站点；proto 的 hash 路由四文件可整体内嵌 slot 作起点代码，再逐步替换为 dsh 模块——屏的路由、区块、验收线不变。
5. **Connector/ConnectorOps 代码归属（R-ENG-3）**：gotty/opencode/claude-code/内嵌 dsh 四种运行器驱动与 agent-comm 实现都是 connector 代码——通用能力默认入 `common_connector`；确需独立仓时用 `gh` 建（org 内私有仓）并先在 core_design rule/rule_eng.md R-ENG-3 注册再使用。
6. **硬性验收**（沿 console-ui.md 3.5）：界面上出现的任何资源标识符必须可点；详情页任意互跳；零控制台 error。

## 6. 可行性分析

| 风险 | 等级 | 缓解 |
|---|---|---|
| dsh client rc 期 API 变动 | ⚠️ 中 | 只锁交互模式与信息结构；组件 API 经插件层薄封装（沿 cross-agent.md 同款缓解） |
| Slots 注册面能力不足（能否加顶层导航/整页路由） | ❗高→需先验证 | E1 即是验证增量：注册失败则回退「单页挂 hero slot + 内部 hash 路由」方案（proto 已是 hash 路由，天然兼容） |
| cored 读面字段不足以渲染（如运行次数聚合） | ⚠️ 中 | ops DB 预聚合查询；缺字段先 E2 只读对齐再扩 cored，不前端拼凑 |
| loop 一轮体量过大（E3/E4） | ⚠️ 中 | 一轮一增量+探针回归；超一轮则拆（E4a 草稿面/E4b Apply 面） |
| 长连接被代理反复掐断影响所有面板 | ✅ 已消化（E0 机器侧） | 固定钥匙门 SSE idle 心跳+逐响应关缓冲（§1.2），空闲存活远超代理默认 60s；代理机 conf 侧改法留作部署备选 |
| 重启窗口闭环+split-brain 三连击+外科重启通路 §1.59 | loop-87：监管面发现=systemd 系统级 unit `dsh-core-system.service`（enabled Restart=always RestartSec=5 KillMode=control-group——loop-85/86「宿主监管面」词形实体；14:21 前例=loop-82 死亡机理=同 cgroup 连带杀）；**外科重启通路（实证可复用）**=cgroup2 迁移会话进程出 unit（`/sys/fs/cgroup/unified/<逃逸组>` 子组 echo pid>procs）→KillMode 杀序=cgroup v2 top-down（宿主死 cored 幸免）→会话存活（18:00:31/18:22:34 两度实证）；金丝雀=接入实例（只杀 cored 不重拉——插件 spawn 一次性装配无 child respawn，loop-86「宿主自动重拉」假说证伪；systemctl restart 全路径 ✓ 且不触权威指针——仅 core-system 配 coredAddrFile）；**权威面三度重启**=17:35:07（e5533dfc：孤儿认领+chat-stop 桥面上运行面）/18:00:31（重臂认领）/18:22:34（ddd13b8d=workservice@070b3e6 认领归档域收窄——执行体修复随提交落位，备份 cored.bak-l87-pre-070b3e6-1795717264）；**孤儿租约修复活体闭环达成**=新代首拍扫档认领（锚点=event_log 14:13:41 running 行）→TTL(30m) 早过期→ready+attempts=1（17:35:11.354 事件）→dispatch→POST spawn 桥→task-spawn.sh→执行会话拉起在跑（18:00:39 attempts=2，task-cored-task-843599648.yaml_.log）；**split-brain 三连击（活体新发现，根因=双 cored 双 ops 库共享 docs 任务库）**=A 抢先竞速（executor headless cored 17:35:11 同拍抢先 dispatch 写 running rv6→POST 指向其 env 注入的旧桥 43003（重启前旧权威宿主，已死）→桥端零请求行+状态面 running=矛盾实证）∧B spawnFail 用进拍前 o 快照回写→409 陈旧 rv 拒绝→任务卡 running 无租约无自愈∧C 执行体会话自身 cored 依据**其库** 17:35:11 running 锚点 TTL 到点把活体执行中任务拽成 failed（18:05:11 预测→实证，attempts 2/2 超上限 rv9——executor 库归档有该 running 行而 authority 库无，认领跨库失明）；**loop-87 裁决复位**=reset→verifying（rv10，fieldManager=loop-87-splitbrain-adjudication 非 `task:` 前缀→Apply 关口冲突闸不可归因不挂起执行体；migrations 表 verifying→done=执行体终写合法通路；两调度器 recoverLeases 见 phase≠running 租约静默终止零写面——reset→running 会在 18:30:39/18:35:11 两度被拽杀故不用）；C-02 chat-stop 桥面复核 ✓（gate 固定 key+token 握手→400 sessionId 必填→502 session not found=cancel 落投真通路；cookie jar 随宿主重启 token 轮换失效=gate jit 设计场景）；分支清理（loop-86 事实备好）=agent/concept-visibility（worktree remove+branch -d，远端不存在）+origin/web-v-batch（远端删除）；ignite 源漂移根因修复=<部署 ignite 源>/loop-next.md 与 instance 仓权威档 cp 同步（loop-85/86 提示面词形漂移两拍注记的根因=巡检喂的拷贝过期）【零自有代码改动轮——workservice 代码半由执行体提交（070b3e6 认领归档域收窄+L87-01 锚）/运维裁决半=verifying 复位落账；探针产物 probe/loop-87/（pre-restart-snapshot.txt+restart-closure.md）】 | P-01 六仓 ✓×6+metadatainfo 50 篇 ✓∧P-03 60↔60=0∧P-02 第十八拍 CLEAN-OK（六域 l 前缀=NONE：Agent=1/Proposal=1/Workflow=2/ConnectorOps=3/Task=4/DocType=0）∧DocType count=0 第七连拍∧go 30 包全绿+scheduler/sessionliveness/eventscope/contextidx 四包 -race 绿（070b3e6 树，L87-01 锚含内）∧web 79 pass∧plugin 188 pass∧cored-lint files=18 findings=0 mirror=ok（scheme 双 sha 29e1f0e5）∧C-02 复核 400/502 真通路∧任务台帐=console-audit verifying rv10 活体执行在跑+style/concept/chat 三 done |
| token 轮换打断实现期自测 | ⚠️ 中 | 探针脚本用 journalctl 取最新 token（既有套路） |

**结论：可行。E1 的 Slots 注册验证是唯一方向性风险，E0/E1 先行，其余增量均不阻塞在未知上。**
