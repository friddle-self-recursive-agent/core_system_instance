# Runtime — perf/lint 基线与验收收紧（perf-lint-baseline）

> 概念依据：core_design rule/rule_eng.md R-ENG-7（单文件 ≤800 行硬上限）、core_design concepts/engineering.md（lint 族基线/读侧高性能/统一 library/RuntimeStore 建议）、runtime/cored-bridge.md、runtime/acceptance.md。本文回答三件事：**R-ENG-7 与工程化建议落到两个代码仓的清单、RuntimeStore 在 cored 的落地形态、验收机械门怎么收紧堵「自验自过」**。机制描述不含部署锚点（真实路径经环境/配置注入，R-PUB-1/2）。

## 1. 落地映射

### 1.1 R-ENG-7 → 两代码仓

| 仓 | 拆分清单（单文件 >800 行即拆） |
|---|---|
| workservice（Go） | `cmd/cored` 与 `internal/{scheme,apiserver,apply,...}` 按职责拆文件/子包：路由注册、face 投影、装配（assembly）、存储驱动、触发骨架各自成文件；单文件超限按单一职责拆出，命名可寻址、重构零语义变化 |
| plugin（TS/JS） | `plugin/src` 按「模块/屏」拆（loader / screen* / bridge* / console-obj 六片等），CSS 按组件域拆；单文件超限拆模块，行为零变化 |

checker 接线：core_design `lint/max-file-lines.sh`（type=lint，R-ENG-7）对两仓 tracked 代码文件全量受检——受检集合=`git ls-files`（新增文件默认受检、无需登记），豁免仅 `dist/` 构建输出与 lockfile；两仓 CI/Verify 相位与本地 npm test/go test 前置统一挂该脚本——回潮即红（engineering.md §1）。

### 1.2 engineering.md §2 四条 → cored/plugin 落点

| 建议 | cored 落点 | plugin/console 落点 |
|---|---|---|
| ① 读面聚合 | 新端点 `GET /v1/snapshot`：一次拉回 kinds+对象索引+inbox/runs/tasks/sessions 摘要（§2.4 预告） | 首屏/工作台改走 snapshot 聚合面，替代逐对象 N+1 轮询 |
| ② 增量推送 | 新端点 `GET /v1/stream`（WebSocket）：连上推快照，变更推 JSON Patch（RFC 6902）增量 | 订阅 patch 增量渲染，替代 15s 全量轮询；断线回退轮询 |
| ③ SQLite 读侧 | WAL 模式读写分离；列表投影 SELECT 不取 content 列；索引 `(kind, scope)` 与 `(type, ts)` | — |
| ④ 前端缓存 | — | 按 resourceVersion 对象级缓存（rv 不变不重渲染）；`document.hidden` 暂停轮询；虚拟滚动保留 |

统一 library 迁移（engineering.md §3）随同段落位：markdown 渲染=marked+dompurify、YAML=js-yaml、diff=diff、JSON Patch=fast-json-patch、WebSocket 后端=coder/websocket；plugin 内自写解析器（正则拆 YAML/自写 markdown 渲染）一律迁移到库，红线=行为零变化+XSS 白名单不放松。

## 2. RuntimeStore 落地形态

### 2.1 rt_* 表族 schema 草案

六表，字段=对应内存结构体字段直投（不另造投影词形），均含 `created_at`：

| 表 | 承载（内存结构体字段直投） |
|---|---|
| `rt_trigger_records` | 触发留痕：seq/eventId/type/dedupKey/source/involved/route/cc/for/owner/execution 投影字段 |
| `rt_run_records` | 对账 run 投影：锚（workflow/route/eventId）/phase/status/involved/startedAt/溯源字段 |
| `rt_delivery_records` | 送达受理投影：通道/origin/status（accepted→sent/failed）/溯源字段 |
| `rt_wake_records` | agent 唤醒投影：agent 锚/origin/溯源字段 |
| `rt_dispatch_records` | 派单受理投影：seq/agent/status/autoLevel/action/kind/approval/spawn/nodes 等载荷键 |
| `rt_intake_sessions` | intake 会话：sessionId/phase/lastAction/taskName/longTask/heartbeats/lastBeat |

### 2.2 驱动注册表与装配旗标

- **Store interface + 驱动注册表**：各表 put/list/restore 口接口化；驱动两枚起步——`sqlite`（生产缺省）/`memory`（进程内存语义+测试假体）；未来可插 Postgres/MySQL/Redis，上层语义不变（engineering.md §4）。
- **装配旗标**：`--runtime-store sqlite|memory`；**缺省 sqlite 当 `--ops-db` 给定**（持久化部署显式传路径才落盘，缺省内存语义不变）；rt_* 表族建在 ops DB 同库（独立 runtime DB 可选，非缺省路径）；幂等建表随代码版本走（R-ENG-2）。

### 2.3 重启恢复语义

启动时**全量装载** rt_* 表族→内存投影（整表替换、确定性）；装载失败=启动拒绝（投影宁拒不降级）。恢复是**投影重建不是账本重放**：账本=event_log/apply_log 不动（审计权威），rt_*=活体投影、可重建、不承担账本职责——与「观测面非账本」口径兼容（ops-log.md §2；dispatch 面既有口径「进程内环有界、重启归零=幂等重入不重复派单」由 rt_* 装载承接后语义不变：恢复的是投影视图，不重放派发动作）。

### 2.4 cored-bridge.md §2 契约增量预告

新端点**载荷词形先占位，待实现随行补记**进 §2 读面表（「读面扩展轮随行补记词形」范式维持）：

| 端点 | 占位 |
|---|---|
| `GET /v1/snapshot` | 聚合快照面：kinds+对象索引+inbox/runs/tasks/sessions 摘要一次投影（载荷词形待实现随行补记；只读 GET 恒开，非 GET=405） |
| `GET /v1/stream`（WebSocket） | 快照+JSON Patch（RFC 6902）增量下发（升级握手与 patch 词形待实现随行补记） |
| `GET /v1/events/{id}` | 单事件详情面（载荷词形待实现随行补记；与 `GET /v1/events` 归档查询面同源分立） |

## 3. 验收判据收紧（堵「自验自过」）

验收报告机械门新增（Verify 相位前置；任一不满足=该项 unverified 不许 PASS）：

1. **lint 全绿含 max-file-lines**：metadatainfo/personal-info/max-file-lines 三 checker 全 exit 0，才可出 PASS。
2. **截图强制**：UI 轮无截图=该项 unverified 不许 PASS（截图是视觉验证凭据，DOM 断言不替代）。报告侧机械断言已落地：`acceptance/audit/probes/report-audit.mjs`（UI 类 pass 无截图引用/「无图像输入」类豁免话术/截图不在盘 → 强制 unverified，见 acceptance/audit/independence.md §2）。
3. **端到端点击链路探针**：点按钮→路由跳转→数据出现 **三断言成链**，不许只测 DOM 节点存在。
4. **清场断言扩到 ops DB**：`l<N>-` 前缀探针对象+心跳行+ApprovalNeeded 孤儿行归零（清场不只清文档面，DB 侧残留同样算脏）。机械断言已落地：`acceptance/audit/probes/cleanup-audit.mjs`（残留正则 `^l[0-9]+-` 归零+approval 孤儿引用+fail-closed：库打不开/无受检表=unverified 不当干净）。
5. **connectops-code-audit 在 Verify 相位强制执行**并作为出报告前置门（R-TYPE-3：unbound/非空 error findings=不出报告，显式失败不静默放行）。五闸与探针资产的总映射表见 `acceptance/audit/independence.md` §2。

## 4. 可行性与风险

| 项 | 评级 | 说明 / 缓解 |
|---|---|---|
| R-ENG-7 两仓拆分 | ✅ 可行 | 机械可判（checker 已在册）；风险=拆分引入语义漂移→拆分零行为变化红线+回归测试前置 |
| `/v1/snapshot` 聚合面 | ✅ 可行 | 读侧派生聚合、零写路径、零新机制；载荷演进=新键代际判别器既有惯例 |
| `/v1/stream` WS patch | ⚠️ 有条件可行 | 断线重连/降级路径需显式声明（断线回退轮询）；coder/websocket 成熟库兜底（engineering.md §3） |
| SQLite 读侧优化 | ✅ 可行 | WAL/投影瘦身/索引=经典工程解；列表不取 content 与既有瘦身载荷口径一致 |
| rt_* 表族落地 | ✅ 可行 | 结构体直投零翻译层；SQLite WAL 单写者既有模式复用；memory 驱动保缺省语义不变 |
| 验收机械门收紧 | ✅ 可行 | 五条全机械可判；成本=UI 轮须留截图与三断言脚本、Verify 相位接 connectops-code-audit |

终态制：本文档只展示最终结果，变更历史只在 git 历史（runtime/acceptance.md、git log）。
