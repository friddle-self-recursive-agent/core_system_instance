# Context 运行时设计 —— 内置 RAG（Tag 核心 / 0–100 全局相关性 / 按 Tag 分片缓存 / 三段式会话与自演化）

> 概念见 [concepts/context.md](../../core_design/concepts/context.md)（R-CTX-1..8）；本文是它的机读落地口径：tag 模型、0–100 全局相关性公式 `Relevance(A,B)`、防同质刷分 Importance 算法（含人类评论因子与独立审核 Agent）、按 Tag 细粒度触发的 `TagCtxShard` 缓存（容量与提取大小双可调）、三段式 Session（侦察段→执行段自复用→异步总结演化段）、按相关性阈值抑制重建、接口面与验收判据。
> 用户裁决（2026-11-26）：**tag 是 RAG 核心**；**全系统分数统一 0–100**（`importance`、`tagRelevance`、`affinity`、`humanScore`、事件 `importance` 与全局相关性函数 `Relevance(A,B) ∈ [0,100]`）；**三段式 Session**（①第一段侦察：预插基础命令+目录 Index，按 Tag 触发 `TagCtxShard` 缓存分片，仅对差量 Tag 拉取 Tag/TagRule/四族/Event/**近期相关 Session**；②第二段执行：**会话自复用保 Prefix KV Cache** + 触发任务缓存 + JIT 增量更新；③第三段总结：**天然异步**，执行提 Proposal / 正向归因补缓存 / 防刷分 Rerank，产出**必须经另一独立审核 Agent 裁决 + 界面人类评论因子**）；**`CtxCache` 容量与单次提取大小均可动态调整**；**`DocApplied` 仅对 `Relevance(UpdatedDoc, B) ≥ rebuildThreshold` 触发重建**（降低关联文档重建雪崩）。

## 1. 目标与不变量

**目标**：把「每轮开工前通读设计文档」从 O(全量) 降到 O(差量 Tag)，保住 LLM Prefix KV Prompt Caching，且通过异步第三段总结实现自递归演化。

不变量（任何实现不得破坏）：

1. **文档权威唯一**：索引/摘要/缓存全是派生物，可丢弃可重建；原文（SQLite `docs DB` 权威 + 定时导出 Git）永远是权威。
2. **第一段侦察零副作用、第三段总结异步且双 Agent 审校**：第一段检索/压缩不写对象；第三段总结异步后台运行，产出的 Rerank / 缓存更新 / Proposal 草案必须经**另一独立审核 Agent（Judge Agent）**裁决通过后才可 Apply。
3. **不漏**：检索为空或索引缺失时必须显式降级（按 path 直读 + 报告标注 `degraded:true`），不得静默返回空。
4. **可审计**：每次 pack 产 `{query, tagSig, shardsHit[], deltaSearched[], chunks[], tokens, provenance}` 记录，可回放命中了哪些 `TagCtxShard`、差量侦察了哪些 Tag。

## 2. Tag 模型与 0–100 统一标度（taxonomy）

### 2.1 Tag / TagType（RAG 核心，统一 0–100 标度）

- **每个 tag 恰好归属一个 tagType**；tagType 与 tag 的**词表无全局数量上限**（开放词表，随打标增长；只增不改名）。
- 初始 tagType 集：`domain` / `mech` / `surface` / `lifecycle` / `doc`。
- **四族对象 + Event + 近期 Session 打同一词表的 tag（分值统一 0–100）**（context.md §1.1）：

| 族 | 载体 | 打标与分值字段（统一 0–100） |
|---|---|---|
| Document | SQLite `docs DB` 与导出 md | `tags`（按 tagType 归组）+ `tagRelevance`（`map<tag, 0-100>`）+ `importance`（`0–100`）+ `humanScore`（`?0–100` 界面人类审核评分）；导出侧车 `<doc>.md.metadatainfo`（R-DOC-6） |
| Scheme | `core/scheme.yaml` 及 `aspect` 分册 | `tags` + `aspect`（单文件单 Scheme，R-DOC-8） |
| Provider | provider 对象声明 | `tags`（能力域） |
| ServiceDesc | `systems/<s>/system.yaml` | `tags`（系统域） |
| Event / Session | `event_log` / `SessionLog` & `ContextNotes` | Event 经 `type→tags` + `importance (0-100)` 入池；近期 Session 经任务 `tagSig` + `ContextNotes` 入池 |

- **数量限制只在会话装配面**：ContextPack 携带的 tag 集 = **每 tagType ≤5 个 tag、总计 ≤20 个 tag**（`ContextPolicy.packLimits` 可配）。

### 2.2 级别（level）与刚性保底

| level | 含义 | 典型文档 | 基准分 / 保底分（0–100） |
|---|---|---|---|
| **L0 宪法** | 不可协商的规则与类型总表 | `core_design rule/`、`core/scheme.yaml`、`principles.md` | 基准 `98` / **刚性保底 `95`**（永不被挤出） |
| **L1 概念** | 终态概念文档（定义/边界/规则） | `concepts/*.md` | 基准 `80` / 保底 `65` |
| **L2 运行时设计** | 实现拓扑与机读契约 | `runtime/*.md`、`acceptance/<主题>/*.md` | 基准 `70` / 保底 `50` |
| **L3 证据** | 验收报告、会话记录、事件聚合 | `SessionLog`、`event_log`、`acceptance/loop-*.md` | 基准 `40` / 保底 `20` |
| **L4 笔记** | 探索结论、临时分析 | `notes/*.md`、`ContextNotes` | 基准 `30` / 保底 `10` |

### 2.3 模块（module）

`doc / scheme / core / apply / agent / session / workflow / connector / provider / event / notification / permission / console / cored / intake / dsh / deploy / storage`。
一篇文章只归一个主模块（`module:` 单值），跨模块关系靠 tag（多值）。

### 2.4 tag 相关度与亲和（0–100 标度）

- **tagRelevance（文档×tag）**：`map<tag, 0-100>`——该文档对每个 tag 的相关度（0–100），检索时参与非对称覆盖计算；由打标产出、第三段 Rerank 更新、人工可改。
- **tag 亲和矩阵（tag↔tag）**：`affinity[tagA][tagB]`（`0–100`），由共现（同文档/同事件/同会话有效引用）统计 + 时间衰减 + 人工钉住三类信号合成，ConnectOps 周期重算，矩阵版本参与缓存键。

### 2.5 现状盘点与拆分建议（实测体量）

| 文档 | 体量 | 建议 |
|---|---|---|
| `runtime/console-adoption.md` | **129KB** | **必拆**：按能力族拆 4 篇（`console-adoption-core` / `-capabilities` / `-workspaces` / `-locked`），原文件保留为目录页（索引 + 链接） |
| `runtime/cored-bridge.md` | **98KB** | **必拆**：按面族拆（`cored-bridge-read` / `-write` / `-apply` / `-events` / `-intake` / `-context`），目录页保留 |
| `concepts/workflow.md` | 36KB | 可拆（执行模型 / 相位机 / 触发与派发 / 证据），拆前先确认引用面 |
| `acceptance/console/console-ui.md` | 36KB | 可拆（§11 整改清单独立成册） |
| 其余 130+ 篇 | ≤24KB | 不拆，按章节 chunk 化即可 |

拆分原则：**拆分只切文件、不切语义**——每篇自带"上级目录页回链"，概念终态不变；拆分后旧锚点（`path#§n`）必须保留重定向表（`docs/redirects.yaml`），否则既有引用全断。

## 3. 索引（DocIndex）

### 3.1 构建

- 输入：SQLite `docs DB`（默认权威）+ 白名单设计仓（`--design-repo` 注册）+ **声明面三族**（Scheme / Provider / ServiceDesc）+ 事件日志（L3）+ **近期相关 Session（`SessionLog` / `ContextNotes`）**；
- 步骤：扫描 → 读 frontmatter/标题结构 → 归一级/模块/标签（缺省 LLM 打标，结果写回系统内部索引，导出 Git 时同步写 `.md.metadatainfo` 侧车）→ 章节切 chunk → 每 chunk 生成摘要 + 归一化 sha → 写索引；声明面按对象行切 chunk（kind/eventType/provider/system/aspect 各一条）；
- 存储：`ops DB` 表 `doc_index / doc_chunks / tag_ctx_shards`（可重建）+ 导出快照 `docs-index.json`（供外部工具只读）；
- 增量与按阈值重建：按文件/对象 blob sha 比对，只重建变化对象自身 chunk；对关联文档与缓存分片，**仅当全局相关性 $\text{Relevance}(D_{\text{updated}}, B) \ge \theta_{\text{rebuild}}$（缺省 75，可配）时才触发关联重建**。

### 3.2 chunk 结构

```yaml
chunk:
  id: "<path>#<anchor>"        # 锚=章节号或标题 slug（对象行=kind/name）
  doc: "<path>"
  level: L0 | L1 | L2 | L3 | L4
  module: "<module>"
  tags: {domain: [event], mech: [dedup]}   # 按 tagType 归组（tag∈唯一 tagType）
  tagRelevance: {dedup: 90, event: 85}     # 统一 0-100 标度
  importance: 85                           # 0-100（文档重要度）
  humanScore: null                         # ?0-100（界面人类评论/审核打分）
  heading: "<章节标题>"
  summary: "<提取式摘要 ≤200 字，带关键约束>"
  keywords: [...]              # 供 BM25
  sha: "<归一化内容 sha>"       # 缓存键成分
  tokens: <int>
  commit: "<构建时 commit / rv>"
```

## 4. 全局相关性公式 `Relevance(A, B) ∈ [0, 100]` 与防刷分 Importance 算法

### 4.1 全局相关性基元 `Relevance(A, B) -> 0..100`

```text
Relevance(A, B) = clamp_0..100(
    0.45 · S_tag(A, B)       # 非对称加权 Tag 覆盖率（Tversky Recall，0-100）
  + 0.20 · S_aff(A, B)       # Tag 亲和矩阵传播（affinity[ta][tb]，0-100）
  + 0.25 · S_kw(A, B)        # BM25 / 标题摘要关键词重合（0-100）
  + 0.10 · S_scope(A, B)     # 同 scope/module/引用链先验（同域=100, global=70, 无关=0）
)
```

- **非对称加权 Tag 覆盖率 $S_{\text{tag}}(A, B)$（取代离散 Cosine）**：
  $$S_{\text{tag}}(A, B) = \frac{\sum_{t \in \text{Tags}(A)} r_A(t) \cdot \min\big(r_A(t), r_B(t)\big)}{\sum_{t \in \text{Tags}(A)} \big(r_A(t)\big)^2} \times 100$$
  衡量「$A$ 需要的 Tag 在多大程度上被 $B$ 覆盖」——当 $B$ 是超集缓存或综合性文档时不会被额外 Tag 稀释分母，彻底解决离散 Cosine $\ge 0.9$ 的高漏判问题。
- **装配排序分 `RankScore(A -> B) -> 0..100`**（仅对 $\text{Relevance}(A, B) \ge 20$ 的候选计算）：
  $$\text{RankScore}(A \to B) = \text{clamp}_{0..100}\Big( 0.70 \cdot \text{Relevance}(A, B) + 0.20 \cdot \text{Importance}(B) + 0.10 \cdot \text{Recency}(B) \Big)$$

### 4.2 防同质任务刷分的 `Importance(B) ∈ [0, 100]` 算法（人类评论因子 + 任务多样性折扣）

```text
Importance(B) = clamp_{Floor(level)..100}(
    α_L · I_base(level) + α_H · I_human(B) + α_E · Δ_emp(B)
)
```

1. **局部与全局解耦**：单领域连续高频命中只更新该域的 `tagRelevance(B, tag)`（0–100），不直接累加全局 `Importance(B)`；
2. **跨任务多样性折扣 $w_{\text{div}}(T_i)$**：当任务序列 $\{T_1, \dots, T_k\}$ 将文档 $B$ 归因为 `used_effective` 时，任务 $T_i$ 对全局 `Importance(B)` 的经验增益必须乘以多样性折扣：
   $$w_{\text{div}}(T_i) = 1 - \max_{j < i} \frac{\text{Relevance}(T_i, T_j)}{100}$$
   若近期 5 个任务相关性很大（如 $\text{Relevance}(T_i, T_j) = 90$），第 2~5 个任务的 $w_{\text{div}} = 0.10$，不会把边缘文档刷上 95–100；只有跨不同领域、彼此低相关的任务共同依赖 $B$ 时，$\Delta_{\text{emp}}(B)$ 才显著上升；
3. **界面人类审核/评论因子 $I_{\text{human}}(B) \in [0, 100]$**：Console 审核界面提供人工评分与评论加减权入口，有值时以高权重（$\alpha_H = 0.60$）锚定重要度；
4. **L0 宪法刚性保底**：L0 文档 `Floor(L0) = 95`，任何经验衰减不得低于保底线。

## 5. 压缩、可调预算与 ContextPack

- **容量与提取大小双可调**：
  - `CtxCache` 存储容量可调：`cachePoolMaxTokens`（默认 500,000）与单 Tag 分片上限 `shardMaxTokens`（默认 6,000）均可动态调整；
  - 会话每次拿到的大小 `takeBudget` 可调：缺省 `min(60000, 0.30 × 模型窗口)`，轻量对话或子查询可动态下调（如 4,000 tokens），复杂重构可上调；
- **tagSig（装配面受限 tag 集）**：pack 头部携带按 tagType 归组的 tag 集（`packLimits`：每 tagType ≤5、总计 ≤20，每个 tag 带权重 `0–100`）；
- **规范定序（保 Prefix KV Prompt Cache）**：注入会话的 `TagCtxShard` 与 chunk 一律按 `tag_type:tag` 字典序排列，且多轮对话**始终复用当前 Session 本身**，保证前缀字节在多轮对话中不发生抖动；
- **ref+hash 引用（每条摘要必备）**：`ref = <repo>/<path>#<anchor>` + `hash = <blob sha>@<commit/rv>`；提供 `expand(ref)` 按需展开原文；
- **loop-next 条目**：loop 轮的 pack 注入 `loop-next.md` 压缩摘要（ref+hash 指向原文）。

## 6. 缓存（按 Tag 细粒度触发 `TagCtxShard` + 三级体系）

| 级 | 键 | 值 | 触发与失效 |
|---|---|---|---|
| L1 chunk 摘要 | `sha(doc blob) + chunk id + extractorVer` | `{summary, keywords, tokens}` | 文件 sha 变化 / extractorVer 升级 |
| **L2a 单 Tag 分片（`TagCtxShard`）** | `tagKey (<tag_type>:<tag>) + indexVer` | 该 Tag 下按 `RankScore` 预排好序的 top chunks（上限 `shardMaxTokens` 可调） | **任一任务含该 Tag 即触发命中**；仅当变更文档与该分片 `Relevance ≥ rebuildThreshold(75)` 时标 stale 并重建 |
| L2b 组合 ContextPack | `canonical(tagSig) + indexVer + policyVer` | 多 Tag 组合 pack | 非对称覆盖率 `TagCoverage(Task, Cache) ≥ 90` 时切片复用 |
| L3 会话上下文 | `sessionId / taskSig + indexVer` | pack + ContextNotes + 轨迹归因 | 会话内多轮对话直接自复用；跨会话按 `Relevance(TaskA, SessionB) ≥ 85` 检索复用 |

- **为什么按 Tag 细粒度触发（`TagCtxShard`）优于整包 Cosine ≥ 0.9**：
  - 整包 Cosine 把 10~20 个 Tag 绑死，两个任务只要差 2 个 Tag 就整包 miss；
  - 切成 `TagCtxShard[tagType:tag]` 后，任务需要 `{domain:workflow, mech:dedup, surface:console}` 时，已有的 `domain:workflow` 和 `mech:dedup` 分片**100% 立即触发缓存命中**，第一段侦察只需查剩下的 `surface:console` 差量！
- **按相关性阈值抑制重建（防写放大雪崩）**：`DocApplied` 发生时，计算 $\text{Relevance}(D_{\text{updated}}, B) \in [0, 100]$——**仅当 $\text{Relevance} \ge \theta_{\text{rebuild}}$（缺省 75，可通过调整相关度算法与阈值控制）时才标 `stale:true` 并触发 `invalidate + prewarm`**。

## 7. 三段式 Session（侦察段 → 执行段自复用 → 异步总结演化段 + 独立 Agent 裁决）

```text
任务/意图触发（workflow 节点 / loop 轮次 / intake / console 会话）
  │
  ├─► 【第一段：获取上下文 Session（侦察段）】
  │      ① 最小底座预插：基础命令使用规范（查询 Skill）+ 顶层目录 Index（Catalog 一句话货架）
  │      ② 按 Tag 触发 CtxCache：解析任务目标 Tag 集
  │         - 命中 TagCtxShard[tag]（或 TagCoverage ≥ 90 的组合缓存）→ 直接按 takeBudget 提取
  │      ③ 差量侦察（仅对未命中/stale 的 Tag 调用检索命令）：
  │         - 拉取完整 Tag 词表与 TagRule（tagType 约束、亲和关系）
  │         - 拉取四族对象（Rule/Doc、Scheme、Provider、ServiceDesc）
  │         - 拉取当前活跃/近期关联 Event
  │         - 拉取【近期相关 Session】（SessionLog / ContextNotes）
  │         - 获取各对象 importance (0-100) 与 Relevance(A, B) (0-100)
  │         → 产出 ContextPack（并将新侦察的 Tag 分片写入 TagCtxShard）
  │
  ├─► 【第二段：任务执行 Session（执行段）】
  │      ① 会话自复用：多轮对话始终复用本 Session（前缀定序不变，保 Prefix KV Cache）
  │      ② 按需触发任务缓存（CtxCache 容量与每次拿到的 takeBudget 均可动态调整）
  │      ③ 动态增量更新（JIT）：中途发现背景不足时再调 context.find/expand 实时更新会话上下文
  │      ④ 记录真实引用轨迹：used_effective / queried_irrelevant / missed_in_phase1
  │      ⑤ 任务完成立即返回响应，并发出 SessionClosed 事件（零主链路等待）
  │
  └─► 【第三段：总结与演化 Session（异步后台段 + 独立审核 Agent 裁决）】
         由 SessionClosed 异步拉起，总结 Agent 产出三项候选草案：
         ① 不合理处提 Proposal（有门槛+先查重）：
            仅当遇到真实阻塞/规则冲突/文档与代码实测不一致（带 ref+hash 证据）时起草；
            提单前先调 Relevance(DraftProposal, ExistingProposals & Docs)，≥ 85 自动合并补充；
         ② 正向归因裁剪（Attribution Pruning）生成/补充记忆缓存：
            - used_effective（实际引用的有效块）→ 提权（+5~+15）入 TagCtxShard 与会话缓存
            - queried_irrelevant（试错证实无关块）→ 从缓存剔除，下调对应 tagRelevance（-5~-10）
            - missed_in_phase1（第一段漏召回、第二段补拉救场块）→ 补打任务 Tag 并高优写入 TagCtxShard
         ③ 防刷分 Rerank：
            局部调 tagRelevance(doc, tag)；全局 Importance(doc) 叠加跨任务多样性折扣 w_div
         ▼
         【独立审核 Agent（Judge Agent）+ 界面人类评论因子（humanScore）裁决闸门】
         - 总结草案不直接 Apply！必须由另一独立审核 Agent 校验归因证据与同质任务相关性；
         - 结合界面审核时的人类评论/评分因子（humanScore 0-100），审核通过后才正式 Apply 落库。
```

## 8. 接口面

### 8.1 cored（读面 + 门控写面）

| 端点 | 说明 |
|---|---|
| `GET /v1/context/index` | 索引状态：`{builtAt, indexVer, docs, chunks, shards, stale[]}` |
| `POST /v1/context/relevance` | `{entityA, entityB}` → `{relevance: 0-100, breakdown: {tagCoverage, affinity, keyword, scopePrior}}`（全局相关性计算端点） |
| `POST /v1/context/find` | `{query, level?, module?, tags?, kinds?, includeRecentSessions?, k?, takeBudget?}` → `chunks[]`（带 `relevance/rankScore/why`） |
| `POST /v1/context/pack` | `{query, tags?, takeBudget?}` → `ContextPack`（优先触发 `TagCtxShard` + 差量装配；`takeBudget` 可动态调整拿到大小） |
| `GET /v1/context/cache` | 缓存条目与 `TagCtxShard` 列表（含 `cachePoolMaxTokens / shardMaxTokens / hits / stale / humanScore`） |
| `PATCH /v1/context/cache/config` | 动态调整 `CtxCache` 容量（`cachePoolMaxTokens / shardMaxTokens / defaultTakeMaxTokens / rebuildThreshold`）（写面门控） |
| `DELETE /v1/context/cache/{key}` | 手动失效该分片/条目（写面门控） |
| `PATCH /v1/context/cache/{key}` | 改 TTL / `expiresAt` / 界面人类审核评分 `humanScore (0-100)`（写面门控） |
| `POST /v1/context/evolution` | 第三段异步总结提交演化草案 `{session, attribution: {usedEffective[], queriedIrrelevant[], missedInPhase1[]}, rerankCandidates[], draftProposals[]}` → 交由独立审核 Agent（Judge Agent）裁决后生效（写面门控） |

权限域：`core/context`（读=所有已认证主体；cache 配置/失效/人类评分/evolution 提交=agent 自身会话、审核 Agent 或 admin）。

### 8.2 Agent 工具（dsh skill）

`context.find(query, opts)` / `context.pack(query, opts)` / `context.expand(ref)` / `context.relevance(a, b)`——由 dsh plugin 注册为工具，支持传入动态 `takeBudget` 与 `includeRecentSessions: true`。

### 8.3 Console session 与对象工作台界面（ctx 面板 + 人类评论因子）

会话页与通用对象工作台 ctx 面板 = `GET /v1/context/cache` + 会话当前 pack：展示 tagSig / 命中的 `TagCtxShard` / chunks(ref+hash) / tokens / 来源 / 命中统计 / stale 徽标；操作：手动失效、改 TTL、**动态调整 `CtxCache` 大小与 `takeBudget` 提取大小**、以及在审核时录入**人类评论/重要度评分因子（`humanScore` 0–100）**。

## 9. ConnectOps 与定时调整

**`connectops-context`**（deploy-system 仓，R-ENG-3）：

| op | 触发 | 动作 | 幂等 |
|---|---|---|---|
| `index` | DocApplied 增量；定时全量 | 扫描→打标（0–100）→chunk→摘要→写索引與 `TagCtxShard` | 是（sha 相等跳过） |
| `affinity` | 定时（缺省 6h） | 共现统计 + 时间衰减 + 人工钉住 → 新矩阵版本（0–100） | 是（同版本不重写） |
| `invalidate` | DocApplied | 计算 `Relevance(UpdatedDoc, B)`，**仅对 `≥ rebuildThreshold(75)` 的分片/文档标 stale 并触发重建** | 是 |
| `prewarm` | 局部失效后 | 重建受影响的高相关 `TagCtxShard` 与 L0/L1 常驻摘要 | 是 |
| `summarize-judge` | `SessionClosed`（异步） | 拉起第三段总结 Agent 产出归因/Rerank/Proposal 草案 → 交独立审核 Agent 裁决后落库 | 是（按 sessionId 幂等） |

## 10. 事件侧（与 context 共用 0–100 因子）

- **代码级去重（既有）**：dedupKey 窗口聚合 + **同因聚合带计数** + **tag 相似抑制**（`Relevance(E_a, E_b) ≥ 阈值`）；
- **type→tags 与 0–100 importance**：`eventTypes` 注册行 `tags: []string` 与 `importance: 0-100`（缺省投影：debug=20 / info=40 / warn=75 / error=90 / fatal=100）；
- **外部控制面事件 vs 业务内部流水事件分离**：业务系统高频交易/账本分录走业务自有代码与自有账本事件；外部控制面事件总线只承接**系统级事件、报警事件、对账失败事件**（event.md 规则 17）；
- **事件与近期 Session 同入索引**：作为第一段侦察的必查源，供拉取「近期关联 Event」与「近期相关 Session」。

## 11. 验收判据（机读）

| # | 判据 | 检查 |
|---|---|---|
| C1 | 索引完整與 0–100 标度 | `docs_total == chunks_docs`；所有 `importance / tagRelevance / affinity / Relevance(A,B)` 均为 `0–100` |
| C2 | 分级与保底 | 每篇有 level/module/tags/tagRelevance/importance/digest；L0 宪法 `importance ≥ 95` 恒成立 |
| C3 | 全局相关性公式 | `POST /v1/context/relevance` 对已知同域/跨域/超集案例返回符合非对称覆盖预期的 `0–100` 分值 |
| C4 | 容量与提取大小双可调 | 调整 `cachePoolMaxTokens / shardMaxTokens / takeBudget` 即时生效，`pack.tokens ≤ takeBudget` |
| C5 | 引用可展开 | 任取 pack/shard 一条 chunk → expand 得到原文片段且 sha（hash）一致 |
| C6 | 按 Tag 细粒度触发缓存 | 两个任务仅共享部分 Tag（如共享 2/4 个 Tag）→ 共享 Tag 的 `TagCtxShard` 100% 命中，第一段仅差量侦察未命中 Tag |
| C7 | 按相关性阈值抑制重建 | 改一篇边缘文档 → 仅 `Relevance ≥ rebuildThreshold(75)` 的缓存分片标 stale 并重建，低相关分片 `stale=false` 零重建 |
| C8 | 会话自复用保 KV Cache | 同一 Session 多轮对话前缀一致、复用本会话上下文，中途可增量触发任务缓存 |
| C9 | 第一段拉取近期 Session | 第一段侦察检索结果包含四族对象 + 近期关联 Event + **近期相关 Session** |
| C10 | 第三段异步总结 + 正向归因 | 第二段结束立即返回；后台异步产出 `used_effective / queried_irrelevant / missed_in_phase1` 归因并补 Tag 入 `TagCtxShard` |
| C11 | 防同质刷分 + 独立 Agent 裁决 + 人类评论因子 | 连续 5 个高相关同质任务（`Relevance=90`）不抬升全局 `importance`（经 $w_{\text{div}}$ 折扣）；总结草案未经独立 Judge Agent 审核不得生效；UI 录入 `humanScore` 后锚定生效 |
| C12 | 提案门槛与先查重 | 无冲突/阻塞证据时不提 Proposal；与既有 Proposal/Doc `Relevance ≥ 85` 时自动合并补充、不重复建单 |
| C13 | 装配面 tag 限制 | 任一 pack 的 tagSig 满足每 tagType ≤5、总计 ≤20 |
| C14 | loop-next 压缩条目 | loop 轮 pack 含 loop-next 摘要，ref+hash 可展开回散文原文 |

## 12. 风险与取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 缓存触发粒度 | **按单 Tag 分片（`TagCtxShard`）+ 非对称覆盖率（Tversky $\ge 90$）** | 取代脆弱的整包 Cosine $\ge 0.9$，单 Tag 粒度最细、最易触发缓存，且支持按 `takeBudget` 灵活切片 |
| 文档更新重建范围 | **按 `Relevance(UpdatedDoc, B) ≥ rebuildThreshold` 阈值过滤** | 靠调整相关度算法分值与阈值降低相关文档重建，阻断写放大雪崩 |
| 总结 Session 执行方式 | **异步后台执行 + 独立审核 Agent 裁决 + 人类评论因子** | 异步执行保证主对话零额外延迟；双 Agent + 人类评论因子 + $w_{\text{div}}$ 多样性折扣根治同质任务刷分通胀 |
| 会话多轮复用 | **复用当前 Session 本身 + 规范化前缀定序** | 保护现代 LLM 的 Prefix KV Prompt Caching |

## 13. 落地顺序（declared-deferred）

1. P0：DocIndex 构建（含四族对象行）+ `context.find`（词法）+ chunk 摘要缓存（无 pack）；
2. P1：`context.pack`（tagSig+ref+hash）+ 两段会话接入 loop/workflow 节点 + 向量复用（cosine≥0.9）+ 主动失效与 stale 提示；
3. P2：ctx 面板（session 界面缓存可视+实效控制）+ affinity 定时重算 + 命中率反馈 + 事件入索引；
4. P3：超大文档拆分（console-adoption / cored-bridge）+ redirects 表。

> 与 loop 队列的关系：本设计不 enable 任何 workflow；实现作为 loop 队列后续增量（KI-003 → R-9 之后插入），且必须先有索引（P0）再谈 pack。
