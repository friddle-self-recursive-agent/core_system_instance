# Runtime 已知缺陷记录（known-issues）

> 本文件记录**运行时面**（部署侧执行链、验收机制）发现的缺陷，作为修复轮的输入。
> 设计口径变更同步回写对应概念文档；本文件只管「运行时行为哪里错了、怎么验、怎么修」。
> 公开仓红线：不写真实主机/地址/凭据/收件人（R-PUB-1）——本文一律占位符。

## KI-001 验收探针真实发信副作用 → 通知邮件风暴

| 项 | 值 |
|---|---|
| 发现时间 | 2026-11-23 |
| 状态 | **已修复（loop-33 P0 探针无外发段 + loop-34 P0 通知阶段门+dedup/minLevel 段）**——探针基线零外发（CORE_MAIL_E2E=1 门控+本地 sink+strace 审计入基线，连跑外发=0）∧ 通知只由相位终态事实触发（人注意终态族恒放行∧其余事件须 involved owner 现势 run 相位终态背书；apply 写入不触发用户通知）∧ dedup.window/minLevel 落地（gated/filtered/deduped 三计数可查询）。P1 静默窗口/频控与 P2 apply 与通知解耦声明面随 notification 规则 5 口径并入（窗口聚合即同因频控首段）；余量=送达记录进 ops DB 账本面 |
| 严重度 | 中（用户可感知；实发邮件 ≈ 2 封/轮，18 轮累计 30+；验收不可重放） |
| 影响面 | 验收探针基线（L16/L17 段）、通知触发语义、apply 与通知的耦合 |
| 修复提交 | 探针段：workservice@f19a6ea（--plain 明文模式）+ common_connector@750eb18（CLI 旗标）+ 探针基线 /probe/loop-33（部署侧不入仓）；通知段：workservice@7d65ecf（通知阶段门+dedup/minLevel）+ core_design@3993ee8（notification.md 规则 5+scheme.yaml Notification route.minLevel）+ 探针基线 /probe/loop-34（部署侧不入仓） |

### 1. 现象

- 运营者持续收到内容相同的「loop-16 验收摘要」邮件，**与任何阶段完成无关**；同一主题按轮次重复；
- 每轮 loop 验收至少产生 **2 封真实邮件**（L16 实发 + L17 全链路实发）；探针重跑（run-1/run-2/…）时成倍增加；
- 统计基线：16 轮探针目录 → 17 次 L16 实发 + 16 次 L17 实发回执，时间线与 loop 轮次一一对应。

### 2. 证据（部署侧，路径/地址按占位符）

- 探针基线脚本两处**真实 SMTP 发送**（逐轮复制继承）：
  - L16 段：`send-email --subject "<loop-16 验收摘要>" --body-file <摘要文件>` —— 回归基线无条件执行；
  - L17-05 段：`cored --outbound-exec <wrapper>` → `send-email --envelope --host <smtp-host> --to <recipient>` —— 真实链路实发；
- 每轮探针目录留存当次实发回执（`l16-send.json` / `real-send-result.json`），可逐轮对账。

### 3. 根因

1. **验收判据选错**：把「真实副作用发生」当作机械证据（发送成功=通道可用），使回归基线天然携带外发副作用；
2. **探针非幂等**：同一探针可重跑、且逐轮复制继承，副作用按轮次线性累积；
3. **通知触发缺门（设计余量）**：Notification 的 `route.dedup.window`、`levels`/minLevel、静默窗口均为 declared-deferred；当前触发只看事件类型+等级，**不看相位是否完成**；
4. **apply 语义混淆**：apply 成功（对象写入）被当作可通知的进度事件；**apply ≠ 阶段完成**，通知不应由写入触发。

### 4. 影响

- 用户侧邮件噪音、发件信誉与配额风险；
- 验收不可重放（重放=再发一封），且与 InSync/收敛判据无关的噪音污染人工审查；
- 一旦生产出站接线（`--outbound-exec`），缺阶段门+缺 dedup 会导致「每个事件一封」的通知风暴。

### 5. 修复方向（按优先级）

| 优先级 | 修复项 | 判据 |
|---|---|---|
| P0 | **探针无外发**：真实发送一律 `CORE_MAIL_E2E=1` 显式开关；协议面改用本地 SMTP sink（本机桩/假会话）；基线断言=「sink 收到报文」而非「真实投递」 | 默认跑探针外发连接数=0 |
| P0 | **通知阶段门**：通知只由相位终态事件（Report/推进拍完成/Escalate/ApprovalNeeded）触发；`dedup.window` 与 minLevel 落地 | 未完成相位的 apply 通知数=0；终态=1 |
| P1 | **静默窗口/频控**：按 Notification 声明（默认 10m）落地；超限进积压而非丢弃（账本留痕） | 同 dedupKey 窗口内 N 次注入 → 实发 1、其余 deduped 计数可见 |
| P1 | **验收口径回写**：acceptance.md 增「探针无副作用」硬性要求（无外发/无外部写），探针继承自动携带 | 新轮探针模板含该断言 |
| P2 | **apply 与通知解耦**：apply 只发 DocApplied 事实事件；用户通知由 workflow 相位推进策略显式声明 | 写入流程零通知副作用 |

### 6. 修复验收判据（机读汇总）

- 连跑探针 3 次：默认外发连接数=0；`CORE_MAIL_E2E=1` 时 sink 收报文 3 封（每次 1，主题带 seq）；
- 同 dedupKey 10m 内注入 N 次：实发 1 封，其余计入 deduped；
- 未完成相位（无 Report 终态）的 apply：通知计数=0；相位完成：通知计数=1。

### 7. 修复进展

- **P0 探针无外发——已修复（loop-33，2026-11-23）**：继承基线两处真实 SMTP 发送改为 `CORE_MAIL_E2E=1` 门控 + 本地 SMTP sink（本机桩进程，回环监听，JSONL 收件账——断言「sink 收到报文」而非真实投递，Message-ID/收件人与回执对账）；新增 strace connect 审计（非回环连接计数=0 机读断言）；默认路径零真实地址字面（E2E 段走部署侧 NOTIFY_* 配置面注入）；实现面=common_connector `--plain` 明文模式（本地桩联调用，生产恒 TLS 声明面不变）。取证：探针连跑外发连接数=0（run-2/run-3，767/767 ALL-GREEN）。acceptance.md §7「探针继承自动携带」达成。
- **P0 通知阶段门 + dedup/minLevel——已修复（loop-34，2026-11-23）**：core_design 先落声明（notification.md 规则 5+scheme.yaml Notification route.minLevel，core_design@3993ee8）→ 运行时送达面门链三闸（判定器 `NotifyPhaseGate`：人注意终态族 ApprovalNeeded/Escalate/HeartbeatLost 恒放行∧其余事件须 involved owner 现势 run 相位终态背书——无 run 面 fail-closed 拦；`--notify-dedup-window` 缺省 10m 同 dedupKey 至多一封；`--notify-min-level` 等级下限）；**apply 写入不触发用户通知**（根因 4 收口）；gated/filtered/deduped 三计数随 `/v1/notifications/deliveries` 新载荷键可查询。取证：run-2/run-3 探针（KI-001 §6 判据逐条——未完成相位 apply 通知计数=0∧gated=1；终态族 ApprovalNeeded 注入送达=1；同 dedupKey N=3 注入实发 1、deduped=2；终态 run 背书 apply 送达=1；门拦事件留痕/run 照常）。
- **P1 静默窗口/频控——首段随 dedup 窗口并入（loop-34）**：同 dedupKey 窗口聚合即同因频控机读落点（窗口内至多一封、其余 deduped 计数可见——超限进积压非丢弃的账本面随送达记录入 ops DB 账本轮顺延）。P2 apply 与通知解耦——随阶段门收口（apply 只产 DocApplied 事实事件，用户通知由相位终态背书判定，写路径零通知副作用）。

## KI-003 会话停滞不可观测——session 卡住未建模为事件

| 项 | 值 |
|---|---|
| 发现时间 | 2026-11-24 |
| 状态 | 已确认，待设计收口（纳入对账缺口清单） |
| 严重度 | 中（自举链的"活性"目前只能由外部巡检用 mtime/git 推断） |
| 来源 | 用户判断：「session 卡住也是 event」 |

### 1. 现象

- 外部观察者（人/巡检）判断自举链是否卡住，只能看 `loop.log` mtime、`git log` 时间戳；
- 系统自身的事件面（event_log / triggers / deliveries）对「会话停滞」零表达：真卡住不产事件，正常推进也不产"心跳"；
- 用户凭"一晚上没看到 R-6"怀疑卡死——实际在跑，但系统无法自证活性。

### 2. 设计缺口

session 生命周期（agent-session.md）只有创建/恢复/结束，缺**活性租约（lease/heartbeat）**：
- 会话应周期性推进心跳（相位推进、工具调用、产物落盘任一即心跳）；
- 超过阈值（如 N 分钟无心跳）→ 产出一等事件 `SessionStalled`（level=error，involved=agent/session 实体）；
- 事件走既有 dispatch 表 → 通知（email 通道）+ 自愈 workflow（重启会话/再点火），与 HeartbeatLost 同族语义。

### 3. 判据（机读）

- 注入停滞（SIGSTOP / 断网 / 空转）→ 窗口内 event_log 出现 `SessionStalled` 且 delivery 投影 sent/queued，自愈动作留痕；
- 正常轮次零误报（阈值内不产事件）；
- 事件必须过阶段门与 dedup（KI-001 口径）：同一 session 同窗口至多一条。

### 4. 修复方向

1. **心跳面**：session 侧推进点（相位推进/工具调用完成/产物写）上报 heartbeat（进程内计数 + ops DB 行）；
2. **判定面**：装配层 watchdog（可配阈值，缺省 10m）→ 超时合成 `SessionStalled` 事件（现有合成死信同机制）；
3. **消费面**：通知（email）+ 自愈 workflow（先声明面，动作=重启会话；首期 mode=observe）；
4. **巡检与系统分工**：外部巡检保留为兜底，但系统自报停滞后，巡检只做确认不代替判定。
