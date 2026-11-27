# chat-ds.md —— 对话面展示类型对账批（D 批）+ 引用条与详情弹窗（B 批，2026-11-27）

## 〇、指令

用户指令（2026-11-27）：「你这个对话按 deepseek harness 展示方式。不行就找找 dsh 的源代码。一行行对比。少多少补充多少。少多少类型展示多少类型的」「对话中引用的文档。上下文 在第二张图可以切换。然后点击弹窗可以看详情弹窗」。

方法：直接取上游 deepseek-ai/deepseek-harness 源码（tmp/upstream-dsh 浅克隆，MIT）逐类型对账；上游包面证据=packages/client/ui-chat（转录装配）、ui-tool（工具视图）、ui-conversation、ui-jobs、ui-reference、ui-primitives/src/markdown（代码块）；词表权威=ui-chat/src/client/locale.ts zh 段 + dsh-session types.d.ts 事件词表。不 fork、不 iframe——继续自有 vanilla 控制台，只补齐展示类型与词形（2026-11-26 用户裁决「代码拷贝过来」延续）。

## 一、对账总表（少多少补多少）

| # | 上游展示类型（权威词形） | 上游依据 | 我们现状 | 判定 |
|---|---|---|---|---|
| D1 | 轮触发行卡：`后台任务状态更新`（source.kind=tool-jobs）/`插件状态更新`（cordis-host-runner）/`自动化任务`（schedule）/`子任务状态更新`+终态变体（subagent-settled: completed/aborted/error/max-tokens/refusal）/`收到执行请求`/`继续执行目标`（goal）/`收到任务消息`（agent-message）/`收到团队消息`（team-message）/`收到 GitHub 事件`/`收到外部事件`（webhook）；卡=图标+标题+右侧时间+chevron，展开=「这条通知触发了本轮回复。」+全文 | ui-chat turn-trigger.ts:52-79 + TurnTriggerNodeView.tsx:43-55 + locale.ts:54-70 | 注入消息渲染成全尺寸用户泡+「注入上下文」标签 | **缺——补** |
| D2 | 上下文注入行：`上下文注入`/`跨会话召回`+ producer 标签 + form 摘要（notice→summary≤120字一行不展开；instructions→已载入/已新增/已更新/已移除；catalog→替换目录/…还有 {count} 条；snapshot→取代先前的快照；relay→来自会话 {session}；recall→保留 X 条 · 省略 X 条/已截断） | ContextInjectionRow.tsx:31-94 + ContextBody.tsx + locale.ts:141-154 | 同上（全泡） | **缺——补** |
| D3 | 轮汇总条：`已完成` / `已完成，用时 `+X（时/分/秒分段，分钟从 60s 起）/`处理失败`/`已停止`；运行中=`深度求索中，用时 {duration} ···` | TurnProcessNodeView.tsx:22-30 + message-chrome.ts:54-72 + locale.ts:71-73,100-101 | 无 turn 汇总；活体行只有「正在调用 X…（已 N 秒）」 | **缺——补**（汇总条+用时；折叠整轮不做——增量大渲染架构冲突，标注差异） |
| D4 | 待办清单：工具行 `更新任务清单`（todo_write）摘要 `{done}/{total} 已完成` + 首个进行中项；展开=三态点清单 | ui-tool todo-row.tsx:53-78 + ui-conversation TodoPanel.tsx:65-109 | 桥 KEEP 无 todo/write，渲染器无此类型 | **缺——补**（桥 KEEP+渲染器；事件缺席=诚实不渲染） |
| D5 | 工具行五态：preparing/running（shimmer）/ok/error（红，摘要=输出首行）/stopped（琥珀「已停止」）；bash 退出码徽标 `退出码 {code}`/`信号 {signal}`/`未正常退出` | ui-tool tool-call-model.ts:406-408 + ToolRow.tsx:150-158,224-245 + bash-sample.tsx:30-38 | 只有 完成/执行中… 两态；error 被吞（result.error 不识别） | **缺——补** |
| D6 | 工具专名标题+摘要：read=`读取`（summary=file_path 可点）、write=`写入`、edit/apply_patch=`编辑`、bash=`运行命令`（summary=命令）、grep=`搜索文件内容`、glob=`查找文件`、web_search=`网页搜索`、web_fetch=`网页获取`（summary=URL）、todo_write=`更新任务清单`、ask_user_question=`提问`；未知=`已调用 {name}` 沿用 | ui-tool toolviews/* + locales.ts:333-353 | 恒「已调用 {name}」+裸 JSON | **缺——补**（标题映射+关键参数摘要；完整 JSON 保留在展开体） |
| D7 | 工具 result meta 展示：read meta.lines 行号预览；diff meta.diffs→DiffBlock；grep/glob meta→`{shown} 处匹配 · {files} 个文件`/`{shown} 个路径`/`无结果`；web meta.sources/statusCode | read-card-model.ts:49-72 + search-card-model.ts:86-97 等 | meta 完全未消费（桥已透传） | **缺——补**（分级：read 行号块+search 计数+diff 计数先行；完整 DiffBlock 沿用 render/diff.js） |
| D8 | 模型重试行：`正在重试模型请求`/`等待重试模型请求`/`{label}（{retry}/{maximum}） · {seconds}s`+`失败原因：` | locale.ts:178-185 | llm/retry 桥已 KEEP，渲染器未接（floor 丢失） | **缺——补** |
| D9 | 轮错误/上限：`本轮运行失败`/`已达到输出 token 上限`+hint「回答被截断…发送"继续"…」/`任务已停止` | locale.ts:187-194 | turn/end 桥已 KEEP，渲染器未接 | **缺——补** |
| D10 | 用量 pill：`用量 {total}`+title 明细（缓存命中/未缓存输入/缓存读取/缓存写入/输出/（其中推理 {tokens}）） | TurnUsagePanel + locale.ts:196-205 | assistant/message.usage 桥已透传，渲染器未消费 | **缺——补**（pill+title 明细；统计对话框不做——会话级聚合另批） |
| D11 | 代码块：头横幅=语言标签（缺省=`代码块`）+复制（成功闪 `复制成功` 1s）+自动换行切换（默认开）；inline code 文件提及=可点 chip | ui-primitives CodeBlock.tsx:244-263 + CodeToolbar + render.tsx:356-372 + zh.ts:6-10 | md.js 直出裸 pre/code，零头横幅零复制 | **缺——补**（marked code renderer 覆写+事件委托复制/换行；行号不做——上游聊天围栏也不带行号） |
| D12 | 思考行词形对齐：标题=`思考`（上游无「已深度思考」词）+ 收起摘要=首行预览（剥 **）；运行中 shimmer | ReasoningRow.tsx + locale.ts:164 | 标题「已深度思考」、无预览 | **词形纠偏——补** |
| D13 | 消息时钟：当天 HH:MM；同年 `M月D日 HH:MM`；跨年 `Y年M月D日 HH:MM` | message-chrome.ts:86-100 + locale.ts:216-217 | 节点零时间显示 | **缺——补**（触发行卡/轮汇总/消息 title 属性三处落时钟；hover 图标行不做） |
| D14 | subagent 子调用缩进树 / compaction 卡 `上下文已压缩` / 指令卡 / 提问卡 | ui-tool ToolCallTree.tsx:84-101 等 | 无 | **暂缓**（journal 未见对应事件词形；出现即按 D 族句法补——诚实缺席不冒充） |

## 二、B 批：引用文档+上下文切换条+详情弹窗（用户点名词形，图2）

上游对应物：文件 chip 仅用户 @mention 生成（ui-reference user-text-rules.ts:29），点击开右侧预览 tab（apply.ts:292-299 dsh-resource://file/session/...）、`打开` 词形在 ui-open-in-app（locales.ts:61）。上游无「条内切换+弹窗」形态——**此批是用户点名的自有词形**，chip 视觉与文案对齐上游（`打开` pill），行为=条内选中切换+点击弹详情 modal。可行性：api.object（Doc 全文 content 已回）+api.designDoc(repo,path)（docrepo 元数据直出）两读面皆在，零后端改动。

| # | 动作 |
|---|---|
| B1 | **引用抽取**（纯函数）：转录节点收集三类引用——①linkifyRefs 命中的 Kind/scope/name（Doc 族优先）②工具 args 的 file_path/command 词形中的文件路径 ③上下文 chunks（ContextPack 索引候选，kind/scope/name+score）。去重保序，条上分组「引用」「上下文」 |
| B2 | **引用条**：composer 上方水平 chip 条（图2 词形：`concepts/cli.md [打开]`）——chip 可点击选中（高亮切换）、右端 `打开` pill；横向滚动溢出；空=整条不渲染（不冒充） |
| B3 | **详情弹窗**：点 chip/打开 → overlay modal：Doc 族=api.object 直读 content（markdown 渲染+frontmatter chips+`在文档库中打开`深链）；文件路径=api.designDoc 逐仓试读，未命中=诚实降级（显示「未在文档库命中」+来源摘录）；esc/点外/关闭钮三通道关；零 inline style |
| B4 | **上下文条整合**：现 ContextPack details（ensureCtxBar）保留；chunks 中的文档对象同步进引用条「上下文」组——两个面同源不重复造账 |

## 三、实现落点

| 文件 | 动作 |
|---|---|
| workservice web/src/screens/chat.js | mapTranscript 扩族（notice/turn-tail/todo/retry）+五态工具行+标题映射+usage pill+时钟 |
| workservice web/src/screens/chat-refs.js | **新建**：引用抽取纯函数+引用条渲染+详情弹窗挂载 |
| workservice web/src/render/md.js | 代码块头横幅+复制/换行（renderer 覆写）；DOMPurify 白名单随行（button/title） |
| workservice web/styles/chat.css | D/B 全部新词形样式（现 212 行，红线 800） |
| workservice web/src/core/i18n-en.js | EN 词典随行（新词形全量对） |
| plugin plugin/src/bridges/transcript.ts | KEEP += todo/write（一行+测试锚） |
| 测试 | transcript-map.test.mjs 扩锚：触发行分类/用时格式/五态/标题映射/meta 摘要/todo 模型；chat-refs.test.mjs 新建：抽取/去重/词形 |

## 四、完成判据（机械）

1. npm test 全绿（新增锚≥12）；node esbuild.mjs 零错；chat.js≤800 行、chat-refs.js≤400 行、chat.css≤800 行；
2. CT116 活体验证（浏览器经 gate）：loop 自身运行会话三截图——①触发行卡（后台任务状态更新+右侧时间+展开体）②轮汇总「已完成，用时 X」③代码块头横幅+复制成功闪词；引用条+详情弹窗截图（concepts/cli.md 词形）；
3. 上游词形逐条比对截图与本文对账表编号一一对应；数据缺席词形（todo 无事件=不渲染）截图备查。

## 五、上游证据索引（深查入口）

- 克隆：core_design/tmp/upstream-dsh（浅，master）；npm 包对证：tmp/dsh-pkgs（dsh-session types.d.ts=事件词表权威）
- 转录装配：packages/client/ui-chat/src/client/conversation-nodes/*（event-projection/message/assistant/tool/turn-tail/compaction）
- 词表：packages/client/ui-chat/src/client/locale.ts（zh 段 8-218）；packages/client/locale/src/locales/zh.ts（通用：复制/代码块）
- 语义契约：@deepseek-ai/dsh-llm message.d.ts——MessageSourceMap（user/plugin+ContextForm：instructions/catalog/snapshot/notice≤120/relay/recall）

## 六、收口账（2026-11-27 活体验证）

**落账**：workservice main @2a6469f（三提交：33d2958 主批+ef83faa ctx 出借+中断合成+2a6469f 路径收紧；web 116 pass）；plugin main @a146200（KEEP+todo/write、pin bump×3）；CT116 已部署（submodule@2a6469f，console-web mount 新 dist，顺序重启）。

**活体验证截图**（acceptance/console/ds-batch/，浏览器经 gate :3090）：
1. ds-1：D1 触发行卡「后台任务状态更新 · tool-jobs · 摘要 · 14:54」+ D6 专名工具行（运行命令/搜索文件内容/读取+参数摘要）+ D5 运行中态；
2. ds-2：D6 展开体（read args file_path 词形）+ D3「处理失败」红点行+右时间；
3. ds-3：B3 详情弹窗——loop-next.md markdown 渲染+「在文档库中打开」+「关闭」，背后 B2 引用条 chip+「打开」pill（图2 词形）；
4. ds-4：D5 中断合成（84 条已停止琥珀态）+ D4 待办卡「更新任务清单 7/7 已完成」+ D3 处理失败 + B2 引用条（sqlite_crossproc_test.go/main.go/probe/loop-89/jar.txt + 打开 pill）。

**端到端发送链路**：新会话（宿主发 id）→发送入账→上下文注入行（runtime-context/skill-catalog/time-context 三 producer 标签+时间）→turn started→「处理失败」词形——发送面全通；**回合失败=模型面问题（新会话 turn/model 调用失败，与本批展示无关，另账）**。

**活体发现并当场修复三件**：
1. `window.__CC_CONSOLE_CTX__` 只建不借——上下文条恒空壳「加载中」、引用条无 api 面（老病根，本批 B3 依赖才暴露）→ main.js 全局出借（ef83faa）；
2. turn/end 后未闭合工具调用恒显「运行中」→ 中断合成=已停止（上游 tool.ts 同族，ef83faa）；
3. 引用条混入纯数字段串（HTTP 码 200/200/405）与截断段 → looksLikePath 收紧（2a6469f）。

**遗留（如实）**：
- D11 代码块头横幅=116 锚+部署在册；活体像素证据留待转录窗口出现围栏代码（现存 80 事件窗口的助手消息全为行内码；designdoc 面直开路由本次未注水，另查）。
- D14 族（subagent 嵌套树/compaction 卡/指令卡/提问卡）：journal 未出现对应词形，诚实缺席；出现即按对账表句法补。
- 轮级折叠（foldCompletedTurns 整轮收拢）不做——与增量渲染架构冲突，对账表已标注；上下文注入行展开体被 3.5s 轮询安全（增量 append 不重绘旧行）。
