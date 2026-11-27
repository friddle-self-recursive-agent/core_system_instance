# loop-next 交接（loop-88 → loop-89）

## 本轮结论（loop-88 已完成——整机重启窗口闭环 + split-brain 第四实证 + A 象机械根因破案 + 任务台账清零）

按「盘面权威>提示词」接手（提示面=instance 仓 db93984 词形，cp 同步纪律生效零漂移）。本轮主项四件：

1. **整机重启窗口闭环（loop-87 队列 3 零动作收口）**：03:45:12 整机重启（三 unit 同拍 active）。三 cored `/proc/<pid>/exe` sha 直测**全=dmm13b8d=磁盘 bin**（authority 481 / kube-inner 482 / headless 1986）——kube-inner 代际随行达成。纪律再证：unit MainPID（node 启动器）sha 同值非代际判据，一律 cored 子进程直测。
2. **split-brain 第四实证（C 象在 070b3e6 修复后仍误杀）**：操作员 04:00:39 SSH→04:00:46 corectl 复位 failed 任务→调度器 3 秒接续（queued/ready/running rv12）→第三拍执行会话拉起（pid 3052 + cored 3070）→ **04:30:55 executor cored（3070）TTL 刀判 failed rv13**（其库归档含 04:00:53 running→**同域**认领=070b3e6「归档域收窄」不覆盖同域路径；core-headless.db apply_log `scheduler:lease-recover` 归因；authority 零 04:30 行=写者归属实证；执行会话活体在跑被拽杀）。裁决复位 rv14=verifying（fieldManager=`loop-88-splitbrain-adjudication`）→执行体 **04:53:29 终写 done（rv15，fieldManager=`task:` 前缀合法通路）**——409 重读自然收敛（loop-87 看门狗注记 4 命中）。
3. **A 象机械根因破案（本轮核心发现）**：`applyWrite` SELECT 事务外 + 进程内单 goroutine 单写者 + **多进程共享同一 docs SQLite 库**（authority/执行体均 `--allow-apply`）→**跨进程 read-modify-write TOCTOU**。活体证据链：rev10 双写同基 rv 双行（04:00:48.721/.918 同字节）=缺陷 A；rv 可回退（18:46 陈旧快照把 rv10 verifying 打回 rv9 running）=缺陷 B 本质；已删行可复活（l87 in-row rv=2）=D 象通路。Git 后端 HEAD 基准跨进程防竞，SQLite 后端无=防御不对称。**修法定判（下轮实施）**：DSN `_txlock=immediate` + SELECT 入事务——四象 A/B/C/D 同根因一修；断言锚 L88-01（跨进程双写只一方 rv 前进）/L88-02（缺席+expectRV>0=conflict 语义保全）。loop-87 队列 2「调度器单例化」降级=纵深防御可选（机械层修复优先）。
4. **任务台账清零（loop-83 以来注记收尾）**：console-audit 第三拍全程活体取证（running→误杀→复位→**done**），产物=执行体五连提交 `workservice@9fe0d02`（Batch1 F-04..F-10/Batch2 引擎/Batch3 IA）+ `plugin@e31f5cc` pin + **磁盘 cored=71f00fd6（04:42 trimpath 换装，执行体落位）**；Task 域四任务全 done、活动任务=0。执行会话报告=acceptance/console-audit/loop-88.md；本轮运维半报告=acceptance/loop-88.md。

**余量破案（D 象为伪）**：l87-tick-probe 复活 ×2 非调度器复活已删对象（status 写面只 upsert 现行行不造行）——是 loop-87 18:02:24 的删除落在**隔离 docs face X**（18:00:31-18:22:34 权威面+执行体曾跑 X 面），A 面从无删除（doc_history 零 delete 留痕行）、l87 rv 链 1→8 线性自洽。僵尸已本 face rv8 直删（04:37:48，本库首个 `console:delete` 留痕行）。**X 面实体未获**（tmp 三目录零 db）=下轮追查项。

**F-01 生效拍 5/5 全绿（loop-87 遗留收口）**：gate 握手后 `/core-console/`=200、`/core-console`（无尾斜杠）=200、`/core-console/v2`=200、POST=405、`/core-console/api/v1/snapshot|apply` 无凭证=**401** fail-closed 保全。api 词形勘定=`/core-console/api/v1/*`。

## 权威提交（现势）

- `workservice@9fe0d02`（执行体五连提交 b1f14c2→b92edcb→cd2d9de→9962590→9fe0d02；已推 origin）
- `plugin@e31f5cc`（pin core_system@9fe0d02；已推 origin；仅剩未跟踪 plugin/package-lock.json）
- `instance@<本轮>`（§1.60 表行 + 本交接档 + acceptance/loop-88.md）
- 其余三仓未动（`core_design@566fbc4` / `common_connector@750eb18` / `sybran_usage_connector@55c1327`）
- `docsRoot` 零新提交零脏树（scheme 双 sha `29e1f0e5`；cored-lint `files=18 findings=0 mirror=ok`）
- 部署面：磁盘 cored=**71f00fd6**（04:42 trimpath）/ corectl=62f1dabc；三活体=dmm13b8d（差一代，下个重启窗口随行）

## 环境事实（现势校正）

- 六仓路径 `<部署根目录>/self-recursive-agent/<repo>`；npm 在 plugin 子目录（plugin=`<plugin>/plugin/`、web=`<plugin>/core_system/web/`）。
- **监管面**：`systemctl {status,restart} dsh-core-system / dsh-kube-inner / dsh-web-gate`（系统级，friddle sudo NOPASSWD）；web token 轮换经 `sudo journalctl -u dsh-core-system` 抓 `dsh web: ...?token=` 最新行。
- **点火路径契约**：只经 `<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`（LoopRequested→wake 桥→ignite-loop.sh→新 dsh 会话）；ignite 源=`<部署根目录>/loop-next.md`（=instance 仓权威档拷贝，收口时 cp 同步）。
- 活体现势：authority cored pid 481 / kube-inner 482 / headless 1986（桥 env=WAKE 46729/SPAWN 41781/SELFHEAL 44341）；gate jar=probe/loop-88/jar.txt。
- **corectl 调用词形（本轮实测）**：`get <Kind大驼峰> <name> --scope <scope>`；`apply -f <file> -rv <现库rv> -field-manager <词形>`（-rv=现库 rv，文档内 resourceVersion=写入值——传错方向=409「读到 14，现库 13」）；`delete <Kind> <name> --scope <scope> -rv <rv> -yes [-field-manager <词形>]`。
- **测试环境纪律（本轮假信号教训）**：plugin npm 须 `env -u CORE_SYSTEM_SCHEME`——本机活体 env 有该词形时 `apply(ctx,{})` 走 autoSpawn 分支同步 provide url='' 桥→bridge.test.ts:121 断言崩（188/1 假信号；干净环境 189/0 真值）。
- 探针产物：probe/loop-88/（jar.txt + npm/go 测试日志 + console-audit rv13/rv14 取证快照）。

## 下轮队列（按优先序）

1. **SQLite applyWrite 跨进程 TOCTOU 修复（最高优先）**：DSN `_txlock=immediate` + applyWrite/applyDelete SELECT 移入事务（读改写原子）——A/B/C/D 四象同根因一修；断言锚 L88-01/L88-02 随行；scheduler/repository 包 -race + 30 包全量绿。**实施窗口=执行会话已 done 退场、workservice 树现势干净（git status 零未提交）**——本轮已核实可安全动写面。
2. **调度器装配门控判需复评**：TOCTOU 修复后 blast radius 已控；`cored main.go:696` 加 `*allowApply` 闸（零 apply 权限进程不进调度写面）=纵深防御可选做（涉及部署面，随重启窗口）。
3. **X face 实体追查**：`/home/friddle/tmp` 全量 db 巡检（本轮只扫 l86-boot/l86-build/l87-build 三目录；l86-boot 冻结 17:07 无 l87 行非 X 面）。
4. **执行体产物部署随行**：磁盘 cored=71f00fd6 已在位；三活体仍 dmm13b8d 差一代——下个重启窗口随行换代（纪律：/proc cored 子进程 sha↔磁盘 sha 直测）。
5. **DocType 第九连拍**（第八连拍 count=0 诚实等待）+ 渲染器扩展判需（已否决两轮维持）。
6. **plugin/package-lock.json 收编裁决**（plugin 仓唯一脏项，历轮沿用）。

## 探针判据位（下轮随行必查）

- P-01 personal-info 六仓 ✓ + metadatainfo（instance 50 篇+本轮 3 文新增后 53 篇待复核）。
- P-02 第二十拍（loop-88=第十九拍 CLEAN-OK：l 前缀=0 含 l87 再删；判据恒=对象名 l<数字> 前缀为零）。
- P-03 60↔60 双向差集=0（`node /home/friddle/probe/loop-85/e85-p03.mjs`）。
- `npm test`：plugin **189 pass**（env -u CORE_SYSTEM_SCHEME！）+ web **80 pass**；go 30 包（`CORE_SYSTEM_SCHEME=<scheme>` env 仅 go 测试需要）+ 四包 -race。
- 镜像闸：cored-lint `files=18 findings=0 mirror=ok`（scheme 双 sha `29e1f0e5`；core_design scheme 若变→镜像同步+复检）。
- DocType：第九连拍观察（诚实等待，不代收）。

## 看门狗注记（loop-88 自查）

1. **执行体单方叙述须盘面对账**：loop-87 执行会话日志自称「bin 二度换代 194873c7 trimpath」——盘面无此 sha（实况=dmm13b8d 一次换代）。纪律：交接对账以盘面 sha/mtime/表行实测为准，不采信会话日志单方词形。
2. **rev 语义勘定**：doc_history.rev=写条件基 rv（旧内容 rv），doc.resource_version=成功后 rv——「history rev < doc rv」非异常；「同 rev 双行」才是 A 象竞速证据。
3. **TTL 判据位**：running 写面时刻+leaseTtl(30m)=判死时刻（04:00:53→04:30:55 实测+2s 精度）；phase≠running→租约静默终止（scheduler.go:329-333 代码实证）——裁决复位 verifying 后执行体 22 分钟内终写=通路在。
4. **applyWrite 修复前现势风险**：l87 僵尸依赖已删，但「同基双写/陈旧 rv 409/删后复活」通路仍开放——修复（队列 1）前任何多进程写面动作都需 409 后重读重放纪律（机械面自愈依赖）。
5. **隔离 face X 词形教训**：多 face 现势下的删除动作必须先核「当前权威 face」再删——`corectl` 默认连 `~/.dsh/cored.addr` 指向面；跨 face 幂等性不存在（D 象实源）。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（≤ 约 20k tokens）：写大文件分块，防 max-tokens 截断终止本轮。
2) 若本轮截断：下轮按已有进度续跑（先 git status / git diff / 报告对账），不重做已完成部分。
3) 每完成一个可验证子步就落盘（编辑/commit），避免进度集中在最后一次巨型输出。
4) 429/配额枯竭：立即写 GAP 结束本轮，不反复重试。
5) 探针清场按标记判：探针对象一律 `l<轮次>-` 前缀；验收前判据=清零（不许 *-probe* 绕名）。
6) 本轮结束不得自行 setsid 点火下一轮：用 CLI 事件提交（`<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`）；事件链路故障先修 bug 不回退外部点火。
