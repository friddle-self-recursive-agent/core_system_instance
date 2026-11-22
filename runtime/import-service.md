# Runtime — import service 流程

> 与 install-service.md（装新的）对应：**import = 把已经在跑的存量纳入管理**（不动外部，只接进来）。两个分支：系统级纳管（A）/ 编排模板导入（B）。

## 1. 分支 A：系统级 import（外部系统纳管，adopt）

```
用户（console：给 endpoint/线索 / 口头意图）
  → ImportRequested Event ──► 路由 deploy-system Workflow（import 任务态机）
  1. 盘点（只读探测）：connector 探测目标——版本/健康/API 面/依赖
     └─ 探测动作白名单（get/list/描述类），绝不写
  2. 能力匹配：探测结果 ↔ capabilities 词表 ↔ WorkServiceTemplate（mode: adopt）
     ├─ 命中模板 → 走模板的 adopt 段
     └─ 未命中 → 通用六面体骨架 + 人工补 tools 面（提案）
  3. 呈现：探测报告（提供了什么能力/观察到的版本/健康）→ asks 逐项填
     （凭证引用=Provider.auth.secret，永不入库）
  4. 确认：ApprovalNeeded → 人批（纳管即授权 connector 读写范围）
  5. 纳管：建 WorkService 六面体骨架（adopt：跳过安装段，只做注册+验活+版本探测）
     → ConnectorOps 接线 → verify 探针 → Status 起步态=Unknown→Healthy
  6. 对账登记：与既有清单对账（如门户服务注册表 ↔ 实际纳管集），差异报告进 DriftReport
  7. 留痕：ops DB（import 每步一行）+ Event(Imported)
```

规则：
1. **adopt 不动外部**——import 语义=接入观察与受控操作，不重装不改配置（要改走提案）；
2. 探测失败/半探明 → 纳管为 Unknown 态，能力面缺什么如实声明（不伪造 capabilities）；
3. 同一外部系统重复 import → 幂等（已有 WorkService 即 no-op+提示挂靠）。

## 2. 分支 B：编排模板 import（存量编排 → 文档）

```
用户提供既有编排（CI 流水线描述 / 运维脚本 / 任务定义）
  → 渲染器（LLM+结构化解析，按目标 DocType）：
     ├─ 任务编排 → TaskScheme spec（steps/onFailure/budget）
     └─ 循环流程 → Workflow spec（triggers/phases/brakes/dataflow）
  → 渲染预览 = dry-run 展示（渲染结果+差异点）→ 人批（ApprovalNeeded）
  → Apply 入库（origin=imported）→ 首期强制 mode: observe 跑一段 → 再放开 act
```

规则：导入件标 origin；渲染失败=呈现"无法确定性化的部分"清单（哪些是 if-else 业务逻辑，需要人决定拆成声明还是放弃）；不做静默降级。

## 3. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 探测覆盖不全（闭源/无 API） | ⚠️ 中 | 能探多少报多少；Unknown 态如实；页面级系统走门户清单对账兜底 |
| 渲染失真 | ⚠️ 中 | dry-run 预览+origin=imported+首期 observe（runtime/workflow-runtime.md §9） |
| 凭据处理 | ✅ | 全 secret 引用（A40），import 过程不落盘明文 |
