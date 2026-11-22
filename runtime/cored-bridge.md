# Runtime 3：cored 只读面与 plugin↔cored 桥（cored-bridge）

> 落点依据：impl/self-recursive-core.md「cored 保留为冷启动入口与调试用途」+ dsh-plugin.md「core plugin 承接控制面」。本文定义 cored 进程的最小只读查询面与 dsh plugin 拉起 cored 的桥接契约——两者都是**机制描述**，不含部署锚点（真实路径经环境/配置注入，rule.md R-PUB-1/2）。代码落点：workservice 仓 `cmd/cored` + `internal/{scheme,apiserver}`；plugin 仓 `plugin/src/index.ts`。

## 1. cored 进程契约

| 项 | 契约 |
|---|---|
| scheme 源 | `--scheme <path>`，缺省读环境变量 `CORE_SYSTEM_SCHEME`；二者皆空则拒绝启动 |
| 文档库根 | `--docs <root>`，缺省读环境变量 `CORE_SYSTEM_DOCS`；为空则对象读面不挂载（`/v1/objects/*` → 503），scheme 面不受影响；给定即打开 repository git 后端（串行写队列+resourceVersion 乐观锁，本进程仅读暴露） |
| 监听地址 | `--addr <host:port>`，缺省读 `CORE_SYSTEM_ADDR`，再缺省 `127.0.0.1:0`（回环随机端口，避免多宿主进程端口冲突） |
| 启动自检 | scheme 载入校验（必填项/唯一性/storage 模板）失败 → 退出码非 0，桥接方据此判定 |
| 就绪行 | 就绪后向 **stdout** 输出一行 `CORED_READY addr=<host:port> scheme_version=<v> kinds=<n>`（机器可读；解析失败不影响人读日志走 stderr） |
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
- **只读**：非 GET 一律 405。写路径唯一入口是 Apply 管线（concepts/apply.md），本面永不提供写端点。
- 载荷为 JSON；kind 详情保留声明原文（spec/fields/status/relations/未识别字段收敛进 extra），声明演进不破坏查询面。

## 3. plugin↔cored 桥契约（dsh plugin 侧）

```
dsh 宿主（cordis entry id=core-system）
  └─ plugin apply(config)
       ├─ coredBin 定位：config.coredBin → env CORE_SYSTEM_CORED_BIN → PATH 上的 cored
       ├─ spawn cored --scheme <schemePath>          # schemePath：config → env CORE_SYSTEM_SCHEME
       ├─ 解析 stdout 就绪行 → http://<addr>
       ├─ 转发一次查询：GET /v1/scheme + /v1/scheme/kinds
       ├─ 结果挂 ctx.coreSystem = {url, scheme, kinds}，日志留痕
       └─ ctx.effect 注册退场回收（插件卸载 ⇒ cored 子进程 SIGTERM）
```

| config 字段 | 缺省语义 |
|---|---|
| `autoSpawn`（缺省 true） | false 时本宿主不拉起 cored（只读面外置，如共享调试实例） |
| `coredUrl` | 已在运行的 cored 基址；设置则跳过 spawn 直接查询 |
| `schemePath` | 为空且无 `CORE_SYSTEM_SCHEME` 时桥接不启动（warn，不阻断宿主） |
| `coredArgs` | 附加参数透传（如 `["--docs","<文档库根>"]` 挂对象读面；文档库锚点同属部署锚点，不入公开仓） |
| `readyTimeoutMs`（缺省 10000） | 就绪行超时；超时/子进程先退 → 桥接失败日志，宿主继续运行 |

- **部署锚点注入方式**：各 profile 用户 patch 层按行 id（`core-system`）覆写 config（patch 覆写=整行 config 替换，不合并），或经 `CORE_SYSTEM_*` 环境变量；公开仓只保留机制与缺省值。
- **查询失败不阻断宿主**：桥接是探针性质（probe），`kinds=null` 即"本轮未通"，由验收报告如实记录——宿主健康优先于桥接成功。

## 4. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 多宿主进程同时拉 cored 端口冲突 | ✅ 低 | 缺省回环随机端口；就绪行回读实际地址 |
| cored 崩溃连坐 dsh 宿主 | ✅ 低 | 子进程隔离；桥接失败仅留错误日志；后续轮次加看门狗重启 |
| 就绪行协议演进破坏旧桥 | ⚠️ 中 | 行格式前缀 `CORED_READY` + 本文契约锚定；解析宽松（未匹配=未就绪，不误判） |
