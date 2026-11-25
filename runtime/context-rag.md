# Context 运行时设计 —— 内置 RAG（索引 / 检索 / 压缩 / 缓存 / 背景会话）

> 概念见 [concepts/context.md](../../core_design/concepts/context.md)（10 条设计规则）；本文是它的机读落地口径：索引结构、打分公式、缓存键、接口面、ConnectOps 调度、验收判据。
> 用户裁决（2026-11-25）：索引先行；文档分级别/分模块/打 tag/相关度；动态按上下文调整相关度；**动态调用工具取上下文，不读全量**；内置 RAG；上下文查找做成 **通用接口**；首次调用即检索→提取→压缩→缓存，然后再开任务会话（**任务背景 session**）；会话结束再压缩成 index（同一套因子）；**类型对应缓存（类 Skill）+ 文档更新主动失效**。

## 1. 目标与不变量

**目标**：把「每轮开工前通读设计文档」从 O(全量) 降到 O(相关)，且**质量不降**（有引用可展开、无静默遗漏）。

不变量（任何实现不得破坏）：

1. **文档权威唯一**：索引/摘要/缓存全是派生物，可丢弃可重建；原文（git 仓）永远是权威。
2. **读侧零副作用**：检索/压缩/缓存不写对象、不发事件、不触发 apply（背景会话不做事）。
3. **不漏**：检索为空或索引缺失时必须显式降级（按 path 直读 + 报告标注），不得静默返回空。
4. **可审计**：每次 pack 产 `{query, indexCommit, chunks[], tokens}` 记录，可回放"当时为什么给了这些上下文"。

## 2. 文档分级 / 分模块 / 打标（先做 taxonomy）

### 2.1 级别（level）

| level | 含义 | 典型文档 | 是否常驻（pin） |
|---|---|---|---|
| **L0 宪法** | 不可协商的规则与类型总表 | `rule.md`、`core/scheme.yaml`、`concepts/README.md` | 是（pin 权重最高） |
| **L1 概念** | 终态概念文档（定义/边界/规则） | `concepts/*.md`（24 篇） | 是（按 module 命中） |
| **L2 运行时设计** | 实现拓扑与机读契约 | `runtime/*.md`（21 篇） | 否（按需） |
| **L3 证据** | 验收报告、运行记录（gitignore，永不入公开仓） | `acceptance/loop-*.md` | 否（默认不入索引；冲突排查时按需） |
| **L4 笔记** | 探索结论、临时分析 | `notes/*.md`（新） | 否（TTL 短） |

### 2.2 模块（module）

`doc / scheme / core / apply / agent / session / workflow / connector / provider / event / notification / permission / console / cored / intake / dsh / deploy / storage`。
一篇文章只归一个主模块（`module:` 单值），跨模块关系靠 tag（多值）。

### 2.3 tag 与相关度

- `tags`：多值，粒度到"问题域"（如 `dedup / urgency / cache / retrieval / budget`），不是目录名复述；
- `importance`：1–5（沿用 `conventions.tags`），决定 pin 权重与通知优先级；
- `digest`：一句话（检索列表展示 + 关键词回退）；
- **tag 亲和矩阵**：`affinity[tagA][tagB]`（0–1），由共现（同文档/同事件/同 pack 命中）统计 + 时间衰减 + 人工钉住三类信号合成，ConnectOps 周期重算。

### 2.4 现状盘点与拆分建议（实测体量）

| 文档 | 体量 | 建议 |
|---|---|---|
| `runtime/console-adoption.md` | **129KB** | **必拆**：按能力族拆 4 篇（`console-adoption-core` / `-capabilities` / `-workspaces` / `-locked`），原文件保留为目录页（索引 + 链接） |
| `runtime/cored-bridge.md` | **98KB** | **必拆**：按面族拆（`cored-bridge-read` / `-write` / `-apply` / `-events` / `-intake` / `-context`），目录页保留 |
| `concepts/workflow.md` | 36KB | 可拆（执行模型 / 相位机 / 触发与派发 / 证据），拆前先确认引用面 |
| `runtime/console-ui.md` | 36KB | 可拆（§11 整改清单独立成册） |
| 其余 135 篇 | ≤24KB | 不拆，按章节 chunk 化即可 |

拆分原则：**拆分只切文件、不切语义**——每篇自带"上级目录页回链"，概念终态不变；拆分后旧锚点（`path#§n`）必须保留重定向表（`docs/redirects.yaml`），否则既有引用全断。

## 3. 索引（DocIndex）

### 3.1 构建

- 输入：白名单仓（`--design-repo` 注册）+ `docs/` 根 + 事件日志（L3）；
- 步骤：扫描 → 读 frontmatter/标题结构 → 归一级/模块/标签（缺省 LLM 打标，结果写回文档 `metadata`）→ 章节切 chunk → 每 chunk 生成摘要 + 归一化 sha → 写索引；
- 存储：`ops DB` 表 `doc_index / doc_chunks`（可重建）+ 导出快照 `docs-index.json`（供外部工具只读）；
- 增量：按文件 blob sha 比对，只重建变化文件；commit 级全量重建作为兜底（每 N 小时或手动）。

### 3.2 chunk 结构

```yaml
chunk:
  id: "<path>#<anchor>"        # 锚=章节号或标题 slug
  doc: "<path>"
  level: L1 | L2 | ...
  module: "<module>"
  tags: [...]
  heading: "<章节标题>"
  summary: "<提取式摘要 ≤200 字，带关键约束>"
  keywords: [...]              # 供 BM25
  sha: "<归一化内容 sha>"       # 缓存键成分
  tokens: <int>
  commit: "<构建时 commit>"
```

## 4. 检索与打分

```text
score(chunk) = w_tag·tagOverlap + w_aff·affinity(tags_q, tags_c)
             + w_kw·bm25(query, chunk) + w_rec·recency(commit_at)
             + w_pin·pinWeight(level, importance)
             + w_prior·prior(module/kinds)
```

- **上下文先验 `prior`**：来自任务对象——`kinds`（如 Workflow/ConnectorOps）、`module`（当前改动目录）、最近 N 个 commit 触及的路径、未决事件 tag；
- **recency**：`exp(-Δdays/τ)`，τ=ContextPolicy.recency.halfLifeDays；
- **affinity**：`Σ affinity[qa][cb] / |tags_q|`，矩阵版本号参与缓存键；
- **pin**：L0=1.0，L1=0.6×importance/5，L2=0.3，L3=0（默认排除）；
- **过滤**：scope（global/builtin/systems/<s>）、level、module 可硬过滤；
- **返回**：Top-K chunk（K 由预算反推），每条带 `why`（命中原因）便于审计。

**上下文感知的动态调整**：权重不是每次都一样——`prior` 命中 console 模块时 `w_prior` 临时上调（策略表可配），事件驱动的任务（如 KI 修复）把 `tag` 权重上调；所有调整记录在 pack 记录的 `weightProfile` 字段。

## 5. 压缩与 ContextPack

- 预算：`budget = min(maxTokens, ratio × 模型窗口)`；缺省 ratio=0.3、maxTokens=60000；
- 压缩算法（首发）：**分段摘要（map）→ 去重合并（reduce）**；每段 ≤ 200 字 + 一句"为什么相关"；原文超长时取"标题 + 规则条目 + 结论段"；
- 引用：每段必须带 `path#anchor` 与 `commit`；pack 提供 `expand(ref)` 能力（按需取原文片段，受同一权限域约束）；
- 保底：压缩后仍超预算 → 按 score 截断并在 pack 中标注 `truncated: true`（不静默丢）。

## 6. 缓存（类 Skill）

**两级缓存**（沿用 Skill 的 `cachePolicy` 纪律）：

| 级 | 键 | 值 | 失效 |
|---|---|---|---|
| L1 chunk 摘要 | `sha(doc blob) + chunk id + extractorVer` | `{summary, keywords, tokens}` | 文件 sha 变化 / extractorVer 升级 |
| L2 ContextPack | `querySig(canonical) + indexCommit + policyVer + affinityVer` | 完整 pack | indexCommit/policy/affinity 任一变化 |
| L0 打标结果 | `sha(doc) + taggerVer` | `{level, module, tags, importance, digest}` | 文件变化 / 人工覆盖 |

- **主动失效**：`DocApplied`（设计文档面）→ 失效该文件全部 chunk + 引用它的 pack；仓 commit 同理（watch）；**失效后可选预热**（后台重建该文件的 chunk 摘要）；
- **TTL/LRU**：pack TTL 7d；chunk 摘要随 index 代清理；旧代（旧 indexCommit）整批回收；
- **命中统计**：每次 pack 记录 `hit/miss/wasted`（被注入但主会话未引用的 chunk），作为因子调参的反馈信号。

## 7. 背景会话（任务背景 session）

```text
任务触发（workflow 节点 / loop 轮次 / intake）
  → ① 后台会话：index.ensure()（增量）→ pack(query=任务摘要, budget)
  → ② 写 pack 缓存（同 query 复用）
  → ③ 主会话启动：system 注入 pack（含引用清单）
  → ④ 主会话执行（可再调 context.find 做 JIT 补充）
  → ⑤ 会话结束：compress(sessionLog) → ContextNotes
       → 回写：用到/未用到的 chunk 统计、缺失的文档（"需要但没有"清单）
       → 可选：把 Notes 入 L4 索引（TTL 短，不进公开仓）
```

- 背景会话失败（索引不可用/LLM 不可用）→ 降级：按 `module` 硬过滤取"目录页 + 相关概念页"前 3 篇原文节选，pack 标注 `degraded: true`；
- 背景会话**不产生副作用**、不写代码、不发事件（除 `ContextPackBuilt` 诊断事件，debug 级默认不入库）。

## 8. 接口面

### 8.1 cored（读面；写面不需要）

| 端点 | 说明 |
|---|---|
| `GET /v1/context/index` | 索引状态：`{builtAt, indexCommit, docs, chunks, stale[]}` |
| `POST /v1/context/find` | `{query, level?, module?, tags?, kinds?, k?, budget?}` → `chunks[]`（带 score/why） |
| `POST /v1/context/pack` | `{query, budget?}` → `ContextPack`（含 citations、cacheKey、degraded） |
| `GET /v1/context/pack/{cacheKey}` | 取缓存 pack（只读） |
| `POST /v1/context/notes` | 会话结束压缩回写（`{session, notes, usedChunks[], missing[]}`）——**写面门控**（与 apply 写面同口径） |

权限域：`core/context`（读=所有已认证主体；notes 回写=agent 自身会话或 admin）。

### 8.2 Agent 工具（dsh skill）

`context.find(query, opts)` / `context.pack(query, opts)` / `context.expand(ref)`——由 dsh plugin 注册为工具，凭据与服务端 cored 通信（浏览器零凭据）。

## 9. ConnectOps 与定时调整

**`connectops-context`**（deploy-system 仓，R-ENG-3）：

| op | 触发 | 动作 | 幂等 |
|---|---|---|---|
| `index` | commit/DocApplied 增量；定时全量 | 扫描→打标→chunk→摘要→写索引 | 是（sha 相等跳过） |
| `affinity` | 定时（缺省 6h） | 共现统计 + 时间衰减 + 人工钉住 → 新矩阵版本 | 是（同版本不重写） |
| `invalidate` | DocApplied/commit | 失效 chunk/pack 缓存 | 是 |
| `prewarm` | 索引更新后 | 重建常驻（L0/L1）chunk 摘要 | 是 |
| `evaluate` | 每日 | 用历史 pack 命中率回归，产出因子调整建议（不自动应用） | 是 |

调度：cored 内建调度（`--context-*` 旗标，缺省关断）；或 systemd timer 调 CLI——两者同一代码路径，缺省不改既有行为。

## 10. 事件侧（与 context 共用因子）

- **代码级去重（既有）**：dedupKey 窗口聚合不变；扩展=**同因聚合带计数**（窗口内重复只留一条 + `count`）与 **debug 不入库**；
- **type→tags**：`eventTypes` 注册行增可选 `tags: []string` 与 `importance: 1-5`（缺省由 `defaultLevel` 投影）；
- **urgency**：`urgency = f(level, importance, recency)`，用于通知排序与检索加权，不改变路由判定；
- **事件入索引**：event_log 的聚合视图进 DocIndex（L3，默认不常驻），任务上下文可检索"最近相关事件"。

## 11. 验收判据（机读）

| # | 判据 | 检查 |
|---|---|---|
| C1 | 索引完整 | `docs_total == chunks_docs`；stale=0 |
| C2 | 分级齐全 | 每篇有 level/module/tags/importance/digest；缺失=告警非阻断 |
| C3 | 检索命中 | 给定 10 个已知问题（如"dedup 窗口""coreded 写面门控"）→ top-3 命中正确文档 |
| C4 | 预算 | pack.tokens ≤ budget；超限必须 `truncated:true` |
| C5 | 引用可展开 | 任取 pack 一条 chunk → expand 得到原文片段且 sha 一致 |
| C6 | 缓存命中 | 同 query 二次调用命中 L2（`cache=hit`），文档变更后 miss |
| C7 | 主动失效 | 改一篇文档 → 引用它的 pack 失效（不返回旧摘要） |
| C8 | 零副作用 | 检索/压缩全程不产生对象写/事件（除 debug） |
| C9 | 降级可见 | 索引不可用 → `degraded:true` + 按 path 直读，不返回空 |
| C10 | 亲和重算 | 同输入同版本幂等；因子可在 ContextPolicy 调整并生效 |

## 12. 风险与取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 向量 vs 词法 | **首发词法（tag+BM25）**，向量可选 | 零外部依赖、可解释、可离线；向量留接口 |
| 全量 vs 迁移 | 现有 139 篇不强制迁移 | 缺字段=告警，ConnectOps 逐步补标 |
| 拆文档 vs 章节检索 | 先做章节检索，**超大文档再拆** | 拆分有引用断链成本，检索先行 |
| 跨轮 state | 维持 `loop-next.md` 散文 | 用户裁决："我觉得 ok" |

## 13. 落地顺序（declared-deferred）

1. P0：DocIndex 构建 + `context.find`（词法）+ chunk 摘要缓存（无 pack）；
2. P1：`context.pack` + 背景会话接入 loop/workflow 节点 + 主动失效；
3. P2：affinity 定时重算 + 命中率反馈 + 事件入索引；
4. P3：超大文档拆分（console-adoption / cored-bridge）+ redirects 表。

> 与 loop 队列的关系：本设计不 enable 任何 workflow；实现作为 loop 队列后续增量（KI-003 → R-9 之后插入），且必须先有索引（P0）再谈 pack。
