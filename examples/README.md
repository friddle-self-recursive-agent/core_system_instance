# 示例：developer-system

演示 layout.md 的完整用法（文件均为示意片段）：

```
examples/
├── developer-system/
│   ├── system.yaml                       # ServiceDesc 元数据（按能力引用外部）
│   ├── goal.md                           # Goal：intent + 可验收 acceptance
│   └── instances/ci/
│       ├── instance.yaml                 # Instance + Status（机器回写区）
│       └── docs/impl.md                  # ImplDoc：声明→实现对照
└── workservices/gitlab-prod/
    └── workservice.yaml                  # 外部系统在册（能力/驱动/凭证引用）
```

配合 [loop/loop.md §5](../loop/loop.md) 的十步走查，可以完整看到：一次 gitlab runner 变更如何变成 Event → 触发 Loop → Agent 按 Goal.acceptance 与 Rule 对账 → 经 Connector 修复 → Status 追平 → 观测面汇总。
