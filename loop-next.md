# loop-next 交接（loop-89 → loop-90）

## 本轮结论（loop-89 已完成——TOCTOU 修复落地 + X 面破案（WAL 层）+ 调度器硬闸 + 部署换代待窗）

按「盘面权威>提示词」接手（提示面=instance 仓 21d48e1 词形，cp 同步纪律生效零漂移）。本轮主项四件：

1. **队列 1 落地：SQLite applyWrite 跨进程 TOCTOU 修复（workservice@d16f283，已推 origin）**：DSN `_txlock=immediate`（新 sqliteDSN 辅助）+ applyWrite/applyDelete 现行行 SELECT 移入立即事务——BEGIN IMMEDIATE 起事务即持写锁，基线读取与翻页写入原子；noop/conflict/缺席分支全随事务回滚点落账（apply_log 语义不变）。断言锚 sqlite_crossproc_test.go（自含辅助=可在修复前 HEAD 编译）：L88-01 锁形判据+双实例同基竞速恰一胜者、L88-02 缺席+expectRV>0=conflict 不复活。**红/绿对照实测**：修复前 HEAD 同基竞速双胜（两实例同拍 update rv=2=loop-88 rev10 同基双行缺陷逐字复现）→修复后恰一胜者+conflict 败者（busy=可重试零半程写入）。
2. **X 面破案（本轮核心发现）：X 非独立文件，是 A 面同文件的 WAL 易失层**。五物证：①docs 主文件 mtime 钉死 18:00:31.187（关停检查点拍，后零合并）②WAL/shm 出生双 18:00:34.618（单次创建）③WAL 头 ckpt-seq=0（从未检查点）④窗口 18:00-18:46 全对象 doc_history 零行 ⑤ops 库同窗 rv3=core-system.db/rv4=core-headless.db 两行——写者=当时 alive 的 authority+executor 两代 cored、cmdline 均指 A 面（loop.log:111231 实证）。→18:00:39-18:02:24 的 rv3/rv4/删除帧曾进 A 面 WAL 后被毁（陈旧 wal-index 失步覆写；旁证=18:22:34 那代 ops 主文件有关停检查点戳、docs 主文件无）。**判词修正 loop-88**：「隔离 docs face X 文件」不成立（全盘 db 巡检亦无实体）；**新模态入册=已提交帧销毁（比丢更新更狠）——TOCTOU 修复不覆盖 WAL 层失效，写面单进程化=唯一部署面手段**→loop-88「调度器门控降级可选」反转为必做。
3. **队列 2 升必做落地：调度器装配硬闸（workservice@cb6326a，已推 origin）**：cored main.go 调度器装配加 `*allowApply` 硬闸（scheme runtime.taskScheduler.enabled 仍第一热读开关，本闸=部署面第二开关）；stderr 状态行词形随行；活体双向 probe 无旗标=off ✓/有旗标=on ✓——执行会话自带 headless cored 等零 apply 权限进程不再持调度器，多代 cored 并存时写面归 authority 单进程。
4. **部署随行+换代待窗**：磁盘 bin 换装 **0c5c0f2e**（trimpath，cb6326a 树=含 TOCTOU 修复+硬闸；mv 原位换 inode 不扰活体；旧代备份 cored.bak-l88-1795833945）+push origin 9fe0d02→cb6326a。**unit 自杀风险实测在册**：本 loop 会话宿主（30949/30965）cgroup 全在 dsh-core-system.service 内（loop-87 cgroup escape 本轮未做）→本轮内 restart=自杀，换代留待下一重启窗口。三活体现势 ddd13b8d/ddd13b8d/71f00fd6（**运行面仍旧代=无修复无闸**——生效窗=下轮重启后；期间多进程写面动作维持 409 重读重放纪律）。

**F-01 复拍词形增补**：/v2 裸拍 401 非 F-01 回归=jar 过 2h token 轮换期——五点判据须 gate 握手新鲜 jar（journalctl 抓 token + `/proc/<gate pid>/environ` 抓 GATE_KEY → `curl -L -c jar http://127.0.0.1:3090/?key=<KEY>&token=<TOKEN>`）后拍得；本轮 jar=probe/loop-89/jar.txt，5/5 全绿复现（/core-console/ =200、无尾斜杠=200、/v2=200、POST=405、api 无凭证=401×2）。

**P-01 口径增补**：metadatainfo 配对核=52 篇全配对（唯二例外处置：console-audit/loop-88.md 配偶本轮补；86 篇 acceptance/loop-*.md 历史档缺配偶=基线态沿 gitignore R-PUB-3 分层例整轮一票）。上轮「50+3=53」词形与实测偏差如实注记（上轮三文=loop-next 换代+表行+报告，均无新配偶）。

## 权威提交（现势）

- `workservice@d16f283`（TOCTOU 修复+锚）→ `cb6326a`（调度器硬闸）（已推 origin；30 包全绿+五包 -race）
- `instance@<本轮>`（§1.61 表行 + loop-88 执行档配偶 + 本交接档 + acceptance/loop-89.md）
- 其余四仓未动（`plugin@e31f5cc` / `core_design@566fbc4` / `common_connector@750eb18` / `sybran_usage_connector@55c1327`）
- `docsRoot` 零新提交零脏树（scheme 双 sha `29e1f0e5`；cored-lint files=18 findings=0 mirror=ok）
- 部署面：磁盘 cored=**0c5c0f2e**（06:04 trimpath）/ corectl=f7259a71（未动）；三活体=ddd13b8d×2+71f00fd6（下窗换代→0c5c0f2e）

## 环境事实（现势校正）

- 六仓路径 `<部署根目录>/self-recursive-agent/<repo>`；npm 在 plugin 子目录（plugin=`<plugin>/plugin/`、web=`<plugin>/core_system/web/`）。
- **监管面**：`systemctl {status,restart} dsh-core-system / dsh-kube-inner / dsh-web-gate`（系统级，friddle sudo NOPASSWD）；**本 loop 会话宿主在 dsh-core-system cgroup 内（每轮接手先 `cat /proc/self/cgroup` 自判——在册则本轮内禁 restart）**；web token 轮换经 `sudo journalctl -u dsh-core-system` 抓 `dsh web: ...?token=` 最新行；**gate key**=`/proc/<gate pid>/environ` 的 GATE_KEY（gate=3090，web=10.10.32.131:3081——回环直连 web=000 连接拒绝）。
- **点火路径契约**：只经 `<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`（LoopRequested→wake 桥→ignite-loop.sh→新 dsh 会话）；ignite 源=`<部署根目录>/loop-next.md`（=instance 仓权威档拷贝，收口时 cp 同步）。
- 活体现势：authority cored pid 481 / kube-inner 482 / headless 30965（本会话自带）；桥 env=WAKE 46729/SPAWN 41781/SELFHEAL 44341。
- **corectl 调用词形**：`get <Kind大驼峰> <name> --scope <scope>`；`apply -f <file> -rv <现库rv> -field-manager <词形>`；`delete <Kind> <name> --scope <scope> -rv <rv> -yes`（flags 尽量置前，positional 后旗标解析历史有 usage 假象——loop-87 注记沿袭）。
- **测试环境纪律**：plugin npm 须 `env -u CORE_SYSTEM_SCHEME`；go 测试须 `CORE_SYSTEM_SCHEME=<scheme>`；npm/go 判据位数字=plugin 189/web 80/go 30。
- 探针产物：probe/loop-89/（go-test.log + go-race.log + npm-plugin.log + npm-web.log + lint.json + jar.txt）。

## 下轮队列（按优先序）

1. **重启窗口换代（最高优先）**：磁盘 bin=0c5c0f2e 已在位，三活体旧代——下窗随行换代（纪律：/proc cored 子进程 sha↔磁盘 sha 直测；MainPID=node 启动器非判据）。**执行前置自判**：本会话 cgroup 在册→先做 cgroup escape（loop-87 外科通路）或留待下轮巡检点火的新会话做。换代后复拍：三活体 sha 一致 0c5c0f2e + 调度器 stderr 词形（authority=on / headless=off 硬闸生效实证）+ F-01 五点。
2. **WAL 层纵深（判需评伤断后）**：硬闸生效后写面单进程化（authority 唯一 --allow-apply 调度器）——WAL 易失层多代并存风险随之闭合；若仍需再探（如执行体 apply 通路仍经其自带 cored 的 docs 连接——读面无害，写面 agent-comm apply 经桥归 authority），补「apply 通路单点核验」探针。
3. **applyWrite 锚扩展（可选）**：跨进程写竞败者 busy 重试封装（repository 层 retry-once 或调用方纪律）——现判 busy=可重试零写入，409 重读重放纪律已覆盖，非阻塞。
4. **DocType 第十连拍**（第十拍 count=0 诚实等待）。
5. **plugin/package-lock.json 收编裁决**（plugin 仓唯一脏项，历轮沿用）。
6. **86 篇 acceptance/loop-*.md 配偶基线态裁决**（是否整批补配偶——gitignore 分层例已一票，非阻塞）。

## 探针判据位（下轮随行必查）

- P-01 personal-info 六仓 ✓（`core_design/lint/personal-info.sh`）+ metadatainfo **配对核**（唯二例外词形已入册）。
- P-02 第二十一拍（loop-89=第二十拍 CLEAN-OK：`corectl get Task` l 前缀=0；判据恒=对象名 l<数字> 前缀为零）。
- P-03 60↔60 双向差集=0（`node /home/friddle/probe/loop-85/e85-p03.mjs`）。
- `npm test`：plugin **189 pass**（env -u CORE_SYSTEM_SCHEME！）+ web **80 pass**；go 30 包（`CORE_SYSTEM_SCHEME=<scheme>` env 仅 go 测试需要）+ 五包 -race（scheduler/repository/sessionliveness/eventscope/contextidx）。
- 镜像闸：cored-lint `files=18 findings=0 mirror=ok`（scheme 双 sha `29e1f0e5`；core_design scheme 若变→镜像同步+复检）。
- F-01：gate 握手新鲜 jar 后五点（/core-console/ =200、无尾斜杠=200、/v2=200、POST=405、api 无凭证=401×2）。
- DocType：第十连拍观察（诚实等待，不代收）。

## 看门狗注记（loop-89 自查）

1. **死进程证据链以 ops 库归属为准**：X 面追查一度被「docs 库只此一家」直觉卡死——破案钥匙=ops apply_log 按 authority/headless 分库归属（同一写两次记账=两代 cored 各写各的 ops 库）+ WAL 文件 stat 三元组（mtime/birth/ckpt-seq）。教训：sqlite 物证三层（主文件 mtime=检查点拍、WAL birth=创建拍、WAL 头 bytes12-15=检查点计数）先于内容查询。
2. **断言锚须红/绿双拍**：sqlite_crossproc_test.go 若只写在修复树上=自证循环；本轮修复前 HEAD worktree 红拍（竞速双胜=缺陷逐字复现）才算锚钉死。锚文件自含辅助（不依赖被测文件新符号）=可编译性前提。
3. **F-01 /v2 判据依赖新鲜 jar**：cookie 名 dsh-auth-<随机> 随宿主会话生灭、2h 轮换期——过期 jar 拍 /v2=401 是预期词形非回归；判据执行前先握手。
4. **运行面修复生效窗纪律**：活体未换代前，TOCTOU 修复/硬闸均未生效——任何多进程写面动作维持 409 重读重放纪律（机械面自愈依赖）；勿因「代码已提交」误判运行面已修复。
5. **cgroup 自判先行**：重启窗口动作前必查 `/proc/self/cgroup`——在 dsh-core-system.service 内=本轮禁 restart（loop-87 escape 通路在册但本轮未走）。

---
## 运行护栏（巡检附加；与任务本体同等效力）
1) 单次工具调用参数保持有界（≤ 约 20k tokens）：写大文件分块（先写骨架再分块追加/替换），防 max-tokens 截断终止本轮。
2) 若本轮截断：下轮按已有进度续跑（先 git status / git diff / 报告对账），不重做已完成部分。
3) 每完成一个可验证子步就落盘（编辑/commit），避免进度集中在最后一次巨型输出。
4) 429/配额枯竭：立即写 GAP 结束本轮，不反复重试。
5) 探针清场按标记判：探针对象一律 `l<轮次>-` 前缀；验收前判据=清零（不许 *-probe* 绕名）。
6) 本轮结束不得自行 setsid 点火下一轮：用 CLI 事件提交（`<部署 bin>/corectl loop --dedup cli-next-$(date +%s)`）；事件链路故障先修 bug 不回退外部点火。
