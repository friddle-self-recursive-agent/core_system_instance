# 运行时设计 6：Agent Session 记录制与 AUTOLEVEL（R2 / A29–A31）

> 概念依据：core_system/concepts/agent.md v0.3。R2 裁决：**没有**"Agent 一切写操作经 Apply，违者 Policy 拒绝"这条规则；治理换轨为**记录制 + 分级制**。

## 1. PlanDoc / SessionLog（记录在 ServiceInstance）

Agent 的运转不留白：**每一次 PLAN、每完成一次 Session，必须记录文档，记在该 Agent 所属的 ServiceInstance**（docType 见 core_system/doctypes）。

```
systems/<s>/instances/<i>/docs/
  plan-<ts>-<task>.md      # PlanDoc：意图、引用的 TaskScheme/Workflow、dry-run 结果
  session-<ts>-<id>.md     # SessionLog：相位迁移、docsLoaded、动作摘要、outcome、token/耗时
```

- 触发：dsh 会话结束（或每相位迁移——粒度"看实现"，v1 建议**会话级**，相位级列为可选）+ `SessionClosed` Event。
- 写入：走 Apply（存储机制），fieldManager=该 agent——**这是事后留痕，不是逐写审批**。
- 对账：Instance 缺 PlanDoc/SessionLog = drift（Workflow 检查，docType required）。
- 价值：回放（态机可审计）、上下文压缩（下轮会话先读近期 SessionLog 而非全量）、漏读检测（docsLoaded 与 L0 清单比对）。

## 2. AUTOLEVEL 落地

| 级别 | 运行时行为 |
|---|---|
| `ask` | Planning 完成后挂起 → control plugin 发 ApprovalNeeded → 上级 agent（默认上溯 root）批/驳回；对象有 role 挂载时 role 持有者同达（双通道；驳回也产 SessionLog） |
| `auto` | 白名单/Scheme 内直跑；权限系统高危档仍拦（准入与 AUTOLEVEL 正交：级别管"问不问"，权限系统管"许不许"） |
| `all` | 不询问；仅显式授权 + 权限系统放行 |

默认（scheme.yaml runtime.autoLevels）：**RootAgent=ask，ServiceAgent=auto**——均为默认值；**RootAgent 与普通 Agent 同一 AUTOLEVEL 机制，autoLevel 均可配置，Root 也可 auto/all**（A64，all 需显式授权）。升级路径：模型变强 → Desc 调 autoLevel（Apply+权限系统）→ 自治空间变大，机制不变（P8）。

## 3. 子 agent（机器级进程）

- spawn：父进程经 control plugin `spawn machine-instance` 起独立子 agent 进程（一 agent 一进程；明确不省内存，R2）。**子 agent 运行时不限于 dsh**（A60）：dsh / opencode / 自写 agent 均可，选型与其工具环境在该子 agent 引用的 ConnectorOps 中描述或调用。
- 上下文：子 agent 不继承父会话内存；靠 PlanDoc/SessionLog/引用的 ConnectorOps 描述环境与工具。
- 权限：父一次性全量下发（⊆父，只减不增；不做按步骤细粒度裁剪）——上级派任务时把权限 token 与 ref 整包给全；运行时发现缺权限直接 ask 上级，上级重新全量申请并整包重发；直控三原语（dispatch/interrupt/query）全程 ops DB 留痕。

## 4. Skill 缓存（v0.6，A38）

Agent 会话的工具上下文 = Provider.llmPrompt（出厂说明书）+ **Skill**（工具使用处的缓存：注入提示+成功调用示例）。Session 成功调用后自动沉淀 Skill（阈值见 open-questions）；下次同类任务按需注入，不必重学。规则：**Skill 是缓存不是真相**——与 Provider 契约冲突即失效；provider 版本变更默认作废；示例脱敏。console 资源树把 Skill 列为一类节点。


**内置验收 Skill（acceptance-screenshot）**：Provider=`browser-headless`（provider.md 示例，本地工具型）、工具=`chromium-headless`；产出=页面截图 PNG（落 acceptance/shots/loop-<seq>-*.png，gitignore 永不提交）。workflow 验收节点通过 agent 调用该 skill 取证——首次成功调用自动沉淀（注入提示+成功命令示例），Provider 版本变更即失效。截图失败=报告标 unverified，不许手绘替代。
## 5. 检索与简单 RAG（tag + 分页 + 迭代查找）

Session/Doc/TaskScheme 的**历史检索**设计：tag 元数据 + 简单排序检索，不上向量库。

### 5.1 自动打标（更新时，LLM 一次性完成）

- **时机**：Session 关闭（SessionLog 落档时）与 Doc/TaskScheme Apply 后（回归相位），由 LLM 对该对象**自动生成**：`tags[]`（关键 tag）、`importance`（1-5 重要程度）、`digest`（一句话标题+简单描述）——写进对象 metadata（scheme.yaml conventions.tags）；
- 至少做**简单的价值评判 + tag + tag 相关性**（tags 不孤立：相关 tag 组成检索时的派生扩展，如 `build~ci~runner`）；
- 打标失败/超时：对象仍入库，元数据留空 + Event(warn)——检索不到但不阻塞写入；
- 打标提示词与评判标准**可编辑**（随 builtin skill/提示词管理，改提示词=改配置不是改代码）。

### 5.2 检索工具（Agent 可调用，全部分页）

| 工具 | 参数 | 返回 |
|---|---|---|
| `search-sessions` | {tags?, service?, timeRange?, page, pageSize?} | 列表 `[{title, digest, importance, ts, ref}]` + hasMore + relatedTags |
| `search-docs` | 同上（含 DocType 过滤） | 同上 |
| `search-schemes` | 同上 | 同上（TaskScheme/Workflow 模板） |
| `get-object` | {ref} | 按句柄拉全文（第二步，检索列表不给全文） |

- **排序=重要程度 × 时间衰减**（近期+高重要度优先）；
- **默认每页 10 条**（pageSize 可调，上限 50——防一次导入过多）；
- 列表**只有标题+简单描述+元数据**，Agent 选中后 `get-object` 拉全文——分页两层（列表页→全文按需）。

### 5.3 迭代查找（发现不对，继续找）

- **工具层**：返回带 `hasMore` 与 `relatedTags`（当前 tag 的相关 tag），Agent 天然知道"还有下一页、还有相邻 tag"；
- **提示词（builtin skill"查本系统"内置）**：
  1. 先按意图选 1-2 个最贴近的 tag，取第 1 页（10 条）；
  2. **扫 digest 判断是否命中**——命中才拉全文；
  3. 不命中 → **继续翻页或换 relatedTags**（禁止一次拉大量；最多迭代 N 轮，默认 3，超限升级问人/换路径）；
  4. 找到的相关对象随手写 Memory（引用句柄），下次意图直接命中。

### 5.4 索引实现

- tag/重要度元数据存对象 metadata（真相=文档）；**倒排索引物化在 ops DB**（tag→对象表，与 console 树同源，无独立前端状态）；
- 排序/衰减/相关 tag 扩展=引擎内查询逻辑（代码，非 LLM 即兴）；
- 语义检索（向量）**不在本期**：tag+重要度+时间已覆盖"找历史 session/doc"主路径；真要语义再后补索引组件（不改契约）。

## 6. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 记录被 Agent "忘了写" | ⚠️ 中 | dsh 宿主在会话收尾强制生成（框架层，不靠自觉）；缺档=drift |
| 会话级粒度太粗 | ⚠️ 低 | 相位级为可选配置；先粗后细 |
| 进程数增长 | ⚠️ 低（已接受） | R2 明确接受；看门狗回收僵尸 |
| 打标质量不稳定 | ⚠️ 中 | LLM 评判重要度/摘要可能失真 | 提示词可编辑+评判从简（1-5 档）；错标靠迭代查找兜底（§5.3） |
| 检索导入过多 | ⚠️ 低 | 一次拉爆上下文 | 强制分页（默认 10/页，上限 50）+列表不给全文+迭代轮次上限 |
| tag 词表漂移 | ⚠️ 低 | 各 agent 自造 tag 失控 | tag 词表随 service 域管理（global 内置+前缀自治，同 capabilities 思路） |
## 7. 会话活性与停滞处置（KI-003 落地形态）

- **心跳**：会话推进点（相位推进/工具调用完成/产物落盘任一）落 ops（session_heartbeat 行：session/相位/最后动作/ts），watchdog 读最大 ts；
- **watchdog**：装配层定时器（阈值可配，缺省 10m）超时合成 `SessionStalled`（复用合成死信机制；过阶段门 + dedup，同 session 同窗至多一条）；
- **自愈固定顺序**：先注入固定 prompt「继续」（保留上下文，不重启）→ 恢复记 `SessionHealed`；仍无心跳 → 诊断（最后工具调用/日志/等待对象/权限面）→ 权限类产 `ApprovalNeeded` 向上提交；人工类按 bind 默认通道上报（缺省 email，dedup 窗口内至多一封）；长任务类产 `LongTaskRunning`（任务名/已运行/阶段/决策点），结束回收；
- **分工**：外部巡检只做确认与兜底，不代替系统判定；同会话连续自愈无效达阈值（缺省 2）→ 停手升级；
- **判据**：注入停滞 → `SessionStalled` 在账且注入「继续」后恢复；权限阻塞 → `ApprovalNeeded` + 送达；人工 → bind 邮件（dedup 窗口内至多一封）；长任务 → `LongTaskRunning` 且无停滞误报。
