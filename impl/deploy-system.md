---
name: impl-deploy-system
docType: ImplDoc
scope: builtin-deploy-system
ownerRefs: [{kind: ServiceDesc, name: builtin-deploy-system}]
---
# ImplDoc — builtin-deploy-system 怎么实现（本地启动）

> 2026-11-27 用户裁定：**builtin deploy 就是本地启动**——装在本机、启停本机服务、本机回滚。多渠道（集群/宿主/CI）=workflow 节点绑定变体（部署侧事），不是本 builtin 的一部分；本体零部署锚点。

## how

| Desc 条款 | 实现 |
|---|---|
| 本地启动执行器（当前机器） | dsh `exec-local` 插件：命令白名单模板 + 工作目录隔离（每安装一个独立 workdir） |
| install 流程 | runtime/install-service.md 全文；TaskScheme `install` 模板渲染 Template.install 段 |
| 三段 undo | 镜像（删）/配置（还原 workdir 快照）/服务（stop+disable）；actionLog 落盘可续跑 |
| 纳管登记 | postInstall → 经 Apply 建 WorkService 六面体骨架；外部清理职责写入 tools 成对 cleanup op |

## guarantees

- 安装幂等：同模板重装=no-op（先 get 后 apply）。
- 失败回滚：undo 序列执行，超时 Escalate 到挂载 role 的人；墓碑对象观测面常亮。
- 全程审计：install 每步一行 ops DB。

## mapping 备注

deploy-system 自己不装自己（bootstrap 负责）；它管的第一个真实安装建议是 prometheus-template（观测面）。

## 5. 渠道=部署侧变体（非内置）

builtin 本体只有本地启动。多渠道是 workflow 节点绑定变体的应用（同一通用抽象，见 impl/developer-system.md §0）：业务的部署方式=其 ServiceDesc 的 **DeployDesign.envs 声明**，deploy-system 按 Ref 调 ConnectorOps，渠道实现可换（换=改 Ref 指向，不改业务声明）。渠道类型词表（泛化机制，供部署侧变体绑定）：

| 渠道类 | 载体（泛化） | ops（幂等契约） | 适用业务形态 |
|---|---|---|---|
| 本地（builtin 缺省） | 本机 exec-local | start/stop/restart、workdir 快照还原、健康命令 | 本机服务 |
| kube | 承载业务的集群（受限部署 SA） | get/patch deployment（比较后写+server-side dryRun）、rollout-status、pod-logs、events-watch | 集群上的业务 |
| ssh-host | 入口宿主 SSH | docker ps/inspect/restart、compose up（比较后写）、容器健康探针 | 宿主 docker 上的基础设施类业务 |
| scm-ci | 既有 SCM/CI（build-status 回写、gate-status 抽查、产物登记） | 同左 | 已有 buildspec 的业务：构建发布走自家管道，deploy-system 只做门禁与状态投影 |

**具体渠道绑定值与实测契约=部署侧实例仓（私域，不入公开仓）——builtin 本体零部署锚点。**

## 6. 可行性（渠道项）

| 项 | 评级 | 说明 | 缓解 |
|---|---|---|---|
| 本地启动（builtin） | ✅ | exec-local 白名单+workdir 隔离已有实现形态；undo 三段纯本机 | — |
| kube 渠道 | ⚠️ | 受限 SA 上界（无 create/delete）；patch 幂等可保证；分批+健康门槛进 DeployDesign | 实测契约在部署侧实例仓维护 |
| ssh-host 渠道 | ⚠️ | 宿主容器命名不统一，每业务一个"容器名+健康命令"声明；SSH 断链=Event(warn) | — |
| scm-ci 渠道 | ✅ | 只读+回写，无破坏面 | 实测契约在部署侧实例仓维护 |
| 跨渠道一致验收 | ⚠️ | 各渠道健康判据不同 → 每业务 VerifyDoc.probes 自带探针，验收统一走 Verifying 相位而非渠道内置 | — |
