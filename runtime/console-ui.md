# 运行时设计 3：总控 Plugin 界面（R1.5.1 / R1.5.2）

> 宿主：dsh 的 console 插件（R1.5.1"dsh 后有总控 Plugin 界面"）。**v0.7 起 console 即 Core 的默认界面**（A39）；单独的 Core 界面暂缓，做通畅后再做。形态 v1=TUI，v2=Web（同一插件双渲染）。

## 第一层：资源视角（R1.5.1）

**以资源为第一视角**：Scheme 注册的每一种 Kind/DocType 都是树上的一等节点，全部可逐个点进去；所有资源相关的（被引用、引用别人、归属、状态）都必须能点进去跳转。

```
▸ ServiceDesc        (3)   ← 数量=该类型对象数
▸ ServiceInstance    (2)
▸ Agent              (2)   ── 点入: builtinRoot ── 关联跳转: 子agent/Bind/Loop/最近任务
▸ WorkService        (1)   ── onedev ── 跳转: Connector/Ref/Credential/相关DriftReport
▸ Connector  ▸ Ref  ▸ Bind  ▸ Credential  ▸ Loop  ▸ Policy
▸ TaskScheme         (5)   ── build-and-verify ── 跳转: 触发Event/步骤所用Connector/最近执行
▸ WorkServiceTemplate(2)
▸ Plugin             (4)
▸ Docs（按 DocType 分组：Goal/Rule/Metrics/ImplDoc/DriftReport/...）
```

对象详情页固定区：`yaml 声明` / `Status+Conditions` / `关系图`（owner↔owned、refs、binds、finalizers，全部可点） / `相关事件` / `最近 DriftReport`。

硬性验收：**界面上出现的任何资源标识符都必须可点**；点不到即 UI drift（console 插件自检项）。

## 第二层：信息流视角（R1.5.2）

监控、状态、数据事件的流式聚合视图：

```
[对象/Selector 过滤条]
时间线（三泳道可混排）:
  Event 流      ExternalChanged / MetricThreshold / ApprovalNeeded / Install...
  状态变迁      phase/conditions 跳变（含 reason）
  数据事件      Metrics 阈值越线、产物入库（digest）、同步完成
右侧: 聚合面板（driftOpen、审批积压、死信率、Loop 成功率、token/预算消耗）
```

两层互通：资源页看"它的事件流"；信息流页点任一条跳"相关对象"。

## 审批与 install 入口

- ApprovalNeeded 列表（Bind 命中的待审项，SLA 倒计时）→ console 内批准/驳回（=Apply）。
- install service 命令入口（触发 InstallRequested → install-service.md 流程，模板发现结果在 UI 呈现 asks）。

## 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| TUI 表达力（树+泳道+跳转） | ⚠️ 中 | v1 用成熟 TUI 框架；渲染数据全部来自 Scheme+ops DB（无独立前端状态，避免双源） |
| 全量可点的关系图成本 | ⚠️ 低 | 关系来自 ownerRefs/refs 元数据，Core 已有索引 |
