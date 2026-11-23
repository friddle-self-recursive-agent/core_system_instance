# Runtime 3：cored 只读面与 plugin↔cored 桥（cored-bridge）

> 落点依据：impl/self-recursive-core.md「cored 保留为冷启动入口与调试用途」+ dsh-plugin.md「core plugin 承接控制面」。本文定义 cored 进程的最小只读查询面与 dsh plugin 拉起 cored 的桥接契约——两者都是**机制描述**，不含部署锚点（真实路径经环境/配置注入，rule.md R-PUB-1/2）。代码落点：workservice 仓 `cmd/cored` + `internal/{scheme,apiserver}`；plugin 仓 `plugin/src/index.ts`。

## 1. cored 进程契约

| 项 | 契约 |
|---|---|
| scheme 源 | `--scheme <path>`，缺省读环境变量 `CORE_SYSTEM_SCHEME`；二者皆空则拒绝启动 |
| 文档库根 | `--docs <root>`，缺省读环境变量 `CORE_SYSTEM_DOCS`；为空则对象读面不挂载（`/v1/objects/*` → 503），scheme 面不受影响；给定即打开 repository git 后端（串行写队列+resourceVersion 乐观锁，缺省仅读暴露） |
| 写面开关 | `--allow-apply`（缺省 false=只读）：显式开启 `POST /v1/apply` 写端点与草稿写操作（§2.2 落稿/弃稿/fromDraft 同开关）；开启时必须同时给 `--docs`（写面依附文档库 git 后端，否则拒绝启动）。开启后写主体=**请求级主体**（v0.9：每次请求携 `subject` 字段或 `X-Core-Subject` 头，§2.1；无主体=匿名照判拒绝 403，本地信任不兜底 HTTP 匿名请求）。授权面=文档面 Role/Group 对象，**装载即权威快照，两段式刷新（v0.10 免重启热装载）**：① 启动装载 `global/roles/`、`global/groups/`（坏对象/重名=整体拒绝启动，授权面宁拒不降级）；② 其后 `repository.Watch` 变更信号（轮询 HEAD）驱动重投影**整体替换快照**（`gen` 代次每次成功装载 +1；create/update/delete 三态都随刷新生效，stderr 机器行 `权限热装载 gen=<n> roles=<n> groups=<n>`）。**热装载失败语义（declared）=保旧快照 + stderr 告警（`权限热装载失败…`）+ 定时重试自愈**：不半装载（LoadObjects 整体拒绝复用）、不打死运行中授权面——投影读与写面串行队列不互斥，暂态撕读与坏对象都不放大为全系统写面停摆（自举修复路径本身常是写路径）；保旧=上一次成功装载的权威快照继续生效（判定留痕一致：Gen 不动），坏对象清除后自动痊愈。dispatch 接线后由订阅方声明是否升级拒写闸门（本语义不变）。进程级本地信任（cored:local 持内置 admin）退化为引擎缺省 fallback，只服务程序化调用（bootstrap/工作流自写） |
| ops DB | `--ops-db <path>`（SQLite WAL 单文件）：apply_log/event_log 双轨审计的 DB 侧；为空=进程内存库（DB 非权威、可重建——持久化部署显式传路径） |
| 监听地址 | `--addr <host:port>`，缺省读 `CORE_SYSTEM_ADDR`，再缺省 `127.0.0.1:0`（回环随机端口，避免多宿主进程端口冲突） |
| 启动自检 | scheme 载入校验（必填项/唯一性/storage 模板）失败 → 退出码非 0，桥接方据此判定 |
| 就绪行 | 就绪后向 **stdout** 输出一行 `CORED_READY addr=<host:port> scheme_version=<v> kinds=<n> apply=<on\|off>`（机器可读；`apply=` 尾随令牌标注写面状态，解析宽松——旧桥只取 addr，不受尾随字段影响） |
| 退场 | SIGINT/SIGTERM → 优雅关闭（5s 超时强断） |

## 2. 只读查询面（HTTP，全部 GET）

| 端点 | 载荷 |
|---|---|
| `GET /healthz` | `{"ok":true}` 存活探针 |
| `GET /v1/scheme` | 概览：apiVersion/name/scope/version + 四类注册表计数 |
| `GET /v1/scheme/kinds` | 对象类型清单（list）：`{count, kinds:[…]}` |
| `GET /v1/scheme/kinds/{kind}` | 单类型详情（get）；未注册 → 404（Scheme 闸门语义） |
| `GET /v1/objects/{kind}?scope=<scope>` | 文档对象清单（list）：`{count, kind, scope, objects:[{kind,name,scope,resourceVersion}]}`（无正文，瘦身载荷）；`scope` 缺省=跨 scope 枚举（storage 模板可展开的全部分支） |
| `GET /v1/objects/{kind}/{name}?scope=<scope>` | 单个文档对象（get）：`{kind, name, scope, resourceVersion, content}`——content 为文档原文（yaml 或 md+frontmatter），读库内真实文档对象而非类型注册表 |

- 对象键 = `(kind, scope, name)`：scope 四层（builtin/global/系统/系统+实例）物化为目录前缀（layout.md），storage 路径由 scheme.yaml 各 kind 的 storage 模板解析。
- 错误→状态码：kind 未注册或对象不存在 → 404；scope 与模板不相容/命名违规 → 400；docs 未配置 → 503。
- **查询面只读**：查询端点非 GET 一律 405。写路径唯一入口是 Apply 管线（concepts/apply.md），只经 `POST /v1/apply`（见 §2.1）且缺省关闭。
- 载荷为 JSON；kind 详情保留声明原文（spec/fields/status/relations/未识别字段收敛进 extra），声明演进不破坏查询面。

### 2.1 写面（缺省关闭，`--allow-apply` 显式开启）：`POST /v1/apply`

写面是文档面唯一写端点，内部收敛 apply.Engine 三步闸门（scheme 准入=kind 注册+**spec 结构校验**（v0.14：对象 spec 区须过该 kind 注册声明的机读子集——缺必填段/枚举外值/结构错形 → 400，违规路径在错误文本如 `permissions[0].scope`；声明判读口径=scheme.md 设计规则 6）→权限准入（**请求级主体**，§2.1 `subject`）→乐观锁落库），不旁路存储；每次成功落库必发 `DocApplied` 事件（eventbus → event_log 归档 + 触发骨架收到留痕 §2.3；workflow 触发面接线后该留痕同步推进为对账 run 投影 §2.3 v0.15；notification 族绑定则推进为送达受理投影 §2.3 v0.16），幂等重入（同内容）no-op 零提交零事件（concepts/apply.md rule 1）。

请求体（JSON）：

```json
{"kind":"Agent","scope":"global","name":"core-headless","resourceVersion":1,
 "content":"<文档原文 yaml 或 md+frontmatter>","fieldManager":"agent/…","reasonRef":"…","dryRun":false,"force":false}
```

| 字段 | 语义 |
|---|---|
| `kind/scope/name` | 对象键，三者必填（缺 → 400） |
| `resourceVersion` | 乐观锁：创建=0（缺省）；更新=读到的版本，不符 → 409；`fromDraft=true` 时须缺省（期望值以草稿 `baseResourceVersion` 为准）。**幂等重入优先**：同内容重入（去 rv 比对）→ `noop` 短路，先于乐观锁判定（内容=现面的写入不可能丢任何更新，不发事件不落提交；loop-9 live 实证：同内容+陈旧 rv → noop 而非 409；409 仅在**内容≠现面且 rv 不符**时发生）。**spec 结构准入先于幂等比对**（v0.14）：内容不合 kind 注册声明 → 400，即使与库内现存一致也不 noop——坏内容不因已在库而获得再确认（现存对象已由声明校验器全量对账合规，loop-10 探针⑦前提不受影响） |
| `content` | 文档原文（存储层解析 metadata 身份，与对象键不符 → 400）；`fromDraft=true` 时须缺省（差异以草稿缓存为准） |
| `fieldManager` | 必填，无主写入拒绝 → 400（apply.md rule 2） |
| `subject` | **请求级主体（v0.9）**：`{user, roles:[…], groups:[…]}`——user=主体标识（审计留痕；user-system 目录侧未接前由调用方断言），roles/groups=断言持有关系（**须对上文档面 Role/Group 对象才产生权限**，断言本身不授权）；缺席回退 `X-Core-Subject` 头（同形 JSON，字段优先于头）；两者皆缺=匿名主体 → 权限准入拒绝 403；`dryRun` 同主体判定（准入结论与真执行一致） |
| `dryRun` | true=零副作用（无提交/无审计行/无事件），返回准入结论+现版本 |
| `fromDraft` | true=稿→面落库（§2.2）：引擎取草稿走同一三步闸门，成功（create\|update\|noop）后清稿；无稿 → 404 |

响应（200）：`{"resource":"kind/scope/name","rv":<n>,"action":"create|update|noop","dryRun":false,"event":{"id","type","dedupKey"}}`（`event` 仅真实落库时存在，noop/dry-run 不发事件）。

错误→状态码：乐观锁冲突 → **409**（载荷含 `expected`/`current`）；kind 未注册（野对象）或对象不存在 → 404；权限准入拒绝（含匿名主体/断言 role 未对上授权面/硬规则）→ **403**；**spec 结构未过准入 → 400（v0.14）**（错误文本携违规路径，如 `permissions[0].scope: 必填段缺失`）；无主写入/对象键不全/身份不符/内容不可解析/盲写已存在/scope 不相容 → 400；写队列关停 → 503；写面未开启 → **405**（`POST /v1/apply` 恒可探测，`GET /v1/apply` 亦 405）。
`apply_log` 审计行 result 枚举：`ok`（落库）/`noop`（幂等重入）/`denied`（准入拒绝——scheme 结构（v0.14）/权限/硬规则，**携带主体标识** subject 列——anonymous=匿名，permission.md 规则 3 判定留痕，判定摘要携违规路径）/`conflict`（乐观锁冲突，含现库版本）——git 提交数 ≙ ok 行数（对账不变量，ops-log.md §3；noop/denied/conflict 不对应提交）。

### 2.2 草稿缓存面（编辑与发布分离，apply.md §1/§6 rule 6）

草稿缓存是**编辑的家**：代改代审的改动先落草稿——不触碰文档面（无 Revision/无事件），apply 落库那一刻才算数。落点=进程内存为底；**持久化随 `--ops-db` 部署决策一并注入（v0.10）**：给定 `--ops-db`（文件路径）⇒ 落稿/弃稿**写穿** ops DB draft 表（ops-log.md §2）+ 启动**恢复**（stderr 恢复行 `草稿恢复 restored=<n> skipped=<n>` 机器可取证）；缺省内存语义不变（重启即清，草稿可重放）。

| 端点 | 载荷/语义 |
|---|---|
| `GET /v1/drafts` | 草稿清单（瘦身，恒开）：`{count, drafts:[{kind,scope,name,fieldManager,baseResourceVersion,updatedAt,bytes}]}`（无正文） |
| `GET /v1/drafts/{kind}/{name}?scope=<scope>` | 单条草稿（恒开，含 `content` 原文 + `reasonRef` + `createdAt/updatedAt`）；无稿 → 404 |
| `GET /v1/triggers` | 触发骨架查询面（§2.3，恒开）：`{count, received, dropped, types, records:[…]}`——dispatch 表驱动订阅留痕（records 携命中行投影 route/cc/for/owner + 执行绑定投影 execution） |
| `GET /v1/triggers/resolve` | 派发决策查询面（§2.3 v0.13+v0.14，恒开）：`?type=<类型>&involved=<kind/scope/name>` → `{type, involved, matched, route, cc, for, owner, row, execution}`——对当前 dispatch 表快照回答「这一事件若到达会路由到哪、由谁执行」（纯决策：零事件注入、零留痕、零派发；execution=`{route:{executor,target,wired}, cc:{…}}` 执行面绑定投影） |
| `GET /v1/workflows/runs` | 对账 run 投影面（§2.3 v0.15，恒开）：`{count, started, dropped, runs:[…]}`——route 目标执行面=workflow 且装配层已接线的留痕推进为一次对账 run 投影（触发已受理+声明起点；run 溯源字段与留痕/发布回执同源） |
| `GET /v1/notifications/deliveries` | 送达投影面（§2.3 v0.16+v0.17，恒开）：`{count, accepted, sent, failed, dropped, deliveries:[…]}`——执行面=notification 且装配层已接线的绑定（route 主路与 cc 旁路，origin 维度留痕）推进为一条送达投影（送达已受理+通道投影；v0.17 出站注入后 status 翻转 sent/failed；溯源字段与留痕/发布回执同源） |
| `GET /v1/agents/wakes` | 唤醒投影面（§2.3 v0.18，恒开）：`{count, accepted, dropped, wakes:[…]}`——执行面=agent（`<p>-agent` 族：root-agent/parent-agent）且装配层已接线的绑定（route 主路与 cc 旁路，origin 维度留痕）推进为一条唤醒投影（唤醒已受理+agent 锚投影；溯源字段与留痕/发布回执同源） |
| `POST /v1/drafts` | 落稿（upsert，同对象键覆盖=最新代改稿，`createdAt` 定格 `updatedAt` 更新）：`{kind,scope,name,content,fieldManager,reasonRef,baseResourceVersion}`；键不全/无主/空稿 → 400 |
| `DELETE /v1/drafts/{kind}/{name}?scope=<scope>` | 弃稿；无稿 → 404 |
| `POST /v1/apply` + `"fromDraft":true` | 稿→面落库：以草稿 content 为写者输入、草稿 `baseResourceVersion` 为乐观锁期望值，走与直写同一三步闸门（scheme/权限/存储——权限按**请求级主体**判定，同 §2.1 `subject` 语义；成功后**清稿**）；无稿 → 404 |

- **门控**：POST/DELETE 草稿与 `fromDraft` apply 随写面开关 `--allow-apply`（缺省 405，与 §2.1 同一开关）；草稿 GET 属查询面恒开。开启写面须同时 `--docs`（fromDraft 恒有文档库可落）。
- **乐观锁语义**：`baseResourceVersion` = 落稿时读到的文档面版本（0=预期创建）。文档面前移 → apply-draft **409 且草稿保留**（后写者重读后重整草稿再落——LLM 语义 diff 的人裁落点）；BaseRV=1 而对象不存在同样冲突（expected≠current）。
- **空稿/幂等**：稿与面一致 → `action=noop`（零提交零事件）且清稿；`fromDraft` 无稿 → **404**（与 noop 可区分）；`fromDraft=true` 携 `content`/`resourceVersion` → 400（约束差异来源唯一）。
- **草稿不是文档面**：落稿/弃稿零提交零事件零 Revision；落稿面**不做 scheme 校验**（wild kind 稿可落，编辑面与存储闸门解耦——apply-draft 时被 scheme 闸门拒绝：野 kind → 404；**spec 结构未过 → 400（v0.14）**；均**稿保留**，改正后再落）；落稿须携 `fieldManager`（无主稿拒绝，溯源对齐 rule 2），apply-draft 另校验确认者自身 `fieldManager`。
- **草稿读面无 plugin 句柄**：§3.1 持续句柄只封装对象读面（只读不变式不扩面）；草稿面经 HTTP 直查（宿主内调试/验收探针用），是否升句柄随消费端出现再议。
- **持久化边界（v0.10）**：写穿语义=先持久化后落内存（持久化失败=落稿失败、内存不动——「可见即已持久」，重启恢复不丢稿不多稿）；恢复=整表替换（确定性）；恢复保留 `createdAt/updatedAt` 与 `baseResourceVersion`——重启期间文档面前移则 fromDraft 走既有 **409 保留草稿**语义（乐观锁期望值不因恢复而改写，后写者重读后重整）；草稿表不参与 apply_log 对账不变量（缓存非账，ops-log.md §2）。

### 2.3 触发骨架面（dispatch 第二段 v0.12 订阅面动态化 → 第三段 v0.13 引擎主体第一段：owner 解析激活+决策可查询 → 第四段 v0.14 引擎主体第二段：派发执行投影 → 第五段 v0.15 引擎主体第三段：真实拉起第一子段——workflow 触发面接线+对账 run 投影 → 第六段 v0.16 引擎主体第四段：真实拉起第二子段——notification 送达面接线+送达受理投影 → 第四段收尾 v0.17：受理后真实通道出站挂接——exec 出站桥+送达状态机 → 第七段 v0.18 引擎主体第五段：真实拉起第三子段——agent 唤醒面接线+唤醒投影面，恒开）：`GET /v1/triggers` + `GET /v1/triggers/resolve` + `GET /v1/workflows/runs` + `GET /v1/notifications/deliveries` + `GET /v1/agents/wakes`

「apply→事件→订阅」是 core 主干第一段：cored 内 workflow 包 `TriggerHub` 以**单订阅者**挂事件总线，收到即落**进程内可查状态**（本端点读取）。事件本体不落文档库（event.md：事件不是文档对象）；审计账本仍在 event_log 归档（ops-log.md §2）——留痕是观测面不是账本。载荷：

```json
{"count":1,"received":1,"dropped":0,"types":["*"],
 "records":[{"seq":1,"eventId":"evt-DocApplied-…","type":"DocApplied",
   "dedupKey":"apply:Kind/scope/name:1","source":"apply","involved":"Kind/scope/name",
   "level":"info","route":"owner-workflow","cc":"","for":"owner:*","owner":"<scope 根解析>",
   "execution":{"route":{"executor":"workflow","target":"owner","wired":false},"cc":{"executor":"","target":"","wired":false}},
   "at":"<RFC3339>","receivedAt":"<RFC3339>"}]}
```

- **订阅集合表驱动（v0.12）**：`types` = `scheme.dispatch` 表 `on:` 值按表序去重的推导集合；表含通配行（`on: "*"`）时**坍缩为单条全类型订阅**、`types=["*"]`（通配已覆盖枚举，并存会重复留痕）；空表=零订阅（事件全部落总线死信，路由不到可见）。判别锚：`types` ≠ 固定 `[DocApplied]`——固订时代（v0.11）已收口。
- **收到留痕与发布回执同源**：`eventId`/`dedupKey` 与 apply 响应 `event` 字段、event_log 归档行三方一致——主干第一段的机械对账锚点（apply 落面→订阅方状态可查）。
- **命中行投影（v0.13，留痕=过去的决策投影，不执行派发）**：每条留痕按**表序**解析首个命中行（`on` 匹配类型 ∧ `for` 谓词命中）投影到 `route`/`cc`/`for`/`owner` 字段；`for` 谓词口径（event.md 设计规则 6）：`any`/`owner:*` 恒命中，`scope:<root>/*` 按 involved scope 前缀式命中（`builtin/*` 命中 builtin；scope 是路径，`systems/<s>` 层级并段），**`owner:<字面量>` 按 owner 解析命中（v0.13 引擎主体第一段）**——owner 解析模型：involved scope 根 `systems/<s>`→`<s>`、global/builtin 同名（owner=scope 根本身），解析不等 → 不命中顺延后行；`owner` 字段=解析值（决策依据可查）；全表未命中 → `route="dead-letter"`（死信兜底可见，event.md rule 4，与 eventbus `routed_to="dead-letter"` 同词汇表）。
- **派发决策查询面（v0.13，恒开）**：`GET /v1/triggers/resolve?type=<类型>&involved=<kind/scope/name>`（involved 可缺省=空解析）→ `{"type","involved","matched","route","cc","for","owner","row"}`——对当前 dispatch 表快照回答「这一事件若到达会路由到哪」：**纯决策**（零事件注入、零留痕、零派发，`received` 不动）；`row`=命中表行号（0 起，可回指 scheme.yaml 具体行），全表未命中 `row=-1` ∧ `route="dead-letter"`（合成死信），未挂表 `route=""`；缺 `type` → 400；未接线 → 503。**owner 谓词的 live 机械验证落点**：无事件注入面（connector 未接线）也能验证 `owner:agent` 行按解析命中（如 `type=HeartbeatLost&involved=ServiceInstance/systems/agent/ci` → `route=parent-agent, owner=agent`）——判别器：`owner:agent` 行从「恒不命中顺延」（v0.12）变「按 owner 解析命中」（v0.13）。
- **派发执行投影（v0.14 引擎主体第二段，决策与留痕同投影）**：命中行的 `route:`/`cc:` 目标再经映射表投影执行面绑定 `execution={route:{executor,target,wired}, cc:{executor,target,wired}}`——「路由到哪」之后的下一问「谁来执行」可查询。映射表按**目标族**收编（event.md 规则 6；通用性=新目标落已知家族即自动映射，扩展性=新家族登记一行，解耦=映射只投影不执行）：`dead-letter`→`none`（死信无执行，观测兜底出口）；`notification/<channel>`→`notification`（`*`=全部已绑通道）；`workflows/<name>`→`workflow`（直接 workflow 引用）；`<p>-agent`→`agent`（parent、root 等前缀）；`<p>-workflow`→`workflow`（owner 对账锚，如 `owner-workflow`→`{workflow, owner}`）；**未知目标族原样投影 `executor=unbound`**（缺口可见，不静默吞并——`observation-bus`/`instance-docs` 等未设计执行面的目标族即由此可见）；空 `cc`=零值绑定（`executor=""`）。`wired`=执行面接线态：装配层登记（hub `WireExecutor`）前恒 **false**——**执行计划可查 ≠ 执行面已在位**（诚实投影），真实拉起落地轮登记后翻转=机械判别器；全表未命中的合成死信 `execution.route.executor=none`，未挂表=无决策即无执行计划（零值绑定）。留痕 `execution` 区=收到时刻的执行计划快照。
- **对账 run 投影（v0.15 引擎主体第三段——真实拉起第一子段：workflow 触发面接线）**：装配层**双登记**（hub `BindRuns` 挂 run 投影落点 ∧ `WireExecutor(workflow)` 翻转接线态）后，route 目标执行面=workflow 的留痕同步推进为一条 run 投影（`GET /v1/workflows/runs`，载荷 `{count, started, dropped, runs}`；单登记不推进——接线判定=两登记同时在场，机械判别器=决策投影 `wired` 翻转 ∧ run 面出现）。run 字段：`workflow`（锚）/`specSource`（`builtin`=内置注册表命中，`object`=平台对象引用）/`phases`+`phase`（声明相位序列与起点=首相位；仅 builtin 命中投影）/`status`（`triggered`=触发已受理）/`triggerSeq`/`eventId`/`dedupKey`/`route`/`owner`/`target`（溯源字段与留痕、发布回执同源，run 可回指 `/v1/triggers` 留痕）。锚解析纯映射（event.md 规则 6）：对账锚（`<p>-workflow` 族）→ 对账循环锚 `core-workflow`（对账=系统级循环本体，workflow.md Controller/Reconciler 对照；owner 维度由 `owner` 字段承载）；以 workflows 为前缀的直接引用 → 按名解析 builtin 注册表，未命中=平台对象引用（Workflow 对象 spec 随文档面——锚保留、相位不投影，不吞并不缺口化）。**run 出现 ≠ 对账执行完毕**：相位推进器 deferred，run 只证明触发面把事件接进了 workflow 域（诚实投影的起点语义）。非 workflow 执行面（notification/agent/none）不产生 run。
- **builtin 注册表六项对齐（v0.19 相位态机首段——声明面完备）**：`specSource=builtin` 的注册表与 scheme.yaml `runtime.workflows.builtin` **六项全量对齐**（v0.19 前 dev-delivery/apply-workflow 相位词汇映射未落设计、注册表只收四项，两锚降级 `object` 投影=缺口可见；core_design 先落 concepts/workflow.md §1 相位词汇映射表——dev-delivery 九相位含**交付锚 `Deploying`**（相位词汇只加不改，Analyze→Gate→Plan→Execute→Verify→Deploy→Report 步锚映射）、apply-workflow=default-task 八相位词汇全量复用——运行时注册表随后收编，声明↔注册表同源）。机械判别器：`workflows/dev-delivery` 命中行的 run 投影 `specSource=builtin` ∧ `phases` 含 `Deploying`（旧代=`object` ∧ 零相位）；`workflows/apply-workflow` run 的 `phases` 与 default-task 同族全等。注册表外锚（如 `deploy-system-workflow`）仍 `object` 不收编，其 run 的 `phases` 载荷=**空数组非 null**（锚保留、相位不投影——null=缺席语义与 []=声明为空两分，消费方可 len）。**推进口径不变**：`status` 恒 `triggered`、`phase` 恒声明首相位——推进须由引擎真实驱动，声明面完备≠推进已实现（受词诚实投影，与唤醒 `accepted` 同款口径）。
- **送达受理投影（v0.16 引擎主体第四段——真实拉起第二子段：notification 送达面接线）**：装配层**双登记**（hub `BindDeliveries` 挂送达投影落点 ∧ `WireExecutor(notification)` 翻转接线态）后，执行面=notification 的绑定同步推进为一条送达投影（`GET /v1/notifications/deliveries`，载荷 `{count, accepted, dropped, deliveries}`；单登记不推进——接线判定=两登记同时在场，机械判别器=决策投影 `wired` 翻转 ∧ 送达面出现，与 run 面同口径）。与 run 面的声明差异：送达投影**route 主路与 cc 旁路双路同 sink 收编**——通知本身即旁路语义（以通知为主路的行如 ApprovalNeeded，以通知为旁路的行如 Escalate/HeartbeatLost 的 `cc:`——主/旁维度由 `origin` 字段留痕，不再为旁路单开 sink 面）。送达字段：`delivery`（序号）/`channel`（通道投影，`*`=全部已绑通道）/`origin`（`route`/`cc`）/`status`（`accepted`=送达已受理；v0.17 出站注入后翻转 `sent`/`failed`）/`level`（事件等级，fatal 必接 Notification 规则的机械观察点）/`triggerSeq`/`eventId`/`dedupKey`/`route`/`owner`（溯源字段与留痕、发布回执同源，送达可回指 `/v1/triggers` 留痕）。**送达投影出现 ≠ 已送达真实通道**（v0.16 口径，v0.17 后未注入出站的部署仍成立）：未注入出站时送达只证明触发面把 notification 族绑定接进了送达域（诚实投影的受理语义，与 run 起点语义同构）。非 notification 执行面（workflow/agent/none）不产生送达投影。
- **真实通道出站挂接（v0.17 第四段收尾——受理后的进程内自动投递注入）**：装配层经 `--outbound-exec <命令行>`（空白分隔令牌，支持单/双引号段；复杂引号需求走包装脚本）注入 **exec 出站桥**——送达受理后**异步**出站：桥把该投影渲染为**出站信封**（`connectors.OutboundEnvelope`，JSON 经子进程 stdin 投递；subject/body 由桥内建渲染，模板 ref 声明面 deferred；secret 永不经手信封/旗标——实现侧引用式取值 `env:*` 自行解析，子进程 env 全量透传），命令 exit 0=成功。完成后送达投影**就地翻转**：`status=accepted→sent`（成功）/`failed`（失败、超时、出站队列满、停机未起跑——错误摘要有界留存于 `error` 键），出站留痕 `attempts`（真实尝试次数）∧ `completedAt`；载荷计数新增 `sent`/`failed`（连同 `attempts`/`completedAt` 恒在=**新代判别器**，旧构建键缺席）。语义边界：一次尝试无重试（重试/降级/静默 declared-deferred）；出站队列满=立即判 failed 不阻塞受理路径（sink 非阻塞契约）；停机=在途等完成、未起跑任务留 accepted 不重放（投影面非账本，账本=event_log）。未注入（缺省）语义与 v0.16 完全一致且零 goroutine。依赖方向不反转：实现侧出站命令（如连接器仓邮件直达入口的信封模式）住连接器仓/部署侧，cored 不 import 连接器仓——同一实现侧出站能力两种挂接方式（进程内 OpsConnector 契约挂靠 / 跨进程 exec 桥）任选，声明面不变。
- **唤醒受理投影（v0.18 引擎主体第五段——真实拉起第三子段：agent 触发面接线）**：装配层**双登记**（hub `BindAgents` 挂唤醒投影落点 ∧ `WireExecutor(agent)` 翻转接线态）后，执行面=agent 的绑定同步推进为一条唤醒投影（`GET /v1/agents/wakes`，载荷 `{count, accepted, dropped, wakes}`；单登记不推进——接线判定=两登记同时在场，机械判别器=决策投影 `wired` 翻转 ∧ 唤醒面出现，与 run/送达面同口径）。与送达面同款双路收编：route 主路与 cc 旁路双路同 sink（绑定落在哪一路由 `origin` 字段留痕；现行 scheme.dispatch 表 agent 族目标均在 route 主路——Escalate→`root-agent`、HeartbeatLost（owner:agent 谓词）→`parent-agent`；cc-agent 为通用性预留）。唤醒字段：`wake`（序号）/`agent`（agent 锚投影=`<p>-agent` 前缀段：root=builtinRoot 根 Agent、parent=involved 对象 ownerRefs 的 ParentAgent，concepts/agent.md）/`origin`（`route`/`cc`）/`status`（`accepted`=唤醒已受理）/`level`（事件等级——Escalate/HeartbeatLost 均 error，唤醒分诊观测点）/`triggerSeq`/`eventId`/`dedupKey`/`route`/`owner`（溯源字段与留痕、发布回执同源，唤醒可回指 `/v1/triggers` 留痕）。**唤醒投影出现 ≠ agent 会话已被拉起**（诚实投影与 run 起点语义同构：真实拉起=session spawn/agent 池，agent-session.md 域，declared-deferred；本面只证明触发面把事件接进了 agent 域）。非 agent 执行面（workflow/notification/none）不产生唤醒投影。
- **环形容量**（缺省 256）：溢出丢最旧、`dropped` 计数可见；总线订阅缓冲满时事件按**可丢语义**转死信（event.md P3 level-triggered，系统正确性不依赖事件送达；`received <` 实际落库数属正常爆发态，死信可见兜底）。run 投影环、送达投影环与唤醒投影环同口径（容量独立、`started`/`accepted`=`dropped`+环内条数对账不变量）。
- **写面关断不受影响**：触发骨架随总线装配，查询面恒开——`--allow-apply` 关断时不产生事件（`received=0`、`types` 照常表驱动值），只读部署的观测回归点。
- **退场语义**：进程退场留痕即清（进程内状态，不持久化）；账本在 event_log，重启不丢审计。
- **触发引擎主体 declared-deferred（v0.19 后余量）**：owner 字面量解析（v0.13）、**派发执行投影**（route/cc 目标→执行面绑定，v0.14）、**workflow 触发面接线+对账 run 投影**（真实拉起第一子段，v0.15）、**notification 送达面接线+送达受理投影**（真实拉起第二子段，v0.16，route+cc 双路同 sink）、**受理后真实通道出站挂接**（送达状态机+exec 出站桥，v0.17）、**agent 唤醒面接线+唤醒投影面**（真实拉起第三子段，v0.18）与 **builtin 注册表六项对齐**（相位态机首段——声明面完备，v0.19）**已收口**；余下——**相位推进器**（六项声明相位序列已可投影，推进由引擎真实驱动：迁移判定/挂起-恢复）、刹车、冷却期、`minLevel` 过滤、通知重试/降级/静默窗口、送达记录进 ops DB 账本面、agent 真实拉起（session spawn/agent 池）——本骨架不含；订阅面、全谓词口径、决策查询面、执行投影、run 投影、送达投影与唤醒投影已表驱动（v0.18），引擎主体按 cored-bridge 既有边界另行接入。
- **notification 真实通道投递的契约面与首实现已落（loop-16 通知增量，非 cored 面）**：workservice `connectors` 包 **OpsConnector 五方法契约**（工具调用域：`Type/Version/Ops/Invoke/Probe`——与资源域 ProviderImpl 两物；注册表 `RegisterOpsConnector/LookupOpsConnector`）+ common_connector **notify 实现**（`notify`/`send-email` op，SMTP implicit TLS 出站，secret 引用式取值 `env:QQ_SMTP_AUTH_CODE`，收件人清单在 Provider 配置面；依赖方向恒为 connector 仓 → 契约层，cored 不 import 连接器仓）。**进程内自动投递注入机制已落（v0.17）**：cored `--outbound-exec` 装配注入 + 出站信封协议（`connectors.OutboundEnvelope`，同在契约包——实现侧以信封模式消费，如邮件直达入口的 `--envelope` 旗标）+ 送达投影出站状态翻转（见上条）；缺省关断（送达止于受理投影），是否注入属部署侧决策逐 profile 装配。

## 3. plugin↔cored 桥契约（dsh plugin 侧）

```
dsh 宿主（cordis entry id=core-system）
  └─ plugin apply(config)
       ├─ coredBin 定位：config.coredBin → env CORE_SYSTEM_CORED_BIN → PATH 上的 cored
       ├─ spawn cored --scheme <schemePath>          # schemePath：config → env CORE_SYSTEM_SCHEME
       ├─ 解析 stdout 就绪行 → http://<addr>
       ├─ 转发一次查询：GET /v1/scheme + /v1/scheme/kinds
       ├─ 结果挂 ctx.coreSystem = {url, scheme, kinds}，日志留痕
       ├─ 挂持续查询句柄：ctx.coreSystem.get / ctx.coreSystem.list（见 §3.1）
       └─ ctx.effect 注册退场回收（插件卸载 ⇒ cored 子进程 SIGTERM）
```

### 3.1 持续只读查询句柄（ctx.coreSystem.get/list）

一次性 probe 之上，桥向同宿主插件暴露**持续句柄**——对象读面的 fetch 封装，宿主存续期恒可调用：

| 句柄 | 端点封装 | 返回 |
|---|---|---|
| `get(kind, scope, name)` | `GET /v1/objects/{kind}/{name}?scope=<scope>`（§2） | `data={kind,name,scope,resourceVersion,content}`（content=文档原文） |
| `list(kind, scope?)` | `GET /v1/objects/{kind}`（scope 缺省=跨 scope 枚举，§2） | `data=瘦身引用数组 [{kind,name,scope,resourceVersion}]` |

- **结果判别联合，机械可分支**：`{ok:true, data}` / `{ok:false, status, error}`——status 保留 HTTP 语义（404=对象/类型不存在、503=文档库未配置……），`status=null` 表传输层失败（url 未就绪/连接拒绝）；句柄**永不抛错**（查询失败不阻断宿主，§3 同款语义）。
- **只读不变式**：句柄只封装 §2 的 GET 端点，不引入任何新写路径；写路径唯一入口仍是 §2.1 且缺省关闭。
- **时序安全**：spawn 路径句柄在 provide 时即挂载（早于就绪行），url 填值前调用返回 `ok:false status:null`——消费方无需等待桥接完成即可安全引用。
- **机械验证**：plugin 仓 `npm test`（node --test）：单元（假读面 canned）+ 端到端（真实 cored 二进制 + 临时 fixture 文档库；cored 不在 PATH 时 skip，同「宿主健康优先」）。

| config 字段 | 缺省语义 |
|---|---|
| `autoSpawn`（缺省 true） | false 时本宿主不拉起 cored（只读面外置，如共享调试实例） |
| `coredUrl` | 已在运行的 cored 基址；设置则跳过 spawn 直接查询 |
| `schemePath` | 为空且无 `CORE_SYSTEM_SCHEME` 时桥接不启动（warn，不阻断宿主） |
| `coredArgs` | 附加参数透传（如 `["--docs","<文档库根>"]` 挂对象读面；文档库锚点同属部署锚点，不入公开仓） |
| `readyTimeoutMs`（缺省 10000） | 就绪行超时；超时/子进程先退 → 桥接失败日志，宿主继续运行 |

- **部署锚点注入方式**：各 profile 用户 patch 层按行 id（`core-system`）覆写 config（patch 覆写=整行 config 替换，不合并），或经 `CORE_SYSTEM_*` 环境变量；公开仓只保留机制与缺省值。
- **写面缺省不注入**：桥桥接的 coredArgs 缺省只含 `--docs`（读面锚点）；`--allow-apply`/`--ops-db` 不由桥缺省注入——现网宿主保持只读暴露，写面按部署决策逐 profile 显式开启（开启后的部署锚点记部署侧台账，不入公开仓）。
- **查询失败不阻断宿主**：桥接是探针性质（probe），`kinds=null` 即"本轮未通"，由验收报告如实记录——宿主健康优先于桥接成功。

## 4. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 多宿主进程同时拉 cored 端口冲突 | ✅ 低 | 缺省回环随机端口；就绪行回读实际地址 |
| cored 崩溃连坐 dsh 宿主 | ✅ 低 | 子进程隔离；桥接失败仅留错误日志；后续轮次加看门狗重启 |
| 就绪行协议演进破坏旧桥 | ⚠️ 中 | 行格式前缀 `CORED_READY` + 本文契约锚定；解析宽松（未匹配=未就绪，不误判） |
