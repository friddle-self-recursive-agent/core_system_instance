# loop-c-batch —— 会话屏通信与视觉重建批（C 批）验收报告（2026-11-26）

> Task/self-recursive-core/chat-revamp-20261126（C 批）。规范全文=[chat.md](chat.md)；样式基准=[style.md](style.md)。执行序 C-A 先通信后皮肤（C-03→C-01→C-02→C-05→C-04→C-06→C-B）照批文 §四判据逐项落证。

## 一、权威提交（均已推 origin）

| 仓 | 提交 | 内容 |
|---|---|---|
| core_system_workservice（submodule core_system） | `b849a6b` | 会话屏 v4（chat.js 重写 800 行贴线 + chat.css 新建 212 行 + i18n 拆 i18n-en.js）：C-A 六项 + C-B 五项；web **66 pass 0 fail**（+9 锚）；dist 重建；UI 拍 16/16 零 pageerror |
| core_system_dsh_plugin | `94d7f5a` + `9539df1`（侧车） | chatfaces.ts send 扩 mode + chat-stop 路由（C-01/C-02）；transcript.ts state 活体投影（C-03 projectLive/projectStateLive）；**npm test 181 pass 0 fail**（+3 锚）；dist/client.js 重建（743036 bytes）；R-DOC-6 侧车 ×2 |
| core_system_instance | `4cf6b02` | loop-next.md R-DOC-6 侧车补缺 + 本报告 |

## 二、C-A 通路六项逐项落证

| # | 判据（chat.md §二） | 实测 |
|---|---|---|
| C-01 steer | 向运行中会话插话一句，3 轮转录内可见入账 | **活体实证**：沙箱会话 `session-bea151ef` steer 插话「收到请只回复 STEER-OK」→ durable journal seq 24 `user/message` + seq 25 `assistant/message` 应答 **STEER-OK**（API 直读转录为证）；UI 同拍：受理词形注记=steer ∧ 气泡即时回声 ∧ `modeForState` 双分支测试锚 |
| C-02 停止 | 运行中会话点停止→state 翻空闲；面缺席=503 诚实词形 | UI 同位「■」停止钮已验（S-04 运行中 mode=steer+ico=■）；**桥面接线完成但宿主未重启**——本会话与 dsh-core-system systemd 同 cgroup（KillMode=control-group，loop-82 死亡同源），重启=循环 agent 会话终止，故本批不动宿主进程；前端实测 `f.stop` 缺席=**503 诚实词形**（S-06「停止通路未注入——显式缺席，不冒充」）；插件侧 handler 已测试锚（cancel 受理 200/缺席 503/405/400）；随下次宿主重启窗口生效 |
| C-03 活体行 | 长工具链会话「正在调用 X…（已 N 秒）」+队列深度 chip | 数据面=宿主 chat-state 扩投影（running/queue/queueDepth/steerDepth/currentTool/currentToolSince/lastSeq——U-13 实证 state 键集）；UI 活体行「agent 运行中…」实测可见（S-03，长任务运行态截图）；工具词形=journal 尾未闭合 tool/call 推导（projectLive 测试锚：未闭合=在册/result 闭合=退场） |
| C-04 增量+滚动锚 | 只 append 新节点；上翻不被拽底；「↓ N 条新消息」浮标 | `nextBatch`/`nodeKey` 纯函数锚（首绘全量/增量只出未渲染键/seq 回退不重复）；UI 单滚动列（overflowY=auto）+ 贴底跟随/上翻浮标词形（U-02）；3.5s 轮询只动转录区+composer 焦点保真实测（U-07：轮询后焦点+输入内容不丢） |
| C-05 requestId 销账 | 重发同文不错销；失败行内「重试」 | pending={text,requestId,at}——requestId 主匹配+文本兜底；L-02 实证 send 回执携 `requestId+mode`（`cc-mwxqj9pk-qvq29d`）；失败行 `data-cc-retry` 重试钮在册（测试+词形） |
| C-06 会话行升级 | 未读点/相对时间/today-earlier 分组 | 未读点（lastSeq>highwater 且非当前会话）+相对时间（relAge）+今天/更早分组头——142 行真清单渲染（U-06）；sessionRowHtml/sessionsHtml/dayGroupOf 三锚全绿 |

## 三、C-B 视觉五项逐项落证

| # | 判据 | 实测 |
|---|---|---|
| C-07 三段式全高 | 转录 flex:1 单滚动列（废双滚动）；列居中 800px；零 inline style；chat.css 拆分 | `.chat-screen`（顶条/转录 flex:1/composer sticky）；`.chat-col` max-width:800px 居中；用户泡=右对齐 panel-2 rad-card；助手=全宽无泡 md 直接排；「已深度思考」折叠条（废「思考过程」裸词）；「已调用 `<name>`」chip 折叠行（废 ◆ 与 ──── 文本艺术）；**chat.js `grep "style="` = 0**；styles/chat.css 新建 212 行唯一真源；screens.css v3 块退役（-27 行）/components.css cc-composer 族迁出 |
| C-08 composer 重建 | 白卡 radius-card、自增长 1-8 行、发送=圆形近黑钮；运行中同位变「■」 | `.chat-comp`（panel 白卡+rad-card+发丝阴影）；textarea 自增长（input 事件+1-8 行封顶）；`.chat-send` 圆形近黑（--ds-btn-bg）hover 提亮（禁变暗）；运行中同位「■」停止钮（S-04 实测）；Enter 发送/Shift+Enter 换行保留；总览 composerHtml/bindComposer 同款收编（root 会话词形不变） |
| C-09 会话侧栏 | 玻璃抽屉（--glass+blur12）、选中态 accent-dim 废 outline hack、窄幅收图标条 | `.chat-side` 玻璃底（--glass+--ds-glass-blur）；选中=accent-dim 底（`.chat-sess.active`）；1100px 收 210px 图标条（媒体查询） |
| C-10 空态 | 居中问候+4 枚示例 chips（点击即填 composer 真实可发） | `.chat-empty` 问候+4 chips（U-03/U-09 实测点击填 composer 且获焦）；不放假对话历史 |
| C-11 i18n | 双语随行 | chat.js 屏内 62 键 EN 词典全覆盖（对照脚本=0 missing）；词典本体拆 `core/i18n-en.js`（i18n.js 42 行+词典 798 行——R-ENG-7 双绿） |

## 四、机械验收（chat.md §四判据逐条）

1. **UI 拍**：8 张截图落盘 `probe/loop-c-batch/data/`（chat-1080p / chat-1100px / chat-live-send / chat-live-running / chat-live-steer / chat-live-steer-ledger / chat-live-settled / chat-live-stop）。
2. **活体验证三张运行态截图**：`chat-live-running.png`（活体行「agent 运行中…」+■停止钮+steer 注记）/`chat-live-steer.png`（插话回声）/`chat-live-stop.png`（停止 503 诚实注记）——**真实活体**（沙箱会话自提长任务，不造假会话）；steer 入账另附 API 直读 journal 证据（seq 24/25 STEER-OK）。
3. **npm test 全绿**：web 66 pass 0 fail（transcript-map.test.mjs +9 锚）；plugin 181 pass 0 fail（proxy.test.ts +3 锚：mode 透传/chat-stop 契约/活体投影）。UI 拍零 pageerror（ecb-ui 16/16 + ecb-live + ecb-repl 5/5 + ecb-stop 7/7 全程零 pageerror）。
4. **行数红线**：chat.js 800 行贴线（预案 chat-list 拆分备而未用）；i18n 拆分后双绿；`max-file-lines.sh` src+styles ✓ / plugin ✓。
5. **窄幅 1100px**：零横向滚动（scrollWidth ≤ clientWidth 实测）。
6. **通信红线不变**：宿主缺席=诚实降级（state 尾推导缺席=仅 passive state 词形；stop 面缺席=503 不冒充）；session id 永由宿主发零手填；受理词形如实区分（queue/steer 注记随态——U-05/L-05 实测）。

## 五、Verify（R-TYPE-3）

| 项 | 工具 | 结果 |
|---|---|---|
| code 规则 | connectops-code-audit（cored :38307；checks=[R-ENG-7/cored-lint]，schemePath=core_design scheme） | **web 树 ok=true findings=0 unbound=0**；plugin 全仓 4 findings 均为**在册存量路径**（testdata scheme×2 + patch.yml×2，本批 diff 未触及——`git diff 98e29fa..HEAD --name-only` 对账为证） |
| code 规则 | max-file-lines.sh（R-ENG-7） | core_system src+styles ✓；plugin src+test ✓ |
| code 规则 | metadatainfo.sh（R-DOC-6） | instance 49 篇 ✓；plugin 2 篇 ✓（README×2 侧车本批补缺并提交） |
| agent 规则 | 本报告（verdict=pass）+ 全部 diff 已推 origin 可回查 | 跨 agent/human 项（如 R-UX-3 黑话清零）由上级/人复核——本批 UI 词形已按 chat.md §三替换（受理词形如实区分/零工程黑话新词形） |
| human 规则 | 宿主重启窗口（chat-stop 桥面生效） | 待部署侧裁决——**不动 systemd 宿主**（同 cgroup 重启=本会话及兄弟 agent 会话终止，loop-82 死亡同源）；UI/桥代码已就绪，重启后零代码动作即生效 |

## 六、诚实注记（未冒充项）

1. **chat-stop 桥面未在活体宿主生效**：插件 dist/client.js 已重建+路由注册+测试锚全绿，但宿主进程未重启（部署裁决见 §五）——当前活体 `f.stop` 缺席=前端 503 诚实词形兜底（S-06 实测）。C-02「点停止 state 翻空闲」的最终活体判据留待宿主重启窗口复核。
2. **state 活体行「正在调用 X…（已 N 秒）」**：工具词形数据面已验（projectLive 锚+state 键集），本轮沙箱会话运行窗内工具链尚未命中推导窗口（运行短、工具调用快），活体行以「agent 运行中…」泛词形入证；工具词形随长工具链会话自然命中（数据面已就绪）。
3. **四死声称任务不动写面**（沿用 loop-83 裁决）：`chat-revamp/concept-visibility/console-audit/style-unification` 四 Task `running 拉起中（spawn）` 与调度器自愈重拉并存——本报告仅回写自身任务 status。
