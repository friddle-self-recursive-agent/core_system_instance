# core_system_instance — ServiceInstance 侧（实现形式）

> 本仓是 [core_system](https://github.com/friddle-self-recursive-agent/core_system)（根 ServiceDesc）的 **ServiceInstance**：回答"Desc 说的每一条，我具体怎么实现、怎么保障"，以及大部分设计文档与可行性报告（R1.1、R1.6）。代码在 [core_system_workservice](https://github.com/friddle-self-recursive-agent/core_system_workservice)。

## 对应关系（ImplDoc 视角）

| Desc（core_system 仓） | 本仓 ImplDoc | 代码 |
|---|---|---|
| systems/builtin/self-recursive-core | [impl/self-recursive-core.md](impl/self-recursive-core.md) | workservice: cmd/cored, cmd/igniter |
| systems/builtin/developer-system | [impl/developer-system.md](impl/developer-system.md)（**首个设计对象**：如何利用 onedev/如何开发/如何满足循环） | workservice: connectors/onedev-driver |
| systems/builtin/deploy-system | [impl/deploy-system.md](impl/deploy-system.md) | workservice: plugins/exec-local |
| systems/builtin/storage-system | [impl/storage-system.md](impl/storage-system.md)（NAS+OSS） | workservice: connectors/gitfs, nas, oss |
| （无独立 Desc：core-workflow 系 Workflow 实例，A56） | [impl/feedback-workflow.md](impl/feedback-workflow.md)（反馈修复闭环：报错→agent→提议→批准→pull→发布→验收） | —（设计，未开工） |
| （挂 deploy-system，A58） | [impl/kube-inner-integration.md](impl/kube-inner-integration.md)（内网集群纳管 + 页面功能模块划分） | —（设计，未开工） |
| systems/builtin/user-system | [impl/user-system.md](impl/user-system.md)（接入 LDAP 认证+目录同步 / 飞书账号映射，A59） | —（设计，未开工） |
| （挂 deploy-system：部署渠道矩阵） | [impl/deploy-system.md](impl/deploy-system.md) §5-6（kube / ssh-host / onedev-ci 三渠道，每业务 DeployDesign 声明） | —（设计，未开工） |

## 运行时设计与验收基线（R1.2 / R1.4 / R1.5）

| 文档 | 内容 |
|---|---|
| [acceptance/README.md](acceptance/README.md) | 验收目录分层：根=运行时报告（不入库）；`<主题>/`=设计/验收基线（入库） |
| [runtime/execution-model.md](runtime/execution-model.md) | 四层执行：用户意图→Agent→Scheme→代码；基础调度可配置 |
| [runtime/dsh-plugin.md](runtime/dsh-plugin.md) | dsh 基础 agent、root 直控通道、Plugin 首批四件 |
| [acceptance/console/console-ui.md](acceptance/console/console-ui.md) | 总控界面设计与验收基线：资源视角第一层 / 信息流视角第二层 / 服务关注区 + v2 Web 界面定稿 + §14 关注报告×工作台 |
| [runtime/console-adoption.md](runtime/console-adoption.md) | console v2 落地盘点：线上实测现状 / 环境阻塞（trusted-host·代理超时·token 轮换）/ 逐页功能与 UI 建议 / E0–E7 落地顺序 |
| [runtime/agent-session.md](runtime/agent-session.md) | Agent Plan/Session 记录制（PlanDoc/SessionLog）+ AUTOLEVEL 默认（R2） |
| [runtime/ops-log.md](runtime/ops-log.md) | sqlite docs DB 管文档内容 + DB 管 ops 历史操作流水（三库分工/审计） |
| [runtime/docs-export.md](runtime/docs-export.md) | 文档库导出：sqlite→git 工作树→commit→push（output/public；快照非逐次历史） |
| [runtime/install-service.md](runtime/install-service.md) | install 流程：GitHub org 找 template→WorkServiceTemplate→询问→安装 |
| [runtime/agent-pool-machine.md](runtime/agent-pool-machine.md) | agent_pool 机器与双 dsh profile 分工（core-system 自举 / kube-inner 接入） |
| [runtime/event-bus.md](runtime/event-bus.md) | 内置 Event 分发扩展：Kafka 总线（通知用，非真相源）+ 飞书通知到账号（A59） |
| [runtime/cross-agent.md](runtime/cross-agent.md) | dsh 跨 agent 调用（ctx.agents / typert 网关）+ 跨 Agent 协议 v0.1（ConnectorOps agent-comm：最小信封+四原语） |

## 其他

- [runtime/workflow-runtime.md](runtime/workflow-runtime.md)：Workflow 引擎运行时（管线/编辑/展示/数据流/落地 agent）
- [runtime/agent-service-protocol.md](runtime/agent-service-protocol.md)：Agent↔Service 沟通协议（意图 envelope / catalog 预插入 / 一意图一 session / 记忆即文档）
- [runtime/import-service.md](runtime/import-service.md)：import 流程（存量系统纳管 adopt / 编排模板导入）
- [runtime/delete-service.md](runtime/delete-service.md)：delete 流程（级联预览→人批→停依赖→断引用→目录删除→tools cleanup）
- [runtime/builtin-flows.md](runtime/builtin-flows.md)：内置能力流程总表（研发/发布/备份/认证/事件/指标/workflow 生命周期）
- [runtime/bootstrap.md](runtime/bootstrap.md)：自举（bootstrap）设计
- [layout.md](layout.md)：目录即对象规范（文档库物理布局）
- [feasibility.md](feasibility.md)：可行性报告（含 onedev / NAS+OSS / dsh / sqlite 专项，R1.6 指定放本仓）
- [examples/](examples/)：developer-system 走查示例

## MVP：dsh-core-agent（第一版可运行形态）

第一版最小自循环，跑在一台内网机器（内网 DNS `<内网域名>`）：

| 文档 | 内容 |
|---|---|
| [mvp/design.md](mvp/design.md) | 支持生成 Goal 的最小自循环设计（Goal 生成三来源+四规则、core-workflow-mvp 态机、M1–M5 验收） |
| [mvp/architecture.md](mvp/architecture.md) | 架构：dsh 宿主+core plugin 拓扑、部署、目录、tick 数据流、LLM、Console API |
| [mvp/scheme.yaml](mvp/scheme.yaml) | 实现侧 scheme 子集：dsh-core-agent 装载并自检的类型注册（core/scheme.yaml 的可运行裁剪） |
| [mvp/concept-audit.md](mvp/concept-audit.md) | 概念符合性审计：P1–P10 流转判定 + kinds/docTypes/events 对照 + 审计修复清单（基于运行证据，2026-11-20） |

## 本仓自身的规矩

- 本仓只放"实现形式"（How + 证据 + 可行性）；**意图变更回 core_system 仓改 Desc**（P6：不允许在 Instance 侧私改意图）。
- 每份 ImplDoc 有 mapping 段（Desc 条款→实现），Desc 变更后由 Workflow 对账此处是否过期（文档过期=drift）。
- instance.yaml 汇聚 Status（机器写区，见下）。
