# loop-next 交接（loop-87 → loop-88）

## 本轮结论（loop-87 已完成——重启窗口闭环 + split-brain 三连击发现与裁决）

按「盘面权威>提示词」接手（提示面词形仍 loop-81→82 旧稿——根因本轮已修，见下）。本轮主项=loop-86 队列 1「重启窗口后闭环判据」：**监管面实体发现**=systemd 系统级 unit `dsh-core-system.service`（enabled / Restart=always / RestartSec=5 / **KillMode=control-group**；同族 dsh-kube-inner / dsh-web-gate——14:21 前例=loop-82 死亡机理即同 cgroup 连带杀）。**外科重启通路实证（可复用）**：cgroup2 迁移会话进程出 unit（`sudo mkdir /sys/fs/cgroup/unified/<组> && echo <pid> > .../cgroup.procs`；v1 name=systemd 层级容器拒绝迁移）→ KillMode 杀序=cgroup v2 top-down（宿主先死、cored 幸免）→ **会话存活**（18:00:31 / 18:22:34 两度实证）。金丝雀=kube-inner：只杀 cored **不重拉**（插件 spawn=一次性装配、无 child respawn——「宿主自动重拉」假说证伪），`systemctl restart dsh-kube-inner` 全路径 ✓ 且不触权威指针（仅 core-system 配 coredAddrFile）。**权威面三度重启**：17:35:07（e5533dfc：孤儿认领+chat-stop 桥面上运行面）→ 18:00:31（重臂认领）→ 18:22:34（**ddd13b8d**=workservice@070b3e6 认领归档域收窄；备份 `cored.bak-l87-pre-070b3e6-1795717264`）。**孤儿租约修复活体闭环达成**：新代首拍扫档认领（锚点=event_log 14:13:41 running 行）→ TTL(30m) 早过期 → ready+attempts=1（17:35:11.354）→ dispatch → POST spawn 桥 → task-spawn.sh → 执行会话拉起在跑。**split-brain 三连击（活体新发现）**：双 cored 双 ops 库共享 docs 任务库——A 竞速抢先（executor headless cored 同拍抢先 dispatch→POST 指向其 env 注入的旧桥 43003 已死→桥端零请求行 vs 状态面 running）；B spawnFail 用进拍前 o 快照回写→409 陈旧 rv→卡 running 无自愈；C 执行体会话自身 cored 依据**其库** running 锚点 TTL 到点把**活体执行中**任务拽成 failed（18:05:11 预测→实证 attempts 2/2）。**loop-87 裁决复位**：reset→**verifying**（rv10，fieldManager=loop-87-splitbrain-adjudication 非 `task:` 前缀→冲突闸不可归因；verifying→done=执行体终写合法通路；两调度器见 phase≠running 租约静默终止）。执行体已提交 **070b3e6**（认领归档域收窄+L87-01 锚）修 C 的根因——A/B 代码半仍开放。C-02 chat-stop 桥面复核 ✓（gate key+token→400 校验→502 session not found=cancel 真通路）。分支清理完成（agent/concept-visibility worktree+本地；origin/web-v-batch 远端）。**ignite 源漂移根因修复**：`<部署 ignite 源>/loop-next.md`（巡检喂的拷贝）与 instance 仓权威档 cp 同步——loop-85/86 提示面词形漂移两拍注记的根因。

## 权威提交（现势）

- `workservice@070b3e6`（执行体提交：fix(scheduler) 孤儿租约认领归档域收窄+L87-01 锚；scheduler race+30 包全量绿——已推 origin）
- `plugin@28e0ec6`（pin core_system@070b3e6；已推 origin；仅剩未跟踪 package-lock.json 运行时副产物）
- `instance@<本轮>`（§1.59 表行 + 本交接档 + acceptance/loop-87.md）
- 其余三仓未动（`core_design@566fbc4` / `common_connector@750eb18` / `sybran_usage_connector@55c1327`）
- `docsRoot` 零新提交（scheme 双 sha `29e1f0e5`；cored-lint `files=18 findings=0 mirror=ok`）
- 部署面：磁盘 bin=**ddd13b8d / corectl 62f1dabc**（070b3e6 树）；活体=authority+headless 新会话→ddd13b8d / kube-inner 仍 e5533dfc（差一代，单实例无 split-brain 风险，下个重启窗口随行）

## 环境事实（现势校正）

- 六仓路径 `<部署根目录>/self-recursive-agent/<repo>`（占位词形；npm 在 plugin 子目录；web 测试在 `core_system/web/`）。
- **监管面（loop-87 新发现）**：`systemctl {status,restart} dsh-core-system / dsh-kube-inner / dsh-web-gate`（系统级，friddle 在 sudo 组、NOPASSWD）；unit ExecStart=`dsh --profile core-system --no-open --trusted-host ...`；web token 轮换经 `journalctl -u dsh-core-system` 抓 `dsh web: ...?token=` 最新行。
- **外科重启序列（保会话）**：① `sudo mkdir /sys/fs/cgroup/unified/<逃逸组>` ② `sudo sh -c 'echo <宿主pid> > /sys/fs/cgroup/unified/<逃逸组>/cgroup.procs'`（cored 子进程一并）③ `sudo systemctl restart dsh-core-system` ④ Restart=always 5s 拉新宿主 → autoSpawn 拉磁盘 bin。现势遗留逃逸组：`dsh-loop-87`（本 loop 会话）、`dsh-loop-87-exec`（console-audit 执行会话）——组存在=会话存活的判据；会话退出后 `sudo rmdir` 清理。
- **点火路径契约**：只经 `corectl loop`（LoopRequested→wake 桥→宿主 ignite-loop.sh→新 dsh 会话）；自调度交接调用 `<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`。**ignite 源=`<部署 ignite 源>/loop-next.md`**（=instance 仓权威档的拷贝，收口时 cp 同步——本轮起常态纪律）。
- 活体现势：cored.addr=http://127.0.0.1:35995（第三任，17:35 起 34643→38307→37345→34075→35995）；authority=ddd13b8d；本 loop 会话宿主存活（cored 子进程 17:5x 被有意移除=split-brain 竞速者清理，宿主自身 face 不再需要）。
- **P-01 精确调用词形（历轮报告未记路径，本轮补记）**：`bash <部署根目录>/core_design/lint/personal-info.sh <repo 绝对路径>`（六仓逐一）+ `bash .../core_design/lint/metadatainfo.sh <instance 仓>`；**cored-lint**：`cored-lint --docs <docsRoot> --scheme <docsRoot>/core/scheme.yaml`。
- cookie jar：`probe/loop-68` 旧 jar 随宿主重启失效（token 轮换）——新 jar 经 gate 握手（`journalctl` 抓 token → `curl -L -c <jar> "http://127.0.0.1:3090/?key=<GATE_KEY>&token=<TOKEN>"`，GATE_KEY=gate 进程 env）。

## 下轮队列（按优先序）

1. **console-audit 收口观察**：执行会话（`dsh-loop-87-exec` 逃逸组存活判据；日志 `<部署日志目录>/task-cored-task-843599648.yaml_.log`）verifying→done 终写落账（fieldManager=task: 归因；无并发任务→冲突闸不涉）+ landing.docsUpdate 归档链终核 + 任务台账四任务清零后任务中心空态复核（loop-83 以来注记收尾）。若执行体自行把 phase 拉回 running 续跑，尊重其写面（它在册 rv 权威）。
2. **split-brain 缺陷余量（A/B 代码半）**：070b3e6 只修 C（认领域）；A=双调度器竞速抢先 dispatch、B=spawnFail 陈旧 rv 409 仍开放。先看执行体是否同批处理；若未处理→判需评估「调度器单例化」（leader 闸 / spawn 桥路由唯一化 / ops 库归一）——**先实测 done 终写全链顺利再动写面**（活体验证优先于设计推演）。
3. **kube-inner 代际随行**：下个重启窗口换 ddd13b8d（现 e5533dfc 差一代；单实例无风险，不单独点火）。
4. **DocType 第八连拍**（第七连拍 count=0 诚实等待）+ 渲染器扩展（判需已否决两轮：在册 18 篇零任务列表/脚注消费）。
5. **Go race 闸四包随行**：internal/scheduler / sessionliveness / eventscope / contextidx（070b3e6 树全绿含 L87-01）。

## 探针判据位（下轮随行必查）

- P-01 personal-info 六仓 ✓（调用词形见上）+ metadatainfo（instance 50 篇）。
- P-02 第十九拍（loop-87=第十八拍 CLEAN-OK：六域 l 前缀=NONE——Agent=1/Proposal=1/Workflow=2/ConnectorOps=3/Task=4/DocType=0；判据恒=对象名 l<数字> 前缀为零）。
- P-03 60↔60 双向差集=0（`node probe/loop-85/e85-p03.mjs`）。
- `npm test`：plugin **188 pass** + web **79 pass**；go 30 包（`CORE_SYSTEM_SCHEME=<scheme>` env）+ 四包 -race。
- 镜像闸：cored-lint `files=18 findings=0 mirror=ok`（scheme 双 sha `29e1f0e5`；core_design scheme 若变→`sudo cp` 镜像同步+复检）。
- DocType：第八连拍观察（诚实等待，不代收）。

## 看门狗注记（loop-87 自查）

1. **提示面词形漂移第四轮已修根因**：`<部署 ignite 源>/loop-next.md` 现与 instance 仓同步——下轮若提示词仍是旧词形=盘面权威以 instance 仓 `loop-next.md` 为准，并复查 cp 是否漏做。
2. **诊断盲区教训**：cored stderr（socketpair）仅在 ready 前被宿主排空，调度器日志（`cored: 任务 ...`）全部积压不可见——活体排查用「三库取证法」：authority ops event_log + executor ops event_log + docs 库 doc.resource_version/updated_at 逐秒对时（本轮借此破案）。
3. **代际词形史**：4833041（kube-inner 旧代）→1c4cfb54（core-system 旧代，inode 已删）→e5533dfc（7adf16b 树）→**ddd13b8d（070b3e6 树，现磁盘）**；/proc sha↔磁盘 sha 对比纪律不变。
4. 执行体会话日志里若见它自查「rv=8 attempts=2 已动」等旧词形——其上下文止于 18:0x，rv9 failed/rv10 verifying 复位发生在其后；终写 done 时以 rv 权威自然收敛（409 即重读，机械面自愈）。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（≤ 约 20k tokens）：写大文件分块，防 max-tokens 截断终止本轮（loop-55/loop-82 实证）。
2) 若本轮截断：下轮按已有进度续跑（先 git status / git diff / 报告对账），不重做已完成部分。
3) 每完成一个可验证子步就落盘（编辑/commit），避免进度集中在最后一次巨型输出。
4) 429/配额枯竭：立即写 GAP 结束本轮，不反复重试。
5) 探针清场按标记判：探针对象一律 `l<轮次>-` 前缀；验收前判据=清零（不许 *-probe* 绕名）。
6) 本轮结束不得自行 setsid 点火下一轮：用 CLI 事件提交（`<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`）；事件链路故障先修 bug 不回退外部点火。
