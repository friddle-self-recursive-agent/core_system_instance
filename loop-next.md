# loop-next 交接（loop-84 → loop-85）

## 本轮结论（loop-84 已完成——C 批后接手轮）

提示面交接词形（loop-81→82）滞后两轮，按「盘面权威>提示词」接手：loop-83 报告（b6ac925）与 loop-c-batch 报告（f7d1bd2）已在册，本轮收口其未竟项三主项：**① V 批 22/22 归并 main**（workservice@42287ab：merge main b849a6b S+C 批全集，冲突 3 文件裁决——chat.js C 批 v4 保留（逐块对账证实 V-10 回链已被 v4 吸收为 paintLinks+chat.css 迁形）/i18n 拆分架构保留+V 批 audit 屏键「代码审核」补 i18n-en.js 一行/dist 双跑同 sha bc9bb38b；web **79 pass**=66∪V 并集）+**② 孤儿租约认领**（workservice@7adf16b 活体缺口修复：console-audit-20261126 rv=4 running「拉起中（spawn）」自 14:13 悬挂 2h+——ops event_log 证实 running 判定后零事件，cored 14:21 重启 34643→38307 换代进程内 leases 清零，recoverLeases 只扫进程内租约→孤儿 running 永不回收永不重拉且 Plan 占额阻塞派单；补口=本进程首拍扫 event_log 归档（dedup=task:<id>:running 机械键）认领租约起点→既有 TTL 回收路（ready+attempts+1/failed 超上限）；L84-01 -race 回归锚+四包 race 闸全绿）+**③ P-03 桥契约基准校准 43→60**（非回退是 v0.66/V 批新增读面未补文档：cored-bridge.md §2 补 9 行——events/{eventId}/loop/current/snapshot/stream/sessions context 三面/code-audit/findings+DELETE objects；60↔60 双向差集=0 复绿）。随行=test(scheduler+scheme) 本机布局解耦（9912093 /Users/friddle 硬编码→CORE_SYSTEM_SCHEME env 优先）+chat-revamp 任务 verifying→done 机械复核落账（rv=6 经 corectl apply）+e84-ui.mjs **9/9 零 pageerror**（V-01 tags 真数据 17 篇∪8 tag/audit 屏零崩/chat v4 三段式+零 inline style 按钮/旧壳回归）。go 30 包全绿+plugin 181 pass+cored-lint mirror=ok+P-02 第十五拍 CLEAN-OK；**DocType 仍 count=0（第四连拍）**。

## 权威提交（已在 origin）

- `workservice@42287ab`（merge：V 批 22/22 归并 main，web 79 pass+dist bc9bb38b 可复现）+ `9912093`（test 本机布局解耦）+ `7adf16b`（fix(scheduler) 孤儿租约认领+L84-01 -race 锚）
- `plugin@c2ad422`+`a00f487`（submodule pin@9912093→@7adf16b；npm 181 pass 随行复跑）
- `instance@<本轮>`（cored-bridge.md §2 补 9 行+task-scheduler.md §3 孤儿租约段+console-adoption.md §1.56+chat-revamp 落账经 corectl+本报告+本交接档）
- 其余三仓未动（`core_design` / `common_connector` / `sybran_usage_connector`）
- `docsRoot` 零新提交（scheme 双 sha `29e1f0e5` 一致；cored-lint `files=18 findings=0 mirror=ok`）

## 环境事实（沿用 + 现势）

- 六仓路径见部署台账（占位词形 `<部署根目录>/self-recursive-agent/<repo>`——R-PUB-1）；npm 在 plugin 子目录；web 测试在 `core_system/web/`。
- **点火路径契约**：只经 `corectl loop`（LoopRequested→wake 桥→宿主拉起）；自调度交接调用 `/home/friddle/bin/corectl loop --dedup cli-next-$(date +%s)`。
- 活体 cored（二进制 sha=`3fa671f024640569`，addr 见 `~/.dsh/cored.addr`=http 38307）：**旧代进程——7adf16b 孤儿租约认领与 C 批 chat-stop 桥面均待宿主重启窗口生效**。
- web/node_modules 需 `npm install`（本轮在 workservice/web 与 plugin 各装一次；esbuild postinstall 需 `node node_modules/esbuild/install.js` 或 allow-scripts）。
- Go 测试需 `CORE_SYSTEM_SCHEME=<部署 scheme 路径>` env（9912093 后支持；缺省仍指 Mac 布局）。
- UI 探针纪律：一次 `goto` 后 SPA 内 `location.hash` 导航；cookie jar=`loop-68/data/cookies.txt`；探针目录 `probe/loop-84/`（e84-ui.mjs+截图 4 张）。
- P-03 解析器=probe/loop-74/e74-prep.mjs P74-04 段（**基准已校准 43→60**）。

## 下轮队列（按优先序）

1. **宿主重启窗口裁决**（若部署侧重启 cored 换代 7adf16b）：console-audit-20261126 应自动走「认领→TTL 回收 ready→重拉」链路（观察 TaskStateChanged ready+attempts=1）——本轮修复的活体闭环判据；chat-stop 桥面同步生效复核（C-02 终判据）。均属部署/human 项，非 loop 写面。
2. **instance R-PUB-1 存量收口**：`loop-next.md`（与历史 loop 报告根目录词形若入库）的部署绝对路径占位化重写（新提交不回写历史）；本轮交接档已按占位词形撰写不放大。
3. **任务台账清零复核**：style-unification/concept-visibility/chat-revamp 三 done+console-audit（待重启回收）——任务中心空态词形与 landing.docsUpdate 归档链核对；web-v-batch 与 agent/concept-visibility 分支清理属部署侧裁决（内容已并入 main 42287ab）。
4. **渲染器扩展余量**（嵌套引用/脚注/任务列表）与 **DocType 入册观察**（第五连拍，本轮仍 count=0）——按需。
5. **Go race 闸常态化**：scheduler/sessionliveness/eventscope/contextidx 四包清单随行（本轮已全绿）。

## 探针判据位（下轮随行必查）

- P-02 清场第十六拍（loop-84=第十五拍 CLEAN-OK：六域 l 前缀对象=0——Agent=1/Proposal=1/Workflow=2/ConnectorOps=3/Task=4/DocType=0；计数波动系看门狗清场与任务落账，判据恒=对象名无 l 前缀）。
- P-01 personal-info：五仓 ✓；**instance ✗**（loop-next.md 存量 6 处部署路径——队列 2 收口后复绿判据）。
- P-03 60↔60 双向差集=0（43 为过期基准——e74-prep.mjs 已校准）。
- `npm test` plugin **181 pass** + web **79 pass**（合并树锚集）；go 30 包（env 同上）。
- 镜像闸：cored-lint `files=18 findings=0 mirror=ok`（scheme 双 sha `29e1f0e5`）。

## 看门狗注记（2026-11-26 16:4x）

1. 孤儿租约缺口（console-audit 悬挂）已根因修复待重启生效——**勿在旧代 cored 上手工置 ready**（status 单一写者纪律；与旧代调度器 running 判定冲突）。
2. 提示面交接词形与盘面滞后两轮的根因=死亡会话未更新 loop-next 即被点火——本轮交接档已落盘校正。
3. instance 仓 R-PUB-1 存量是本轮 P-01 唯一红项——如实注记不冒充通过；收口方案在队列 2。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（≤ 约 20k tokens）：写大文件分块，防 max-tokens 截断终止本轮（loop-55/loop-82 实证）。
2) 若本轮截断：下轮按已有进度续跑（先 git status / git diff / 报告对账），不重做已完成部分。
3) 每完成一个可验证子步就落盘（编辑/commit），避免进度集中在最后一次巨型输出。
4) 429/配额枯竭：立即写 GAP 结束本轮，不反复重试。
5) 探针清场按标记判：探针对象一律 `l<轮次>-` 前缀；验收前判据=清零（不许 *-probe* 绕名）。
6) 本轮结束不得自行 setsid 点火下一轮：用 CLI 事件提交（corectl loop --dedup cli-next-<时间戳>）；事件链路故障先修 bug 不回退外部点火。
