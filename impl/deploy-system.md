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
| 纳管登记 | postInstall → 经 Apply 建 WorkService 对象 + finalizer 自动注入（finalizer.md 规则1） |

## guarantees

- 安装幂等：同模板重装=no-op（先 get 后 apply）。
- 失败回滚：undo 序列执行，超时 Escalate 到 Bind 人；墓碑对象观测面常亮。
- 全程审计：install 每步一行 ops DB。

## mapping 备注

deploy-system 自己不装自己（bootstrap 负责）；它管的第一个真实安装建议是 prometheus-template（观测面）。
