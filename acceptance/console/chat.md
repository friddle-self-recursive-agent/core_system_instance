# chat.md —— 会话屏通信与视觉重建批（C 批，2026-11-26）

## 〇、指令

用户指令（2026-11-26）：「另外 chat.js 跟 deepseek agent 根本没有做好沟通和。展示的都丑的不行」。

两条主线：**C-A 通信升级**（把已存在但闲置的宿主真通路接满）+ **C-B 视觉重建**（DeepSeek 对话面版型，style.md token 内）。样式基准沿用 [style.md](style.md)（近黑主按钮/边框阶梯/字阶 4 档），本文不重复 token 定义。

## 一、病灶实测（chat.js 413 行 + chatfaces.ts + agent-comm.ts 读证）

**通信侧：**
1. **steer 闲置**：prompt 合同本有 `mode: 'queue' | 'steer'`（chatfaces.ts:11），UI 恒发 queue（chat.js:298）——agent 运行中插话=默默排队，UI 无任何排队/插话提示；
2. **无停止**：plugin 已有 cancel 真通路（agent-comm.ts:334「会话控制器 cancel 面（interrupt 真通路）」），chat 面未接线——运行中只能干等；
3. **无活体反馈**：delta/live-chunk 被桥剥除（chat.js:8），state 只有 运行中/空闲 两 chip（chat.js:193）——agent 长工具链期间转录死寂数分钟，这是「没做好沟通」的主观感受根源；
4. **整屏重绘**：3.5s 轮询全量 innerHTML 替换+强拉 scrollHeight（chat.js:216-217）——用户上翻阅读被拽底；
5. **requestId 回执丢弃**：send 回执含 requestId（chatfaces.ts:105），UI 不用；pending 回声按文本匹配销账（chat.js:210-213），重发同文/并发会错销；
6. **无错误恢复**：送达失败只有一枚 esc chip（chat.js:302），无行内重试。

**视觉侧：**
7. inline style 满天飞：grid 280px（chat.js:247）、选中态 outline hack（chat.js:128）、padding 补丁 ≥6 处；
8. 双滚动：转录卡 `max-height:calc(100vh-260px)` 套在页面滚动里（chat.js:255）；
9. 文本艺术字：`◆` 头像（chat.js:103）、`────` 分隔（chat.js:112）、dash-row 复用会话行；
10. composer 半成品：rows=2 不自增长、发送无 running 态、hint 文案裸排。

## 二、C-A 通路升级（先通信后皮肤）

| # | 动作 | 依据/判据 |
|---|---|---|
| C-01 | **steer 接线**：state=running 时发送走 `mode:'steer'`（立即注入运行中会话），composer 按态换词形「插话（立即注入）」/「发送」；非 running 恒 queue | 合同已在（chatfaces.ts:11）；活体判据=向运行中会话插话一句，3 轮转录内可见入账 |
| C-02 | **停止按钮**：新路由 `POST /core-console/chat-stop {sessionId}` 接线 plugin cancel/interrupt 面（agent-comm.ts:334）；运行中发送钮变「停止」钮 | 面缺席=503 诚实词形不冒充；活体判据=对运行中会话点停止，state 翻空闲 |
| C-03 | **state 面扩展活体**：chat-state 返回 `{running, queueDepth, currentTool, lastSeq, since}`（由宿主 journal 尾事件推导——不需真流式）；UI 运行中渲染活体行「正在调用 X…（已 N 秒）」+队列深度 chip | 判据=长工具链会话截图活体行可见，非死寂 |
| C-04 | **增量渲染**：转录只 append `seq>lastSeq` 新节点；滚动锚定——贴底才跟随，上翻时右下浮标「↓ N 条新消息」点击回底 | npm test 增锚：增量分支+滚动锚词形 |
| C-05 | **requestId 销账**：pending={text, requestId, at}；入账按 requestId 主匹配+文本兜底；失败行内「重试」钮 | 重发同文不错销（测试锚） |
| C-06 | **会话行升级**：未读点（lastSeq>已见 highwater）、相对时间、today/earlier 分组；标题注水保留 | 窄幅回归截图 |

## 三、C-B 视觉重建（DeepSeek 对话版型 × style.md token）

| # | 动作 |
|---|---|
| C-07 | **三段式全高布局**：顶条（会话名+state+停止）/转录 `flex:1` 单滚动列（废双滚动）/composer sticky 底。转录列居中 `max-width:800px`；用户消息=右对齐 `--panel-2` 泡（rad-card）；助手消息=全宽无泡 `md-body` 直接排（DeepSeek 式）；思考=「已深度思考（N 秒）」折叠条（废「思考过程」裸词）；工具=「已调用 `<name>`」chip 折叠行（废 `◆` 与 `────` 文本艺术）。**零 inline style**——chat 域样式拆独立 `styles/chat.css`（screens.css 已 158 行勿再膨胀；≤800 行红线） |
| C-08 | **composer 重建**：白卡 radius 24、textarea 自增长（1-8 行）、发送=圆形近黑钮（.btn-primary 词形复用）；运行中同位变「停止」方钮（C-02）；Enter 发送/Shift+Enter 换行保留；欢迎屏 composerHtml/bindComposer 同款收编（root 会话词形不变） |
| C-09 | **会话侧栏**：玻璃抽屉（--glass+blur12）、选中态 accent-dim 底（废 outline hack）、窄幅 1100px 收图标条 |
| C-10 | **空态**：居中问候+4 枚示例问题 chips（点击即填 composer 真实可发——不放假对话历史） |
| C-11 | i18n 双语随行（EN 词典同步新增词形） |

## 四、完成判据（机械）

1. 逐项 UI 拍 before/after 截图；**活体验证**：loop 自身运行中会话=真实活体——活体行（C-03）、插话 steer 入账（C-01）、停止翻空闲（C-02）三张运行态截图；
2. npm test 增锚：mapTranscript 增量、steer/queue 分支、requestId 销账、chat-stop 契约；全绿+UI 拍零 pageerror；
3. chat.js 拆分后各文件 ≤800 行；styles/chat.css 新建；窄幅 1100px 回归零横向滚动；
4. 通信红线不变：宿主缺席=503 显式缺席；session id 永由宿主发；queue 语义文档词形随 C-01 更新（运行中=steer/空闲=queue 两种受理词形如实区分）。
