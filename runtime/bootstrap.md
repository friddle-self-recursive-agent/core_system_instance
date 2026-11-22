# 自举（Bootstrap）设计

> 原稿未面对的硬前提（A10）："文档管理一切，谁管理第一批文档？" 本文件给出冷启动顺序与点火器边界。

## 1. 鸡生蛋问题

- Core 读文档才能工作 ← 文档要 Apply 才存在 ← Apply 是 Core 的接口 ← Core 要先工作。
- builtinRoot 管理一切 Agent ← builtinRoot 是 Agent ← Agent 定义是文档 ← …
- 结论：**纯文档无法自举**，必须存在一个文档之外的最小起点（P9 承认的例外）。这与 k8s 一致：kubelet/kubeadm 也是文档（manifest）之外的二进制。

## 2. 点火器（Igniter）

一个刻意极小的可执行程序，职责只有三步：

```
1. 校验并装载首版 core/（Scheme + core.desc + 默认权限规则 + builtinRoot Agent 定义）
2. 启动 Core 进程（Workflow 引擎随之启动）
3. 消失（不常驻；健康由常驻的 builtinRoot 接管）
```

设计约束（防点火器膨胀成第二个系统）：

- 不读任何自然语言文档、不做任何判断、无配置（路径写死约定）；
- **代码质量要求：单个文件不超过 800 行**——超了就分模块开发（质量约束，不是总行数预算）；
- **首版 core/ 与其他 system 走同一流程**：没有"唯一一批人审文档"的特殊通道——定义变更一样由 AI 改、经 Apply+权限系统，git 记录留痕。

## 2.1 内置组件（builtin 集合与 operator，1-N）

冷启动装载的 builtin 集合（**必须内置，缺一不可**）：

| builtin | 内容 |
|---|---|
| `core_system`（self-recursive-core） | **最小 workflow 本身，带 event**——引擎+事件队列的最小闭环 |
| `core_developer_system` | 研发系统（onedev 纳管 + 本地 build） |
| `core_deploy_system` | 部署系统（当前机器执行器） |
| `core_storage_system` | 存储系统（本地 git + NAS + OSS） |

core_system 可使用的**内置 operator**——**operator 就是 ConnectorOps**（concepts/connector.md，既有概念，非新物）：三个 builtin ConnectorOps 实例，默认就是当前机器；**core_system → operator 是 1-N，不是 1-1**（一个系统挂多个 ops）：

| operator（=ConnectorOps 实例） | 职责 | 默认实现 | 第三方路径 |
|---|---|---|---|
| `core_docs_operator` | docs 文档管理 | **默认 git**：默认有 git、基于 git 管理（串行写+轮询） | 后续可用 mongodb/pg——以 **service 方式**管理接入（换后端实现，op 契约不变） |
| `core_event_operator` | 事件队列 | 默认内置（本地队列）；**kafka 用不用还在两可**，不预设 | kafka 作分发通道时经 Notification channel（runtime/event-bus.md） |
| `core_metrics_operator` | 内部服务监控 | 基本就是 ps / docker 看看（进程与容器级探针） | 观测栈接入走 WorkService 纳管 |

三者都随 builtin 代码自带（concepts/builtin.md：内置=代码和 connector 内置），Core 用它们跑最小闭环；换实现=换 ConnectorOps 指向，接口契约不变。

## 3. 冷启动后的接管链

```
Igniter → Core(+Scheme) → Workflow引擎 → builtinRoot（第一个被拉起的 Agent）
        → builtinRoot 对账：校验文档库自洽（无野对象、owner 链闭合）
        → 按 core.desc 拉起其余 Builtin 成员 → 常态运转
```

builtinRoot 的常驻看护：进程级看门狗（Igniter 留下的最小监督进程或 systemd/容器重启策略）负责"Core 死了拉起"；builtinRoot 负责"文档层的一切生死"。看门狗不读文档、不可远程触发——攻击面刻意为零。

## 4. 升级与恢复

| 场景 | 路径 |
|---|---|
| Core 升级 | 新 Core 就绪检查通过 → 切换 → 旧退场；失败自动回退上一代（core.desc 的 git 历史） |
| 文档库损坏 | git 层恢复（远端/备份，Rule 声明）；Core 重启自检报告差异 |
| builtinRoot 定义被改坏 | 看门狗持有的定义快照（Igniter 写入时留存）兜底拉起；告警 |
| 全灭 | Igniter 重跑（冷启动幂等：检测已有 core/ 则只做校验不覆盖） |

## 5. 与 P9（最小自举）的对照清单

| 文档之外的存在 | 大小约束 | 被什么管 |
|---|---|---|
| Igniter | 无常驻；单文件 ≤800 行的质量约束 | git 版本；首版定义同其他 system 流程（AI 改） |
| 看门狗 | 重启策略级 | 部署层（systemd/k8s） |
| 权限系统硬规则 | 3 条，随二进制 | 发版流程 |
| 其余一切 | — | 文档面 + Workflow |

除上表外，任何"文档之外的状态"出现即违宪（架构反模式）。

## 6. 可行性

**结论：可行，但必须诚实承认 Igniter 与看门狗的存在。** 原稿"一切皆文档"的表述在自举边界上不成立，本设计把例外显式化、预算化、可审计化——这比假装没有例外安全得多。

| 风险 | 等级 | 缓解 |
|---|---|---|
| Igniter 膨胀 | ⚠️ 中 | CI 检查单文件行数（>800 即红）+ 分模块拆分 |
| 看门狗单点 | ⚠️ 低 | 其职责仅"重启进程"，失效面极小；可双实例 |
| 首版 core/ 定义错误 | ⚠️ 低 | 与其他 system 同流程（AI 改+权限系统+git 留痕）+ Igniter 结构校验 |
