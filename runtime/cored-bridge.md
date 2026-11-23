# Runtime 3：cored 只读面与 plugin↔cored 桥（cored-bridge）

> 落点依据：impl/self-recursive-core.md「cored 保留为冷启动入口与调试用途」+ dsh-plugin.md「core plugin 承接控制面」。本文定义 cored 进程的最小只读查询面与 dsh plugin 拉起 cored 的桥接契约——两者都是**机制描述**，不含部署锚点（真实路径经环境/配置注入，rule.md R-PUB-1/2）。代码落点：workservice 仓 `cmd/cored` + `internal/{scheme,apiserver}`；plugin 仓 `plugin/src/index.ts`。

## 1. cored 进程契约

| 项 | 契约 |
|---|---|
| scheme 源 | `--scheme <path>`，缺省读环境变量 `CORE_SYSTEM_SCHEME`；二者皆空则拒绝启动 |
| 文档库根 | `--docs <root>`，缺省读环境变量 `CORE_SYSTEM_DOCS`；为空则对象读面不挂载（`/v1/objects/*` → 503），scheme 面不受影响；给定即打开 repository git 后端（串行写队列+resourceVersion 乐观锁，缺省仅读暴露） |
| 写面开关 | `--allow-apply`（缺省 false=只读）：显式开启 `POST /v1/apply` 写端点与草稿写操作（§2.2 落稿/弃稿/fromDraft 同开关）；开启时必须同时给 `--docs`（写面依附文档库 git 后端，否则拒绝启动）。开启后写主体=**请求级主体**（v0.9：每次请求携 `subject` 字段或 `X-Core-Subject` 头，§2.1；无主体=匿名照判拒绝 403，本地信任不兜底 HTTP 匿名请求）。授权面=文档面 Role/Group 对象：启动时装载 `global/roles/`、`global/groups/`（坏对象/重名=整体拒绝启动，授权面宁拒不降级；事件驱动刷新随 dispatch 接线 declared-deferred）；进程级本地信任（cored:local 持内置 admin）退化为引擎缺省 fallback，只服务程序化调用（bootstrap/工作流自写） |
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

写面是文档面唯一写端点，内部收敛 apply.Engine 三步闸门（scheme 准入→权限准入（**请求级主体**，§2.1 `subject`）→乐观锁落库），不旁路存储；每次成功落库必发 `DocApplied` 事件（eventbus → event_log 归档），幂等重入（同内容）no-op 零提交零事件（concepts/apply.md rule 1）。

请求体（JSON）：

```json
{"kind":"Agent","scope":"global","name":"core-headless","resourceVersion":1,
 "content":"<文档原文 yaml 或 md+frontmatter>","fieldManager":"agent/…","reasonRef":"…","dryRun":false,"force":false}
```

| 字段 | 语义 |
|---|---|
| `kind/scope/name` | 对象键，三者必填（缺 → 400） |
| `resourceVersion` | 乐观锁：创建=0（缺省）；更新=读到的版本，不符 → 409；`fromDraft=true` 时须缺省（期望值以草稿 `baseResourceVersion` 为准） |
| `content` | 文档原文（存储层解析 metadata 身份，与对象键不符 → 400）；`fromDraft=true` 时须缺省（差异以草稿缓存为准） |
| `fieldManager` | 必填，无主写入拒绝 → 400（apply.md rule 2） |
| `subject` | **请求级主体（v0.9）**：`{user, roles:[…], groups:[…]}`——user=主体标识（审计留痕；user-system 目录侧未接前由调用方断言），roles/groups=断言持有关系（**须对上文档面 Role/Group 对象才产生权限**，断言本身不授权）；缺席回退 `X-Core-Subject` 头（同形 JSON，字段优先于头）；两者皆缺=匿名主体 → 权限准入拒绝 403；`dryRun` 同主体判定（准入结论与真执行一致） |
| `dryRun` | true=零副作用（无提交/无审计行/无事件），返回准入结论+现版本 |
| `fromDraft` | true=稿→面落库（§2.2）：引擎取草稿走同一三步闸门，成功（create\|update\|noop）后清稿；无稿 → 404 |

响应（200）：`{"resource":"kind/scope/name","rv":<n>,"action":"create|update|noop","dryRun":false,"event":{"id","type","dedupKey"}}`（`event` 仅真实落库时存在，noop/dry-run 不发事件）。

错误→状态码：乐观锁冲突 → **409**（载荷含 `expected`/`current`）；kind 未注册（野对象）或对象不存在 → 404；权限准入拒绝（含匿名主体/断言 role 未对上授权面/硬规则）→ **403**；无主写入/对象键不全/身份不符/内容不可解析/盲写已存在/scope 不相容 → 400；写队列关停 → 503；写面未开启 → **405**（`POST /v1/apply` 恒可探测，`GET /v1/apply` 亦 405）。
`apply_log` 审计行 result 枚举：`ok`（落库）/`noop`（幂等重入）/`denied`（准入拒绝，**携带主体标识** subject 列——anonymous=匿名，permission.md 规则 3 判定留痕）/`conflict`（乐观锁冲突，含现库版本）——git 提交数 ≙ ok 行数（对账不变量，ops-log.md §3；noop/denied/conflict 不对应提交）。

### 2.2 草稿缓存面（编辑与发布分离，apply.md §1/§6 rule 6）

草稿缓存是**编辑的家**：代改代审的改动先落草稿——不触碰文档面（无 Revision/无事件），apply 落库那一刻才算数。落点=进程内存为底；**持久化随 `--ops-db` 部署决策一并注入（v0.10）**：给定 `--ops-db`（文件路径）⇒ 落稿/弃稿**写穿** ops DB draft 表（ops-log.md §2）+ 启动**恢复**（stderr 恢复行 `草稿恢复 restored=<n> skipped=<n>` 机器可取证）；缺省内存语义不变（重启即清，草稿可重放）。

| 端点 | 载荷/语义 |
|---|---|
| `GET /v1/drafts` | 草稿清单（瘦身，恒开）：`{count, drafts:[{kind,scope,name,fieldManager,baseResourceVersion,updatedAt,bytes}]}`（无正文） |
| `GET /v1/drafts/{kind}/{name}?scope=<scope>` | 单条草稿（恒开，含 `content` 原文 + `reasonRef` + `createdAt/updatedAt`）；无稿 → 404 |
| `POST /v1/drafts` | 落稿（upsert，同对象键覆盖=最新代改稿，`createdAt` 定格 `updatedAt` 更新）：`{kind,scope,name,content,fieldManager,reasonRef,baseResourceVersion}`；键不全/无主/空稿 → 400 |
| `DELETE /v1/drafts/{kind}/{name}?scope=<scope>` | 弃稿；无稿 → 404 |
| `POST /v1/apply` + `"fromDraft":true` | 稿→面落库：以草稿 content 为写者输入、草稿 `baseResourceVersion` 为乐观锁期望值，走与直写同一三步闸门（scheme/权限/存储——权限按**请求级主体**判定，同 §2.1 `subject` 语义；成功后**清稿**）；无稿 → 404 |

- **门控**：POST/DELETE 草稿与 `fromDraft` apply 随写面开关 `--allow-apply`（缺省 405，与 §2.1 同一开关）；草稿 GET 属查询面恒开。开启写面须同时 `--docs`（fromDraft 恒有文档库可落）。
- **乐观锁语义**：`baseResourceVersion` = 落稿时读到的文档面版本（0=预期创建）。文档面前移 → apply-draft **409 且草稿保留**（后写者重读后重整草稿再落——LLM 语义 diff 的人裁落点）；BaseRV=1 而对象不存在同样冲突（expected≠current）。
- **空稿/幂等**：稿与面一致 → `action=noop`（零提交零事件）且清稿；`fromDraft` 无稿 → **404**（与 noop 可区分）；`fromDraft=true` 携 `content`/`resourceVersion` → 400（约束差异来源唯一）。
- **草稿不是文档面**：落稿/弃稿零提交零事件零 Revision；落稿面**不做 scheme 校验**（wild kind 稿可落，编辑面与存储闸门解耦——apply-draft 时被 scheme 闸门拒绝 → 404 且稿保留）；落稿须携 `fieldManager`（无主稿拒绝，溯源对齐 rule 2），apply-draft 另校验确认者自身 `fieldManager`。
- **草稿读面无 plugin 句柄**：§3.1 持续句柄只封装对象读面（只读不变式不扩面）；草稿面经 HTTP 直查（宿主内调试/验收探针用），是否升句柄随消费端出现再议。
- **持久化边界（v0.10）**：写穿语义=先持久化后落内存（持久化失败=落稿失败、内存不动——「可见即已持久」，重启恢复不丢稿不多稿）；恢复=整表替换（确定性）；恢复保留 `createdAt/updatedAt` 与 `baseResourceVersion`——重启期间文档面前移则 fromDraft 走既有 **409 保留草稿**语义（乐观锁期望值不因恢复而改写，后写者重读后重整）；草稿表不参与 apply_log 对账不变量（缓存非账，ops-log.md §2）。

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
