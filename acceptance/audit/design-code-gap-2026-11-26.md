---
name: design-code-gap-audit
docType: Acceptance
scope: core_system
ownerRefs: [{kind: ServiceDesc, name: core_system}]
---
# 设计↔实现差距审计·探针基线（2026-11-26 全量重构批）

> 出处：2026-11-26 用户视角全站走查 + 代码审核产出的 18 点差距清单。本文档是**机读探针基线**：
> 每项带 `判据`（机械可验），后续 workflow/code-audit 循环逐项销账；修复以 commit 号回填 `状态` 列。
> 四大结构性根因：①装配缺口（声明了没接线）②接口先占位（返回空/假数据）③自循环自验自过（运动员兼裁判）④文档收口先于实现收口。

## 一、P0（安全/正确性/活体断裂）

| # | 差距 | 设计出处 | 代码差距 | 判据（机械） | 仓 | 状态 |
|---|---|---|---|---|---|---|
| G-01 | 运行态投影仅内存 | R-DOC-7 sqlite 权威 / RuntimeStore 设计 | RunLog/WakeLog/DeliveryLog/findings 重启即失 | 重启 cored 后 `GET /v1/runs`、findings 仍在（sqlite rt_* 表可查） | fixed @c0489ef（engine-runtime 19b97c2 合 main：rt_* 六投影写穿透+--runtime-store 缺省 sqlite+5 round-trip 恢复单测+真实例活体）| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |
| G-02 | /v1/stream 缺失，前端 N+1 轮询风暴 | console v2 §11 / DeepSeek harness WS patch 范式 | console-live.js 每 15s 发 50–80 请求；docContent 每轮清空无视 resourceVersion | ①`GET /v1/snapshot`+`GET /v1/stream`（RFC6902 patch+seq）活体；②前端稳态 <5 请求/分钟（net log 计数） | fixed @7aa7e46（端点）+@e2e5eca（web 客户端 BASES 注入+dist 入库）+plugin @566bd37（wsproxy Origin 重写）——CT116 活体：浏览器「实时（WS patch）」灯+patch seq=1（RFC6902）+mtime 版本击穿 NPM 缓存 @e933ca9| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |
| G-03 | connectops {op} 路由无权限检查 | 权限门契约（subject 三段必须 check） | connectops_face.go POST /v1/connectops/{name}/{op} 解析 subject 后未 check 即 Invoke | 无效 subject POST 该路由 → 403（fail-closed） | fixed @300d374（WithPerm+403 机械锚）+@9d78b52（cored permSys 注入接线）——活体：匿名 publish 403 拒| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |
| G-04 | sessionliveness 数据竞争 | 并发安全基线 | Beat() 无锁读 prevStalled；SetSelfHealBridge 解锁后写 SelfHealV/SelfHeal；僵尸心跳 map 永不 GC；Escalated 会话每轮重发事件 | `go test -race ./internal/sessionliveness/` 全绿 + GC 探针（陈旧心跳 30m 后消失） | fixed @5f1e91b（eb28098 合 main：四竞态修+EntryTTL GC+幕级去重，-race -count=2 绿）| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |
| G-05 | plugin 读代理 fail-open | 安全默认 fail-closed | readRequestBody UTF-8 跨 chunk 断裂/无 error·aborted 处理/溢出返回 ''→JSON.parse('{}') 静默通过；`if (opts.reject)` 分支反向 | ①截断 body→400 非 400 静默通过；②溢出→413；③reject 语义单测 fail-closed | plugin | fixed @14ee395（plugin thin-adapter，已合 plugin main d7f5d1d） |
| G-06 | 插件管道/监听器泄漏 | 资源生命周期契约 | stdout/stderr 管道不排空（64KB 死锁）；早退泄漏 3 桥监听器；autoSpawn 缺 serviceProjectsRoot 第 5 参 | waitForReady 后长输出子进程不死锁；早退路径 disposer 断言；autoSpawn 分支 console 路由齐 5 参 | plugin | fixed @14ee395（plugin thin-adapter，已合 plugin main d7f5d1d） |
| G-07 | contextidx 阈值配置断线 + 分片失效缺删路径 | R-CTX-5/6 阈值 env 可调、删文档即失效 | New() 硬编码 75，ThresholdFromEnv() 生产零调用；删除不 Invalidate shard | env REBUILD_THRESHOLD=50 时 /v1/context/index 行为变化（日志或 stale 计数）；删除文档后 find 不再命中 | fixed @5f1e91b（ThresholdFromEnv 生产接线+env 翻转测试）| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |
| G-08 | 事件详情↔最近 loop↔session 链断裂 | R-UX-3/4 可观测链 | 事件页只挂内存假 run #1(Analyzing)；Task done 无真实 sessionId 回填；`#/session/<taskId>` 报不在清单 | event 详情含最近真实 RunRecord+session 深链可达；`GET /v1/loop/current` 返回活体 loop+sessionId | fixed @58a868a（loop/current 补 run·agentSession 回填链+events/{id} 顶层平铺）+@c0489ef（session_receipt done 迁移+回填+export.go）——活体：/v1/events/{id} 全字段+wake 关联、#/event 深链渲染| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |

## 二、P1（验收可信度/契约完整性）

| # | 差距 | 设计出处 | 代码差距 | 判据（机械） | 仓 | 状态 |
|---|---|---|---|---|---|---|
| G-09 | 验收运动员兼裁判 | acceptance.md §8 验收纪律 | 同 Agent 写代码+浅层 DOM 探针自判 PASS | code-audit 强制进 workflow Verify（R-TYPE-3 ruleCheck 接线）；验收报告附独立探针证据 | fixed @c0489ef（verifygate 两阶段硬 gate+ruleChecks 现读+lint-json 桥）——独立探针面 @3fa99bc；循环侧首轮销账验证进行中| open → backend+循环销账 |
| G-10 | 截图必选被跳过未标 unverified | acceptance.md §8 | loop-77/78/79 以「无图像输入」跳过截图仍记 PASS | 无截图的必选探针必须记 unverified（探针解析器断言） | probes 落地 @3fa99bc（report-audit fail-closed 八规则，实报 loop-78 判 UNVERIFIED 实证）——循环侧应用进行中| open |
| G-11 | 清场不扫 ops DB | P-02 清场契约 | 清场只删 core-docs 文件；session_heartbeat l57-probe/l58-*、approvals l60-*/l76 死账残留 | 清场探针含 SQLite DELETE 断言（ops DB 三表计数归零） | probes 落地 @3fa99bc（cleanup-audit ops DB 死账断言 8/8 自测）——循环侧应用进行中| open |
| G-12 | R-TYPE-3 Verify 接线缺失 | rule_type.md ruleChecks 三行 | connectops-code-audit 未挂入 workflow Verify 硬 gate | 触发 R-PUB-1 违规样例 → Verify 阶段 findings 非空且 run 卡 Verify | fixed @c0489ef（Verify 阶段 connectops-code-audit 硬 gate：findings 非空卡 Verify+Escalate）——循环侧实战验证进行中| open → backend+循环 |
| G-13 | RunRecord 卡 Analyzing | workflow 引擎相位机 | --advance-interval 未启用，advances:0 永不推进 | RunRecord advances 随 tick 增长；相位机走过 Analyzing→…→终态 | fixed @c0489ef（--advance-interval 缺省 30s+全相位路径单测+活体 advances 0→2）| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |
| G-14 | 会话上下文查看/编辑缺失 | R-UX-3 用户明确要求 | #/chat、#/session 只显静态正则抠取声明+200 字截断 Trajectory | 会话页可读 ContextPack/TagCtxShard/takeBudget 且可编辑分叉（前后端契约面） | fixed @d42644e（GET/PUT /v1/sessions/{id}/context+revert 快照栈+web sessionctx.js）——活体：#/session/:id 上下文卡全渲染+编辑分叉表单（截图留证 2026-11-26）| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |

## 三、P2（性能/工程化）

| # | 差距 | 设计出处 | 代码差距 | 判据（机械） | 仓 | 状态 |
|---|---|---|---|---|---|---|
| G-15 | sqlite 仓库层串行+全量解析 | docs-storage-sqlite 性能 | SetMaxOpenConns(1) 全串行；List() SELECT 全量 content+逐行 YAML 解析 | WAL 模式+连接池>1；List 元数据面不带 content（行数/时延对比记录） | fixed @58a868a（WAL+池 4+ListMeta 零 content+三读面切元数据）| in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |
| G-16 | 巨石文件三座 | R-ENG-7 ≤800 硬红线 | console-app.js 6672/server.go 1850/index.ts 1863 | `lint/max-file-lines.sh` 三仓全绿（豁免清单仅过渡期 client/） | fixed：index.ts @14ee395；server.go @945816c；git.go @9d78b52（606+gitdoc 394）；cored/intake/opslog/trigger_test/corectl 五巨石 @c0489ef；console-app.js 过渡期豁免在册| plugin/index.ts fixed @14ee395；server.go fixed @945816c（wip 已合 main）；console-app.js 过渡期豁免（.max-file-lines-allowlist 在册） |
| G-17 | 前端手写库缺位 | 统一库裁决 | marked/dompurify/js-yaml/diff/fast-json-patch 全手写简化版 | package.json 五依赖在册且被 import（esbuild 构建产物可查） | workservice(web) | fixed @5e7a967（web/ 五库，已合 workservice main 0fc8f64） |
| G-18 | repository 分片/无效化与 rebuildThreshold 语义偏差 | R-CTX-5 | 同 G-07 的仓库侧：删除/重命名文档不触发分片失效 | 删文档 → contextidx find 立即不命中（无需等 rebuild） | workservice | in-progress → 分区 agent（faces-routes/engine-runtime/ctx-liveness/session-ctx） |

## 四、销账协议

1. **修复回填**：每项修复合入 main 后，在本表 `状态` 列回填 commit 号+日期（如 `fixed @abc1234 2026-11-26`）。
2. **机械判据即探针**：循环 code-audit 对每条 open 项跑 `判据` 列的探针；探针脚本落 `acceptance/audit/probes/`，输出 PASS/FAIL/unverified（无证据=unverified，不得 PASS——对齐 acceptance.md §8 收紧）。
3. **全清定义**：18 项状态列无 open + 探针全 PASS（或明确裁决豁免并注明），本文件按 R-DOC-10 转 git rm。
4. **根因处置**：四大根因对应四道工序——装配缺口→接线清单逐条核；接口先占位→face 契约测试；自验自过→G-09 独立探针；文档先收口→每概念收口前必带实现 commit 引用。
5. **探针资产现状（2026-11-26）**：`probes/report-audit.mjs`（G-10 报告审计）与 `probes/cleanup-audit.mjs`（G-11 ops DB 清场断言）已入库，均带 `--self-test` 自测、fail-closed、JSON 行输出+环境指纹；独立性要求与五机械闸映射见 [independence.md](independence.md)。探针为审计资产：被验收方不得修改探针，改探针须独立 commit+理由。

## 五、与本次重构批的关系

- 本批四 agent 分支直接销账：G-01/02（runtimestore+WS）、G-05/06（薄 adapter）、G-16（三仓拆分）、G-17（统一库）、G-08/G-13（events-id+loop-current+相位推进）、G-03/04/07/15（backend 修复面）。
- 循环侧销账：G-09/10/11/12（验收收紧+Verify 接线验证），在恢复自循环后首轮 workflow 执行。
