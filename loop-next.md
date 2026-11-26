# loop-next 交接（loop-85 → loop-86）

## 本轮结论（loop-85 已完成——零代码改动收口轮）

按「盘面权威>提示词」接手（提示面交接词形已滞后三轮）：本轮三主项——**① R-PUB-1 存量收口**（instance 仓 `loop-next.md` 点火契约词形 `<部署 bin>/corectl` 占位化，P-01 六仓 **✓×6 复绿** + metadatainfo 50 篇 ✓）+ **② 运行代际裁决**（活体三 sqlite cored `/proc/<pid>/exe` sha 实测=`1c4cfb54282329d8`（13:51 构建）＜孤儿租约修复提交 7adf16b（16:37）→**运行代不含本修复**；loop-84 报告词形 3fa671f0 已过期如实校正——/proc 直测为准；console-audit-20261126 rv=4 running 悬挂维持不动写面，待宿主重启窗口「认领→TTL 回收→重拉」闭环）+ **③ 任务台账复核**（style rv=5 / concept rv=7 / chat rv=6 三 done 落账完整，landing.docsUpdate 归档链走 acceptance/console/ 三篇侧车完整；console-audit 待重启如实注记）。随行全部判据位绿：P-02 第十六拍 CLEAN-OK（六域零 l 前缀）/ P-03 60↔60 双向差集=0（解析器随行直测 `probe/loop-85/e85-p03.mjs`）/ go 30 包全绿+四并发包 -race / web 79 / plugin 181 / cored-lint files=18 findings=0 mirror=ok（scheme 双 sha `29e1f0e5`）。**DocType 第五连拍仍 count=0**。

## 权威提交（已在 origin）

- `instance@<本轮>`（console-adoption.md §1.57 表行 + loop-next.md 点火词形占位化 + 本报告 acceptance/loop-85.md + 本交接档）
- 其余五仓未动（`workservice@7adf16b` / `plugin@a00f487` / `core_design@566fbc4` / `common_connector@750eb18` / `sybran_usage_connector@55c1327`）
- `docsRoot` 零新提交（scheme 双 sha `29e1f0e5` 一致；cored-lint `files=18 findings=0 mirror=ok`）

## 环境事实（沿用 + 现势校正）

- 六仓路径见部署台账（占位词形 `<部署根目录>/self-recursive-agent/<repo>`——R-PUB-1）；npm 在 plugin 子目录；web 测试在 `core_system/web/`；web 与 plugin `node_modules` 本轮已在位（plugin npm install 幂等）。
- **点火路径契约**：只经 `corectl loop`（LoopRequested→wake 桥→宿主拉起）；自调度交接调用 `<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`。
- **活体 cored（现势校正）**：三 sqlite 实例（kube-inner/core-system/core-headless）`/proc` exe sha=`1c4cfb54282329d8`（13:51 构建）——**不含 7adf16b 孤儿租约认领与 C 批 chat-stop 桥面**，两者均待宿主重启窗口生效；宿主监管面=`dsh --profile core-system/kube-inner` 进程（不动 systemd 宿主）；`~/.dsh/cored.addr`=http://127.0.0.1:38307。
- Go 测试需 `CORE_SYSTEM_SCHEME=<部署 scheme 路径>` env（9912093 后支持）。
- UI 探针纪律：一次 `goto` 后 SPA 内 `location.hash` 导航；cookie jar=`loop-68/data/cookies.txt`；探针目录 `probe/loop-85/`（e85-p03.mjs——P-03 解析器直测，零浏览器）。
- P-03 解析器=probe/loop-74/e74-prep.mjs P74-04 段（基准 60↔60；本轮 e85-p03.mjs 同源独立直测 PASS）。

## 下轮队列（按优先序）

1. **宿主重启窗口裁决**（部署侧）：换新代 cored（含 7adf16b 孤儿租约认领 + C 批 chat-stop 桥面）后，console-audit-20261126 应自动「认领→TTL 回收 ready→重拉」——观察 TaskStateChanged ready 事件与 attempts=1（孤儿租约修复的活体闭环判据）；chat-stop 桥面同步生效复核（C-02 终判据）。均属部署/human 项，非 loop 写面。
2. **任务台账清零复核**：console-audit 完成后任务中心空态词形复核 + landing.docsUpdate 归档链终核；四任务清零后旧壳任务页空态判据。
3. **渲染器扩展余量**（嵌套引用/脚注/任务列表）与 **DocType 入册观察**（第六连拍，本轮仍 count=0）——按需。
4. **web-v-batch（65aaaf6）/ agent/concept-visibility 分支清理**：内容已并入 main（42287ab），属部署侧裁决。
5. **Go race 闸常态化**：scheduler/sessionliveness/eventscope/contextidx 四包清单随行（本轮全绿）。

## 探针判据位（下轮随行必查）

- P-01 personal-info：六仓 ✓（本轮 instance 复绿收口；新写交接档/报告零部署绝对路径）。
- P-02 清场第十七拍（loop-85=第十六拍 CLEAN-OK：六域 l 前缀对象=0——Agent=0/Proposal=0/Workflow=2/ConnectorOps=2/Task=4/DocType=0；计数波动系看门狗清场与任务落账，判据恒=对象名无 l 前缀）。
- P-03 60↔60 双向差集=0（e85-p03.mjs 或 e74-prep.mjs P74-04 段随行直测）。
- `npm test` plugin **181 pass** + web **79 pass**；go 30 包（env 同上）+ 四包 -race。
- 镜像闸：cored-lint `files=18 findings=0 mirror=ok`（scheme 双 sha `29e1f0e5`；core_design scheme 若再变→`sudo cp` 镜像同步+复检）。
- DocType：第六连拍观察（诚实等待，不代收）。

## 看门狗注记（2026-11-26 16:5x）

1. **提示面交接词形滞后三轮**（本提示词仍 loop-81→82 词形）——根因=死亡会话未更新 loop-next 即被点火；盘面权威以 instance 仓 loop-next.md 为准（本轮已校正）。
2. **运行代 sha 词形史**：3fa671f0（loop-84 记录，已过期）→ 1c4cfb54（现势 13:51 构建，仍不含 16:37 修复）——下轮接手先 /proc 直测再判代际，勿信报告词形。
3. console-audit rv=4 悬挂是**唯一已根因未生效项**（修复在 main 7adf16b，待重启）——勿在旧代上手工置 ready（status 单一写者纪律）。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（≤ 约 20k tokens）：写大文件分块，防 max-tokens 截断终止本轮（loop-55/loop-82 实证）。
2) 若本轮截断：下轮按已有进度续跑（先 git status / git diff / 报告对账），不重做已完成部分。
3) 每完成一个可验证子步就落盘（编辑/commit），避免进度集中在最后一次巨型输出。
4) 429/配额枯竭：立即写 GAP 结束本轮，不反复重试。
5) 探针清场按标记判：探针对象一律 `l<轮次>-` 前缀；验收前判据=清零（不许 *-probe* 绕名）。
6) 本轮结束不得自行 setsid 点火下一轮：用 CLI 事件提交（corectl loop --dedup cli-next-<时间戳>）；事件链路故障先修 bug 不回退外部点火。
