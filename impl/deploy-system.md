---
name: impl-deploy-system
docType: ImplDoc
scope: builtin-deploy-system
ownerRefs: [{kind: ServiceDesc, name: builtin-deploy-system}]
---
# ImplDoc — builtin-deploy-system 怎么实现

## how

| Desc 条款 | 实现 |
|---|---|
| 当前机器执行器 | dsh `exec-local` 插件：命令白名单模板 + 工作目录隔离（每安装一个独立 workdir） |
| install 流程 | runtime/install-service.md 全文；TaskScheme `install` 模板渲染 WorkServiceTemplate.install 段 |
| 三段 undo | 镜像（删）/配置（还原 workdir 快照）/服务（stop+disable）；actionLog 落盘可续跑 |
| 纳管登记 | postInstall → 经 Apply 建 WorkService 六面体骨架（A53）；外部清理职责写入 tools 成对 cleanup op（A51） |

## guarantees

- 安装幂等：同模板重装=no-op（先 get 后 apply）。
- 失败回滚：undo 序列执行，超时 Escalate 到挂载 role 的人；墓碑对象观测面常亮。
- 全程审计：install 每步一行 ops DB。

## mapping 备注

deploy-system 自己不装自己（bootstrap 负责）；它管的第一个真实安装建议是 prometheus-template（观测面）。

## 5. 部署渠道矩阵（R14.8.3：每一个业务不同）

deploy-system 不内置任何"业务怎么部署"的知识；每个业务的部署方式是其 ServiceDesc 的 **DeployDesign.envs 声明**，deploy-system 只持有渠道 ConnectorOps 并集并按业务 Instance 裁剪授权（规则不写死，A36/A59）。**渠道=workflow 节点的 service+connectorOps 绑定（同一通用抽象，见 impl/developer-system.md §0）**：

| 渠道类 | 载体（泛化） | ops（幂等契约） | 适用业务形态 |
|---|---|---|---|
| kube | 承载业务的集群（受限部署 SA） | get/patch deployment（比较后写+server-side dryRun）、rollout-status、pod-logs、events-watch | 集群上的业务 |
| ssh-host | 入口宿主 SSH | docker ps/inspect/restart、compose up（比较后写）、容器健康探针 | 宿主 docker 上的基础设施类业务 |
| scm-ci | 既有 SCM/CI（build-status 回写、gate-status 抽查、产物登记） | 同左 | 已有 buildspec 的业务：构建发布走自家管道，deploy-system 只做门禁与状态投影 |

判定规则（边界决策树）：业务的 DeployDesign 声明渠道引用（Ref，resolve{system,type,params}）→ deploy-system 按 Ref 调 ConnectorOps → 渠道实现可以换（换=改 Ref 指向，不改业务声明）。
**具体渠道实例（sybran 侧：公司集群受限 SA、入口宿主、公司 SCM（OneDev，地址不公开）渠道）落 `sybran-developer-system` 仓 `docs/deploy-channels.md`（private）——builtin 本体零部署锚点（2026-11-26 用户裁决：sybran 内容出公开仓）**。

## 6. 可行性（渠道项，补 §6 原表）

| 项 | 评级 | 说明 | 缓解 |
|---|---|---|---|
| kube 渠道 | ⚠️ | 受限 SA 上界（无 create/delete）；patch 幂等可保证；分批+健康门槛进 DeployDesign | 实测契约在 private 仓维护 |
| ssh-host 渠道 | ⚠️ | 宿主容器命名不统一，每业务一个"容器名+健康命令"声明；SSH 断链=Event(warn) | — |
| scm-ci 渠道 | ✅ | 只读+回写，无破坏面（OneDev 实测契约见 private 仓） | — |
| 跨渠道一致验收 | ⚠️ | 各渠道健康判据不同 → 每业务 VerifyDoc.probes 自带探针，验收统一走 Verifying 相位而非渠道内置 | — |
