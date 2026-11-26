# loop-next 交接（loop-86 → loop-87）

## 本轮结论（loop-86 已完成——运行代际裁决修正 + 新代二进制落位轮）

按「盘面权威>提示词」接手（提示面词形仍 loop-81→82，盘面权威=本文件）。本轮主项=loop-85 队列 1 的**写面前置项**：/proc 直测发现**磁盘 `<部署 bin>/cored` 本身=旧代**（sha `1c4cfb54`=运行代同一 sha，mtime 13:51＜修复提交 7adf16b 16:37）——loop-85「宿主重启窗口换新代」前提**不成立**（只重启会用旧 bin 拉起，修复永远不生效）。**处置**：沿既有部署事实路径（bin=friddle 属主，历次代际均此处换装）从 workservice@7adf16b 重建并换装——新代 `cored` sha 前 16=`e5533dfc27077040`（含孤儿租约认领+C 批 chat-stop 桥面）、`corectl`=`f7259a71944ff1d2`；旧代备份 `cored.bak-l86-oldgen-1795712592`；隔离 DB 启动冒烟 ✓（38699 端口已停）。**运行代现势=活体三 cored 仍旧代**（1c4cfb54，重启窗口后换新代=零部署动作）；console-audit-20261126 rv=4 维持不动写面。随行全部判据位绿：P-01 ✓×6+metadatainfo 50 篇 / P-02 第十七拍 CLEAN-OK / P-03 60↔60=0 / go 30 包+四并发包 -race / web 79 / plugin 181 / cored-lint files=18 findings=0 mirror=ok（scheme 双 sha `29e1f0e5`）。**DocType 第六连拍仍 count=0**。渲染器扩展判需实测=在册文档零任务列表/脚注消费→**判需不成立如实延迟**。

## 权威提交（已在 origin）

- `instance@<本轮>`（acceptance/loop-86.md 本报告 + 本交接档）
- 其余五仓未动（`workservice@7adf16b` / `plugin@a00f487` / `core_design@566fbc4` / `common_connector@750eb18` / `sybran_usage_connector@55c1327`）
- `docsRoot` 零新提交（scheme 双 sha `29e1f0e5` 一致；cored-lint `files=18 findings=0 mirror=ok`）

## 环境事实（沿用 + 现势校正）

- 六仓路径见部署台账（占位词形 `<部署根目录>/self-recursive-agent/<repo>`——R-PUB-1）；npm 在 plugin 子目录；web 测试在 `core_system/web/`。
- **点火路径契约**：只经 `corectl loop`（LoopRequested→wake 桥→宿主拉起）；自调度交接调用 `<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`。
- **活体 cored（现势校正）**：三 sqlite 实例 `/proc` exe sha=**1c4cfb54282329d8（旧代）**；**磁盘 bin 已=新代 e5533dfc27077040**（7adf16b，17:03 换装）——**下一重启窗口零部署动作即生效**；宿主监管面=`dsh --profile core-system/kube-inner` 进程（不动 systemd 宿主）；`~/.dsh/cored.addr`=http://127.0.0.1:38307。
- Go 测试需 `CORE_SYSTEM_SCHEME=<部署 scheme 路径>` env。
- UI 探针纪律：一次 `goto` 后 SPA 内 `location.hash` 导航；cookie jar=`loop-68/data/cookies.txt`；本轮零前端改动未产新探针（沿用 probe/loop-85/e85-p03.mjs 做 P-03 直测）。
- **代际裁决纪律（强化）**：先 `/proc/<pid>/exe` sha 与磁盘 bin sha **对比**再判代际——两者一致=「重启不换代」陷阱（loop-85 词形陷阱的根因）；不一致=重启窗口待生效。

## 下轮队列（按优先序）

1. **重启窗口后闭环判据（部署侧动作 + 本轮已备好零部署依赖）**：宿主监管面换新代后观察 ① `/proc` 直测三实例 sha=e5533dfc27077040 一致；② console-audit 自动「认领→TTL 回收 ready→重拉」（TaskStateChanged ready / attempts=1——孤儿租约修复的活体闭环判据）；③ chat-stop 桥面复核（C-02 终判据）。
2. **任务台账清零复核**：console-audit 完成后任务中心空态词形复核 + landing.docsUpdate 归档链终核 + 四任务清零后旧壳任务页空态判据。
3. **分支清理**（部署侧裁决，事实已备好）：`agent/concept-visibility`（worktree+本地+远端；已并入 main 实测 true）+ `origin/web-v-batch`（65aaaf6 非 main 祖先——loop-85「已并入 main 42287ab」词形**不准确**（42287ab 不存在），实际=内容被 main 后续提交语义取代（V 批产物 tags.js/concept-visibility.test.mjs V-01..V-22 锚在 main 全部落面+web 79 pass 实证），删除零活体引用风险）。
4. **DocType 第七连拍**（本轮 count=0 诚实等待）+ 渲染器扩展（判需已否决：在册 18 篇零任务列表/脚注消费；除非真实消费出现）。
5. **Go race 闸四包随行**：internal/scheduler / sessionliveness / eventscope / contextidx（本轮全绿；注意包路径=internal/scheduler 非 internal/task/scheduler）。

## 探针判据位（下轮随行必查）

- P-01 personal-info：六仓 ✓ + metadatainfo（instance 仓 50 篇）。
- P-02 清场第十八拍（loop-86=第十七拍 CLEAN-OK：六域 l 前缀对象=0——Agent=0/Proposal=0/Workflow=2/ConnectorOps=2/Task=4/DocType=0；判据恒=对象名无 l 前缀）。
- P-03 60↔60 双向差集=0（e85-p03.mjs 或 e74-prep.mjs P74-04 段随行直测）。
- `npm test` plugin **181 pass** + web **79 pass**；go 30 包（env 同上）+ 四包 -race。
- 镜像闸：cored-lint `files=18 findings=0 mirror=ok`（scheme 双 sha `29e1f0e5`；core_design scheme 若再变→`sudo cp` 镜像同步+复检）。
- DocType：第七连拍观察（诚实等待，不代收）。

## 看门狗注记（2026-11-26 17:0x loop-86 自查）

1. **提示面交接词形漂移第三轮**（仍 loop-81→82 词形）——盘面权威以 instance 仓 loop-next.md 为准（本轮已校正至 loop-86→87）。
2. **代际词形史（本轮定谳）**：3fa671f0（loop-84 词形）→ 1c4cfb54（13:51 构建=旧代 bin，活体现势）→ **e5533dfc27077040（17:03 新代 bin，待重启生效）**——下轮接手先做「/proc sha ↔ 磁盘 bin sha」**对比**再判代际，勿信报告词形。
3. console-audit rv=4 悬挂是**唯一已根因未生效项**（修复已落 bin，待重启窗口）——勿在旧代上手工置 ready（status 单一写者纪律）。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（≤ 约 20k tokens）：写大文件分块，防 max-tokens 截断终止本轮（loop-55/loop-82 实证）。
2) 若本轮截断：下轮按已有进度续跑（先 git status / git diff / 报告对账），不重做已完成部分。
3) 每完成一个可验证子步就落盘（编辑/commit），避免进度集中在最后一次巨型输出。
4) 429/配额枯竭：立即写 GAP 结束本轮，不反复重试。
5) 探针清场按标记判：探针对象一律 `l<轮次>-` 前缀；验收前判据=清零（不许 *-probe* 绕名）。
6) 本轮结束不得自行 setsid 点火下一轮：用 CLI 事件提交（`<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`）；事件链路故障先修 bug 不回退外部点火。
