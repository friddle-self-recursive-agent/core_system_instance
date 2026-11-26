# 验收独立性规约（code-audit 探针与被验收 agent 的隔离）

> 目标差距：design-code-gap-2026-11-26.md **G-09「验收运动员兼裁判」**（acceptance.md §8 验收纪律的机械落地）。
> 结构性根因③「自循环自验自过」：同一 agent 写代码 + 浅层 DOM 探针自判 PASS，验收可信度归零。
> 本规约回答三件事：**探针资产的独立性要求、五机械闸与 probes/ 探针的映射、两探针的契约（退出码/机读格式）**。

## 1. 独立性三要求（对齐 acceptance.md §8 收紧）

### 1.1 探针脚本入库 = 审计者不可改

- `acceptance/audit/probes/` 下的探针脚本入 git 后视为**审计资产**：写验收报告的 agent（被验收方）**不得修改探针**；
- 改探针必须走**独立 commit + 理由**（commit message 说明为什么改、影响哪些差距项判据），且不得与被验收代码合并在同一提交；
- 篡改留痕：两探针输出均自带 `script_sha256`（脚本自身哈希），与 git 历史比对即可发现报告用的探针版本与入库版本不一致；
- 探针判定规则（pass/fail/unverified 分级）只随探针 commit 演进，验收报告不得「就地解释」探针结果。

### 1.2 探针输出含环境指纹

每份探针输出的 summary 均含：`tool`/`version`/`node`/`platform`/`release`/`arch`/`hostname`/`cwd`/`utc`/`script_sha256`/`git_head`（能定位仓库根时）/被审对象哈希（`report_sha256` / `db_sha256`）。没有指纹的探针输出视为无效证据——无法回答「哪台机器、哪个版本、哪个对象上跑的」。

### 1.3 PASS 必须附证据路径

- 探针 PASS 不是「没跑出问题」而是「机械断言为零/全绿」，报告引用时必须附**证据路径**（探针 JSONL 输出文件、截图、日志），路径可核（report-audit 对报告内引用的截图路径做盘上存在性检查）；
- 证据不可核 = unverified，不得 PASS；
- 报告里探针结果与探针实际输出不一致（引用了不存在的输出文件）按报告造假处置（acceptance.md §6 风险表第一行）。

## 2. 五机械闸 ↔ 探针映射（perf-lint-baseline.md §3）

| # | 机械闸（perf-lint-baseline.md §3） | 机械载体 | 执行相位 | 状态 |
|---|---|---|---|---|
| 1 | lint 全绿含 max-file-lines | core_design lint 三 checker：metadatainfo / personal-info / max-file-lines | 本地前置 + Verify 相位 | 已落地（checker 在册，回潮即红） |
| 2 | 截图强制：UI 轮无截图 = unverified 不许 PASS | `probes/report-audit.mjs`（R4/R5/R6：UI 类 pass 必须附截图引用、跳过截图话术即拦、引用截图须在盘） | 报告审计（出报告前置） | 已落地（本批，G-10 探针） |
| 3 | 端到端点击链路三断言（按钮→路由→数据成链） | 验收 agent 产三断言脚本；报告侧由 `probes/report-audit.mjs` 校验 pass 项证据非空且可核（R3/R6） | 验收节点 + 报告审计 | 报告侧已落地；断言产器随循环销账（G-12 同批） |
| 4 | 清场断言扩到 ops DB：`l<N>-` 前缀探针对象 + 心跳行 + ApprovalNeeded 孤儿行归零 | `probes/cleanup-audit.mjs`（R3 残留归零 / R4 孤儿引用 / R1·R2·R5 fail-closed） | 清场后、报告前 | 已落地（本批，G-11 探针） |
| 5 | connectops-code-audit 在 Verify 相位强制执行 | workflow Verify 硬 gate（R-TYPE-3 ruleCheck 接线） | Verify 相位 | 待接线（G-12，open → backend+循环） |

映射口径：**1/2/4 今天即可机械执行**（checker + 两探针）；3 的断言产器与 5 的 Verify 接线是循环侧销账项（G-09/G-12），两探针先把「报告能不能被信任」判死。

## 3. 探针契约

两探针共用一套退出码与机读格式；**unverified 是独立结论**（判不准 ≠ 通过），这就是 G-10 的机械形状：无证据 ≠ PASS。

### 3.1 report-audit.mjs（G-10 验收报告审计）

- 输入：一份或多份 `acceptance/loop-<seq>.md` 形态报告（acceptance.md §4 列表形态 + §8 表格形态均可解析）；
- 必检探针清单动态解析自 `acceptance/bugs/bug.md` §3（当前 B1–B14），找不到清单时 fail-closed 判 unverified（不默认放行）；
- 判定规则：R1 无 probes 区→unverified；R2 必检项缺失→unverified；R3 pass 无证据→unverified；R4 UI 类 pass 无截图引用→unverified；R5 证据含「无图像输入/跳过截图」类话术→unverified（loop-77/78/79 反模式）；R6 引用截图不在盘→unverified；R7 状态词不识别→unverified；R8 显式 fail→FAIL；
- 退出码：0=pass / 1=fail / 2=unverified / 3=用法·IO 错误；
- 机读输出：JSON 行（`--json` stdout 或 `--out <file>`），事件类型 `mandatory-source` / `report-audit` / `overall`；人类摘要为缺省输出。

### 3.2 cleanup-audit.mjs（G-11 ops DB 清场断言）

- 输入：ops DB（SQLite）路径；受检表=已知四表（session_heartbeat / approvals / approval_needed / rt_intake_sessions）∪ `--table` 追加 ∪ 按 `/heartbeat|approval/i` 自动发现；
- 残留判定：任一字符串列匹配 `^l[0-9]+-`（loop 探针会话前缀，`--pattern` 可调）的行必须归零，残留行列出（rowid+列+值，上限 `--max-rows`）；
- 孤儿判定（best-effort）：approval 类表 `session_id`/`task_id` 指向不存在活体行 → FAIL；探不到对照表 → skipped（记录在案，不冒充通过）；
- fail-closed：DB 缺失/打不开/schema 无受检表/表读取错误 → unverified，**不得当干净**；
- 驱动：优先 `node:sqlite`，回退 sqlite3 CLI，零 npm 依赖；
- 退出码同 3.1；JSON 行事件类型 `db-tables` / `cleanup-audit`。

### 3.3 自测义务

两探针各带 `--self-test`（内置临时 fixture，不依赖外部文件），改动探针后必须先跑绿再提交；这本身也是审计资产的一部分——探针坏了却无人知道，比没有探针更危险。

## 4. 违规处置

| 情形 | 处置 |
|---|---|
| 被验收 agent 修改探针 | 该轮验收整体 unverified；探针回滚后重跑；改动须审计侧独立 commit 补理由 |
| 探针输出去掉指纹/改为人工转述 | 证据无效，该项 unverified |
| 报告引用不存在的探针输出文件 | 按 acceptance.md §6「报告造假」处置（unverified 标 pass 同罪） |
| 探针 fail 后改探针放行 | 等于改判据：须独立 commit + 差距项判据同步修订，报告重跑全量 |

## 5. 可行性与边界

- 两探针零外部依赖（node 标准库 ± 系统 sqlite3 CLI），在验收节点可内联执行，不需要新部署面；
- 解析器只覆盖 acceptance.md §4/§8 的标准形态；报告格式走样（无 probes 区、状态词手写变体）一律落入 unverified/fail——解析器的保守性是特性不是缺陷；
- orphan 检查依赖活体对照表存在（session_heartbeat / rt_intake_sessions / sessions / tasks 等）；rt_* 表族落地（perf-lint-baseline.md §2）后对照面更完整，探针无需改动（自动发现）。

终态制：本文档只展示最终结果，变更历史只在 git 历史。
