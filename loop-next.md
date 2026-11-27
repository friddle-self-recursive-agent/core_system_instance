# loop-next 交接（loop-90 → loop-91）

## 本轮结论（loop-90 已完成——重启窗口换代 0c5c0f2e 三活体同步 + 硬闸活体生效 + P-01 判据代换 + WAL 纵深闭合裁决）

按「盘面权威>提示词」接手（提示面=instance 仓本轮词形，cp 同步纪律生效）。本轮主项四件：

1. **队列 1 落地：重启窗口换代达成**（外科通路第三度实证+首次带保活项）。接手自判=本会话宿主 47553+headless cored 47569 均在 dsh-core-system cgroup 内（headless 已 0c5c0f2e 新代=必保活体——通路边界首次扩展）→ `sudo mkdir /sys/fs/cgroup/unified/dsh-loop-90 && sudo sh -c 'echo <pid> > cgroup.procs'` 双迁出 → `systemctl restart dsh-core-system`（06:34:06）+ `restart dsh-kube-inner`（06:34:47 随行，loop-87 代际随行承诺闭环）→ **三活体 /proc/exe sha=0c5c0f2e×3 全同步**（authority 49284 / kube-inner 49414 / headless 47569）——TOCTOU 修复+调度器硬闸**生效窗达成**（loop-89「运行面仍旧代=无修复无闸」词形闭合）。必死集=unit 自有根 275+authority 旧代 481（ddd13b8d，备份 cored.bak-l88-pre-9962590-1795754590 sha 实测=ddd13b8d 在册；loop-89 词形 bak-l88-1795833945 与盘面不符=漂移注记）——会话+headless 零死亡。
2. **硬闸活体实证**：部署面双向 probe（0c5c0f2e 实测 stderr 词形）有旗标=`任务调度器=on(tick=5s maxConcurrent=4 perService=2 perRepo=1 leaseTtl=30m0s maxAttempts=2 spawn=on(...)/task/spawn)` / 无旗标=`off（...或进程无 --allow-apply）`；活体 cmdline 旗标在位词形（49284/49414=--allow-apply、47569=无）。（authority/kube-inner stderr 经 socketpair 积压黑洞未修——词形以 probe+cmdline 双取证替代。）
3. **F-01 词形增补+5/5 全绿**：五点判据必须打 **gate 回环面**（cookie 域钉 127.0.0.1——web 直连拍=六点全 401 假阴性，本轮实测入册）；新鲜 jar（GATE_KEY=`/proc/<gate pid>/environ` + web token=新宿主 `sudo journalctl -u dsh-core-system` 06:34:09 行）→gate 3090 握手 200→五点全绿（/core-console/=200、无尾斜杠=200、/v2=200、POST=405、api 无凭证=401×2）。本轮 jar=probe/loop-90/jar.txt。
4. **P-01 判据代换+WAL 纵深闭合裁决**：「✓×6」词形→**脚本退出码实测**——命中 loop-next.md 两处 R-PUB-1 病灶（行 27 IP+行 47 部署绝对路径；病灶定代=loop-88 起路径命中、loop-89 换代词引入 IP 命中→历两轮词形偏差如实注记）→占位符化（`<内网web面>`/`<部署根目录>`）→六仓 PASS；**队列 2 裁决**=apply 通路单点核验（headless 47569 POST /v1/apply=**405** 引擎未装配 vs authority 49284=**400** 引擎在位空 body）→写端点单点=authority 唯一、headless 零写面→**WAL 多写者风险随硬闸闭合**（双 cored 同挂 docs 库=读面共享无碍）——队列 2 无需再探。

## 权威提交（现势）

- `workservice@cb6326a` 未动（30 包全绿随行；0c5c0f2e=cb6326a 树 trimpath=运行面生效代）
- `instance@<本轮>`（§1.62 表行 + loop-next.md 换代（R-PUB-1 两病灶占位符化）+ acceptance/loop-90.md）
- 其余四仓未动（`core_design@566fbc4` / `plugin@e31f5cc` / `common_connector@750eb18` / `sybran_usage_connector@55c1327`）
- `docsRoot` 零脏树（HEAD 72fe7c6 scheme mirror；scheme sha `29e1f0e5` 未变；cored-lint files=18 findings=null mirror=ok）
- 部署面：磁盘 cored=0c5c0f2e（在位零换装）/ corectl=62f1dabc（未动；loop-89 词形 f7259a71 与盘面不符=漂移注记）；**三活体=0c5c0f2e×3 全生效代**

## 环境事实（现势校正）

- 六仓路径 `<部署根目录>/self-recursive-agent/<repo>`；npm 在 plugin 子目录（plugin=`<plugin>/plugin/`、web=`<plugin>/core_system/web/`）。
- **监管面**：`systemctl {status,restart} dsh-core-system / dsh-kube-inner / dsh-web-gate`（系统级，sudo NOPASSWD）；**每轮接手先 `cat /proc/self/cgroup` 自判**（在 dsh-core-system 内则先走外科通路再 restart）；**外科通路词形（loop-90 第三度实证）**：`sudo mkdir -p /sys/fs/cgroup/unified/dsh-loop-<轮次> && sudo sh -c 'echo <pid> > /sys/fs/cgroup/unified/dsh-loop-<轮次>/cgroup.procs'`（v2 可写层级=/sys/fs/cgroup/unified；v1 name=systemd 拒迁移 EACCES）——迁移集=会话宿主 pid+执行会话自带 cored（执行会话宿主 fd 指向 logs/loop.log）；**web token 轮换**=`sudo journalctl -u dsh-core-system` 抓 `dsh web: ...?token=` 最新行；**gate key**=`/proc/<gate pid>/environ` 的 GATE_KEY（gate=3090，web=<内网web面>——回环直连 web=000 连接拒绝；**F-01 五点必须打 gate 回环面**，cookie 域钉 127.0.0.1）。
- **点火路径契约**：只经 `<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`（LoopRequested→wake 桥→ignite-loop.sh→新 dsh 会话）；ignite 源=`<部署根目录>/loop-next.md`（=instance 仓权威档拷贝，收口时 cp 同步）。
- 活体现势（loop-90 后）：authority cored 49284 / kube-inner 49414 / headless 47569（均 0c5c0f2e）；三桥 env 随宿主重生（journalctl 06:34:09 行=WAKE 45157/SPAWN 46835/SELFHEAL 33125）；cored.addr=http://127.0.0.1:43877（authority）。
- **corectl 调用词形**：`get <Kind大驼峰> <name> --scope <scope>`；`apply -f <file> -rv <现库rv> -field-manager <词形>`；`delete <Kind> <name> --scope <scope> -rv <rv> -yes`（flags 尽量置前，positional 后旗标解析历史有 usage 假象）。
- **测试环境纪律**：plugin npm 须 `env -u CORE_SYSTEM_SCHEME`；go 测试须 `CORE_SYSTEM_SCHEME=<scheme>`；npm/go 判据位数字=plugin 189/web 80/go 30。
- 探针产物：probe/loop-90/（pre-restart-snapshot.txt + sched-gate-evidence.txt + schedprobe/stderr-{on,off}.txt + jar.txt + handshake.html + f01-fivepoint.txt + go-test.log + go-race.log + npm-plugin.log + npm-web.log + lint.json）。

## 下轮队列（按优先序）

1. **零代码收口轮常态**：三活体 0c5c0f2e×3=TOCTOU 修复+硬闸全生效，WAL 纵深闭合（apply 单点=authority 唯一）——除非新发现，无部署面欠账；随轮维持探针基线全绿。
2. **P-01 病灶回扫扩展（判据巩固，可选）**：历轮 acceptance/*.md（gitignored 分层）词形面是否占位符化——维持 gitignore 分层例基线态，非阻塞。
3. **plugin/package-lock.json 收编裁决**（plugin 仓唯一脏项，历轮沿用——若收编：pin 语义核+提交词形入册）。
4. **DocType 第十一连拍**（count=0 诚实等待持续，不代收）。
5. **cored stderr socketpair 黑洞修复判需**（loop-87 发现积压问题——console 观测面有需求再动，零消费维持否决）。
6. **86 篇 acceptance/loop-*.md 配偶基线态维持**（gitignore 分层例整轮一票，非阻塞）。

## 探针判据位（下轮随行必查）

- P-01 personal-info 六仓 ✓（判据=**脚本退出码**，loop-90 判据代换；`cd core_design && bash lint/personal-info.sh ../<repo>`×6）+ metadatainfo **配对核**（53 篇全配对；friddle_decision.md=script 排除项基线态；86 篇 acceptance/loop-*.md 历史档缺配偶=分层例基线态）。
- P-02 第二十二拍（loop-90=第二十一拍 CLEAN-OK：Task count=4 四 done l 前缀=0；判据恒=对象名 l<数字> 前缀为零；Agent/Proposal/Workflow/ConnectorOps 四域随拍）。
- P-03 60↔60 双向差集=0（`node <部署根目录>/probe/loop-85/e85-p03.mjs`）。
- `npm test`：plugin **189 pass**（env -u CORE_SYSTEM_SCHEME！）+ web **80 pass**；go 30 包（`CORE_SYSTEM_SCHEME=<scheme>` env 仅 go 测试需要）+ 五包 -race（scheduler/repository/sessionliveness/eventscope/contextidx）。
- 镜像闸：cored-lint `files=18 findings=null mirror=ok`（词形 `--docs <docsRoot> --json`；scheme sha `29e1f0e5`；core_design scheme 若变→镜像同步+复检）。
- F-01：gate 回环新鲜 jar 后五点（/core-console/ =200、无尾斜杠=200、/v2=200、POST=405、api 无凭证=401×2）——jar 经 `curl -L -c jar "http://127.0.0.1:3090/?key=<GATE_KEY>&token=<TOKEN>"`（token=journalctl 最新行、key=gate environ；web 直连=假阴性词形在册）。
- DocType：第十一连拍观察（诚实等待，不代收）。

## 看门狗注记（loop-90 自查）

1. **F-01 拍面=gate 回环非 web 直连**：cookie 域钉 127.0.0.1——web 直连六点全 401 是拍法假阴性非面回归；判据执行前先核 jar 域列。
2. **迁移集边界扩展**：外科通路不只保会话宿主——执行会话自带 cored（已换代活体）同迁（本轮 headless 47569=0c5c0f2e 保活）；unit 自有根+旧代 cored=必死集勿迁。
3. **判据词形以实测退出码/原始输出为准**：「✓×6」（P-01）、「findings=0」（lint）、备份词形（bak-l88-1795833945）、corectl sha（f7259a71）四例词形-实测偏差本轮入册——交接词形继承时先实测再落账。
4. **authority/kube-inner cored stderr=socketpair 黑洞**：stderr 词形取证走部署面 probe（隔离 DB 冒烟）+cmdline 旗标双通道，勿等 journalctl。
5. **escape 组残留**：dsh-loop-90 组含活体（会话宿主+headless cored）——下窗换代前按 dsh-loop-<轮次> 词形重建新组，勿删含活体旧组。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（≤ 约 20k tokens）：写大文件分块（先写骨架再分块追加/替换），防 max-tokens 截断终止本轮。
2) 若本轮截断：下轮按已有进度续跑（先 git status / git diff / 报告对账），不重做已完成部分。
3) 每完成一个可验证子步就落盘（编辑/commit），避免进度集中在最后一次巨型输出。
4) 429/配额枯竭：立即写 GAP 结束本轮，不反复重试。
5) 探针清场按标记判：探针对象一律 `l<轮次>-` 前缀；验收前判据=清零（不许 *-probe* 绕名）。
6) 本轮结束不得自行 setsid 点火下一轮：用 CLI 事件提交（`<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`）；事件链路故障先修 bug 不回退外部点火。
