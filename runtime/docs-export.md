# Runtime — 文档库导出（sqlite → git 工作树 → push 远程；2026-11-28 起挂 release 节点）

> 概念依据：core_design R-DOC-7（`rule/rule_doc.md`）：默认 sqlite 权威，git=导出/公开（output/public）。
> **2026-11-28 用户裁决「git提交这个不是功能。删掉功能。做成workflow的一个节点。即gh-release包括git push/release[scheme调用]」**：本文从「常驻定时导出器」修订为「release 域 op 执行机制」——旧 Run 定时拍 / `docs_export_config` 表 / `GET/PUT /v1/docs-export/config` / 控制台导出配置面板**全部退役**；导出=connectops-docs 连接器的 op（git-push / release-publish），workflow 的 gh-release 节点执行时拍一发一。

## 1. 定位

导出是**读侧派生 op**（release 节点执行面），不是写路径也不是常驻任务：它从 sqlite docs DB 取当前对象快照，按 git 布局写工作树，提交并推送远程公开仓。导出失败=op 显式失败（run history `connectops-error` 行留痕），不回滚 sqlite 写、不崩 cored；重试=节点重跑/下一 run。

```
sqlite docs DB（权威）
  → 导出器（只读快照，rv 高水位）
  → git 工作树（既有 layout：kind/scope/name → storage 模板路径）
  → commit（export: <ts> rv=<high-water>）
  → push 远程（public/output；no force-push）
```

## 2. 触发与执行

| 项 | 口径 |
|---|---|
| 触发 | workflow 节点执行（unit=connectops，`connector: connectops-docs`，op=`git-push` / `release-publish`）——节点执行时拍一发一；装配门=env `CORE_SYSTEM_CONNECTOPS_RUN=on` |
| 变更判定 | 读取 `doc` 表高水位；与上次导出水位相同=跳过（零提交零推送，幂等） |
| 并发 | Exporter 互斥锁串行化；导出只读不阻塞写 |
| 手动 | 调试面 `POST /v1/connectops/connectops-docs/git-push`（同源 op） |
| 失败 | op 显式失败（run history `connectops-error` + Note 原文）；不回滚 DB、不改写面 |
| release-publish | 复合发布 op=①git-push ②委托 connectops-gh release-create（params 原样透传；`params.tag` 未声明=release 跳过显式注记不冒充） |

## 3. 导出布局与过滤

沿用 git 布局（**导入导出格式**），不发明第二套：

- 对象路径由 `Scheme.kinds[].storage` 模板决定（`systems/<s>/system.yaml`、`global/agents/<name>.yaml` 等；与 `SeedFromLayout` 同一解析口径）；
- 文件内容=sqlite `doc.content` 原文（逐字节，不重排/不格式化）；
- **导出过滤=scheme.yaml `docTypes` 声明唯一真相源（2026-11-28 用户裁决后零运行期可写口）**：
  - `category: runtime`（或 `exportDefault: false`）的 docType 缺省排除（`BugDoc`、`DriftReport`、`PlanDoc`、`SessionLog` 等运行期文档不入公开快照）；
  - `DefaultExportConfig(scheme)` 派生，无数据库配置表、无读写 API、无控制台面板（均已删）；
- 删除：DB 中不存在（或被过滤排除）的对象，在导出提交中删除；删除只在导出提交中体现；
- 可选附带：`README`/`MANIFEST`——不替代正文；`*.md.metadatainfo` 侧车按 R-DOC-6 随行。

## 4. 提交与推送

| 项 | 口径 |
|---|---|
| 提交消息 | `export: <RFC3339> rv=<high-water> objects=<n>`（固定前缀，便于审计） |
| 空变更 | 零提交零推送（水位相同/无删除） |
| 推送 | 目标 remote/branch 部署侧配置；**no force-push**；认证走部署侧凭据（ssh agent/部署账号，不入库） |
| 冲突 | 远端前进时先 fetch；导出为快照覆盖，冲突=人工介入（不自动 merge 内容）；不得用 `--force` |
| 审计 | 导出日志落部署侧；commit sha 可作为公开快照锚点；**不是逐次写账本** |

## 5. 与写路径/历史的关系

- 写路径：cored → sqlite（唯一权威）；导出器只读，不参与 Apply/权限/事件链。
- 历史：git 历史=周期快照（粗粒度）；逐次正文历史=`doc_history` 待补（R-DOC-7 规则 4）；`GET /v1/rev-content` 在 sqlite 后端 503 诚实降级，导出快照不得冒充逐次历史。
- 导入：`cored --docs <导出根>` 仅空库一次性种子导入（保留 rv）；导出根不是运行时权威。

## 6. 判据（机读）

- 导出前后 DB `(count, max(rv), 对象键集)` 与工作树文件集一致；
- 同一水位重复导出=零提交（幂等）；
- 有变更时产生一个 commit 且远程分支前进；推送失败=非 0 + 告警，DB 与 cored 读面不受影响；
- 导出文件字节=DB `content` 字节（抽样 ≥3 对象，含一个嵌套 scope）；
- 无 secret 值进入导出（秘密库不参与导出）；
- root 的 cored 启动参数无 `--docs-backend git`；导出根可被 `SeedFromLayout` 回放（空库迁移演练通过）。

## 7. 可行性

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 导出/写入并发 | ⚠️中 | 快照与写入交错 | SQLite 读事务一致性快照；导出只读；水位单调 |
| 路径映射漂移 | ⚠️中 | kind storage 模板变化导致旧文件残留 | 导出以当前 Scheme 解析；残留文件在导出提交中删除；迁移需 dry-run |
| 推送冲突 | ⚠️中 | 远端有人/其他任务推进 | fetch 后人工/重试；no force-push；导出为快照语义 |
| 大仓导出耗时 | ⚠️低 | 全量写盘/提交 | 水位无变化跳过；只写变更文件；必要时增量 |
| 导出失败被误当写失败 | ⚠️低 | 运维误判 | 导出独立任务/独立日志；写路径与导出解耦 |
| 快照冒充逐次历史 | ⚠️中 | 用户把 git log 当逐次账本 | 文档/UI 明确标注；doc_history 下一段 |

**结论：可行。导出是只读派生任务，不改变写路径与权限模型；git 回到 output/public 本位。**
