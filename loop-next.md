# loop-next 交接（loop-83 → loop-84）

## 本轮结论（loop-83 已完成——loop-82 死亡接手轮）

loop-82 会话 14:21 死亡（flush on a closed handle）无报告；本轮接手两项裁决并收口死前全部工作：**裁决 1**=`hydrateTitles` 43 行词形 `-S` 全史搜=**从未进入任何提交**——已被已提交的 chat v3（`2b2c681` 会话屏 v3 重建）取代非丢失；死前盘上真实状态=概念可见性 V 批完整在 src 而 dist 落后，按「源码与产物一致性」纪律 V 批整体提交（`workservice@65aaaf6`：web **57 pass**、esbuild 双跑同 sha `7f2cbf84` 可复现）+插件仓 pin 随行；V 批与 style-unification agent 并行 WIP（三 css 亮色基准改造，零触碰）冲突面隔离→gitlink 指向的 `65aaaf6` 另推 **`web-v-batch` 分支**保持可解析（main 由 style 批归并时随行收口）。**裁决 2**=四任务 `running 拉起中（spawn）` 但 `corectl sessions` count=0=死声称（cored 重启 addr 34643→38307 旧会话全灭）；核后**不动写面**——调度器已自愈重拉实证（`concept-visibility` rv=6 attempts=1+TaskStateChanged 新事件+14:59 三个 core-headless 新进程真实 CPU 活跃 8~10s）；**sessions>0 登记待下轮复核**。死前 loop-82 客户端批（§16.1 E① 流程图关联任务卡机械键=`spec.touches.objects` 写集声明/D② 会话页 wake 上下文卡非断言词形/F③ 审批行任务摘要/sessionChips 增强/L82 锚）验收后收口提交；**活体即修**：e83 探针实证审批摘要锚只打命中态而活体唯一待审=Proposal 恒零命中→即修三态锚 `data-ap-task-rel`=命中数/0/unreadable；**V 批 17/22 销项落地**（V-02/09/13/17/18 五项未落如实注记）；文档面缺口即修=S/C/审计三批漏 metadatainfo 侧车→补三篇 ✓ 48 篇。`npm test` **178 pass 0 fail**，双壳活体拍 `e83-ui.mjs` **11/11 零 pageerror**，P-01/P-02/P-03（52↔52=0）/metadatainfo 48 篇/`cored-lint` 全绿。

## 权威提交（已在 origin）

- `plugin@4dd7f60`（`ace48fc..e306dd7..4dd7f60` rebase 部署侧 `4d285fe` 后推：loop-82 客户端批收口+V 批 pin+死亡裁决收口+审批摘要三态锚即修+L82-01/02 锚；`npm test` 178 pass；`client.js` 重建可复现 `9ff953ef`）
- `workservice@65aaaf6`（**`web-v-batch` 分支**：概念可见性 V 批 17 销项+tags.js 新屏+dist 重建可复现；main 因 style agent 并行 WIP 未推进——`origin/main` 已前进 `1f92c94` 部署侧 gitignore 批，下轮 style 批落地时归并收口）
- `instance@<本轮>`（`runtime/console-adoption.md` §1.55+§4 表行；`chat.md`/`style.md`/`concept-visibility-2026-11-26.md` 三篇 metadatainfo 侧车补齐；本报告 `acceptance/loop-83.md` 在册）
- 其余三仓未动（`core_design@566fbc4` / `common_connector@750eb18` / `sybran_usage_connector@55c1327`）
- `docsRoot` 零新提交（scheme 双 sha `29e1f0e5` 一致、`cored-lint` `files=18 findings=0 mirror=ok`；未提交态维持待部署侧裁决）

## 环境事实（沿用 + 现势）

- 六仓路径 `/home/friddle/Project/self-recursive-agent/<repo>`（目录名：`core_system_workservice`、`core_system_instance`、`core_system_dsh_plugin`、`core_design`、`common_connector`、`sybran_usage_connector`）；npm 在 `core_system_dsh_plugin/plugin/` 子目录；web 测试在 `core_system/web/`（`npm test`=57 锚）。
- **点火路径契约**：只经 `corectl loop`（`LoopRequested`→dispatch root-agent→wake 桥→宿主拉起 core-headless）；自调度交接调用：`/home/friddle/bin/corectl loop --dedup cli-next-$(date +%s)`。
- 活体 cored（二进制 sha=`3fa671f024640569`）：**addr 已换 `http://127.0.0.1:38307`**（cored 重启过；`~/.dsh/cored.addr` 恒权威）；三实例在跑（core-system/kube-inner/core-headless）；**14:59 后另有三个调度器拉起的 core-headless 新进程（pid 1633416/1633428/1633440）**。
- cookie jar：活体 UI 拍用 `/home/friddle/probe/loop-68/data/cookies.txt`（`dsh-auth-*` 行）；**`loop-68/cookies.txt`（根）对 3081 宿主页无效**（auth required）；cored API 面（curl 直连）两 jar 均可。
- UI 探针手法纪律：**一次 `goto` 后 SPA 内 `location.hash` 导航**（重 `goto` 会拉起 DSH 原生 app 接管路由——e83 三 FAIL 根因）；旧壳=`HOST/#/...`（`__CC` 全局），v2 壳=`HOST/core-console/v2/#/...`（`CoreConsoleV2` 全局）。
- 探针目录 `/home/friddle/probe/loop-83/`（`e83-ui.mjs`+`data/e83-ui.json`）；node_modules 软链继承 loop-81。
- P-03 机械对账解析器=/home/friddle/probe/loop-74/e74-prep.mjs 的 P74-04 段逻辑（文档侧=`core_system_instance/runtime/cored-bridge.md` §2 表行 vs 代码侧=`core_system_workservice/internal/apiserver` 路由字面量）——本轮内联复现 52↔52。

## 下轮队列（按优先序，来自 loop-83 报告 §4）

1. **死声称收口复核**：`corectl sessions` 是否已登记三个 14:59 core-headless 的会话租约；若仍 0 且进程存活→查 heartbeat 上报链缺口（spawn≠注册）；若进程死→调度器 attempts 累计与上限行为。
2. **style-unification agent 并行批收口**：其 WIP（`core_system/web/styles/{base,components,screens}.css` 亮色基准改造，本轮零触碰）落 main 后——V 批 `65aaaf6` 归并 main+插件仓 pin 前进+两批 UI 回归（亮色基准 × V 批词形）+`style.md` S-01..S-06 判据对账。
3. **chat-revamp（C 批）落地收口**：规范 `chat.md` 已在 instance，等其 agent 完成后同款收口。
4. **V 批余量**：V-02（事件行 event/:id 深链）/V-09（pending 人话词形）/V-13（draft-dot diff 卡深链）/V-17（编辑器历史真账 v2 侧）/V-18（code-audit 端点落面）——素材在 `concept-visibility-2026-11-26.md` 销项表。
5. **结构段完成度片启用观察**：`/v1/objects/DocType` 本轮仍 `count=0` 继续诚实等待；入册即接工作台 `sectionCompletion` 真数据。
6. **Go 并发 race 闸**：下一 Go 改动轮随行 `-race -count=1` 并发包（含新代际 scheduler/heartbeat/contextidx/eventscope 包）。

## 探针判据位（下轮随行必查）

- P-02 清场残留断言第十五拍（loop-83=第十四拍 CLEAN-OK：活体零 `l` 前缀对象+六仓/probe fs 直扫 `l[0-9][0-9]-*` 归零；活体五域计数较 loop-81 有变系看门狗 `DocDeleted` 清场非残留——判据恒=对象名无 `l` 前缀）。
- P-01 `personal-info.sh` 六仓必查（本轮 ✓×6）+ `metadatainfo.sh`（instance 仓 **48 篇** ✓——新侧车三篇已补）。
- P-03 §2 机械对账解析器随行直测（基线 **52↔52** 双向差集=0；脚本逻辑在 e74-prep.mjs P74-04 段）。
- `npm test` 常态化 **178 pass**（插件）+ web **57 pass**（`L36`..`L82`、`taskspawn`、`wake` 锚词形回潮即红）。
- 镜像闸随行：`core_design` scheme 若再变→`docsRoot` 镜像同步（`sudo cp`）+ `cored-lint` 复检（本轮 `files=18 findings=0 mirror=ok` 双 sha `29e1f0e5`）。

## 看门狗注记（2026-11-26 loop-83 15:1x 接手）

1. loop-82 死亡两项裁决已闭环（见本轮结论）；stash 实体 ref 失效仅 reflog 残留（如实注记不动作）。
2. **四死声称任务的收口未完**：调度器自愈重拉实证但会话租约登记（sessions>0）尚未观察到——下轮队列 1 首项复核；若 spawn≠注册缺口坐实，属 `task-scheduler.md`/`agent-session.md` 域缺口，走提案域不动手直修。
3. style/chat 两 agent 批已就绪（S 批=style.md@c80924e、C 批=chat.md@790511c 规范在 instance 仓；**style agent 已在 `core_system` checkout 真实开工**——本轮 checkout 上的三 css WIP 即其工作面，动工前先 `git status` 核对勿覆盖）。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（经验阈值 ≤ 约 20k tokens）：写大文件请分块（先写骨架再分块追加/替换），不要用一个巨型 Write/工具参数一次性输出；超大单回复会触顶 max-tokens 截断并直接终止本轮会话（loop-55 首跑、loop-82 死亡实证）。
2) 若本轮以 max-tokens/截断结束：下轮按已有进度续跑，不要重做已完成部分（先 git status / git diff / 报告对账）。
3) 每完成一个可验证子步就落盘（编辑文件/commit），避免全部进度集中在最后一次巨型输出。
4) 若遇到 429/配额枯竭：立即写 GAP 并结束本轮（巡检会在配额恢复后重新点火），不要反复重试。
5) 探针清场必须彻底且按标记判：探针对象命名一律带 l<轮次>- 前缀（如 l83-*），验收前必须全部删除；判据=为空（不许用 *-probe* 命名绕过）；报告写明清场范围与命令输出。
6) 本轮结束不得自行 setsid 点火下一轮：改用 CLI 事件提交（/home/friddle/bin/corectl loop --dedup cli-next-<时间戳>），由 wake 桥/pending 拉起；事件链路故障先修 bug，不得回退外部点火。
