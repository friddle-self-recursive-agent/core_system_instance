# Runtime — 文档库导出（sqlite → git 工作树 → push 远程）

> 概念依据：core_design R-DOC-7（`rule/rule_doc.md`）：默认 sqlite 权威，git=导出/公开（output/public）。本文只定义导出任务的运行时口径；实际频率/远端/凭据属部署侧（R-PUB-2，不入公开仓）。

## 1. 定位

导出是**读侧派生任务**，不是写路径：它从 sqlite docs DB 取当前对象快照，按 git 布局写工作树，提交并推送远程公开仓。导出失败不回滚 sqlite 写，也不阻塞 cored；下一次重试或人工触发即可。

```
sqlite docs DB（权威）
  → 导出器（只读快照，rv 高水位）
  → git 工作树（既有 layout：kind/scope/name → storage 模板路径）
  → commit（export: <ts> rv=<high-water>）
  → push 远程（public/output；no force-push）
```

## 2. 触发与调度

| 项 | 口径 |
|---|---|
| 调度 | 部署侧 systemd timer / cron；缺省建议 10m 一次（可配），另提供手动命令 |
| 变更判定 | 读取 `doc` 表 `(kind,scope,name,resource_version,updated_at)` 高水位；与上次导出水位相同=跳过（零提交） |
| 并发 | 导出用 SQLite 读事务取一致性快照；cored 写入不阻塞导出，导出不阻塞写 |
| 手动 | 运维命令/`corectl export`（下一段；v1 先由部署脚本承担） |
| 失败 | 告警日志 + 非 0 退出；不回滚 DB、不改写面；下次重试 |

## 3. 导出布局与独立导出配置（数据库驱动，默认不导出运行时文档）

沿用 git 布局（**导入导出格式**），不发明第二套：

- 对象路径由 `Scheme.kinds[].storage` 模板决定（`systems/<s>/system.yaml`、`global/agents/<name>.yaml` 等；与 `SeedFromLayout` 同一解析口径）；
- 文件内容=sqlite `doc.content` 原文（逐字节，不重排/不格式化）；
- **文档导出是一个单独的数据库配置项目（`docs_export_config` 表，绝不在 Go 代码中硬编码过滤）**：
  - `scheme.yaml` 的 `docTypes[]` 声明 `category: design|runtime` 与 `exportDefault: true|false`（其中运行期文档 `BugDoc`、`DriftReport`、`PlanDoc`、`SessionLog` 声明为 `category: runtime, exportDefault: false`）；
  - sqlite docs DB 维护独立的 `docs_export_config` 配置表（首次启动从 `scheme.docTypes[].exportDefault` 派生种子初值：`include_runtime_docs=false`、`exclude_doc_types=["BugDoc","DriftReport","PlanDoc","SessionLog"]`）；
  - 暴露 `GET /v1/docs-export/config` 与 `PUT /v1/docs-export/config` 读写接口，并在控制台提供独立「文档导出配置」面板供用户随时开关是否导出 `BugDoc` 等运行时文档；
  - `Exporter.enumerate()` 在每次导出拍动态读取数据库中的 `docs_export_config` 过滤文档，不写死任何 `docType` 字符串；
- 删除：DB 中不存在（或被导出配置排除）的对象，在导出工作树中删除（`git rm`）；删除只在导出提交中体现；
- 可选附带：`README`/`MANIFEST`（rv 高水位、导出时刻、对象计数）——不替代正文；`*.md.metadatainfo` 侧车按 R-DOC-6 随行（若导出范围含设计文档仓）。

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
