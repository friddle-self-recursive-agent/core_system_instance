---
name: impl-self-recursive-core
docType: ImplDoc
scope: self-recursive-core
ownerRefs: [{kind: ServiceDesc, name: self-recursive-core}]
---
# ImplDoc — self-recursive-core 怎么实现

## how

| Desc 条款 | 实现 |
|---|---|
| Apply 唯一写路径 | cored 内 apply 管线：Policy→SSA合并→乐观锁→git commit+ops DB 双写（runtime/ops-log.md） |
| Event 分发 | 内存队列+dedupKey 聚合+dispatch 表路由；死信告警 |
| Loop 引擎 | cored 内调度器：触发源合并、backoff、预算、Escalate（loop/loop.md 状态机） |
| Scheme | core/scheme.yaml 载入；启动自检野对象 |
| Policy | 规则引擎（声明序求值）+3 条硬规则 |
| ops DB | SQLite WAL（runtime/ops-log.md §2 六表） |

进程结构（v0.7，A39）：**默认 dsh plugin 承接**——core plugin（Apply/Event 分发/Loop 引擎/Scheme/Policy/ops DB）跑在 dsh 宿主内；`igniter` 冷启动三步改为：装载 core/ → 起 dsh 宿主（载入 core plugin）→ 消失；`cored` 保留为冷启动入口与调试用途。

## guarantees（怎么保障）

- 写路径串行（单写者队列）+ resourceVersion 乐观锁 → 并发正确性。
- 每日对账探针（git↔DB↔scheme 三方）→ Goal.A2/A3。
- 心跳：cored→builtinRoot 双向，断则看门狗重启。

## mapping 备注

代码骨架：core_system_workservice 仓 cmd/cored、cmd/igniter、internal/*。骨架期 Status=Drifting（见 instance.yaml）。
