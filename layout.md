# 目录结构规范（v1：文件夹即存储）

> 原稿："现在没有系统。但是默认就按文件夹保存这些文档"。本规范把目录定为 v1 的存储层：**目录即 scope，文件即对象**。Core 封装 Repository 接口，未来换真数据库时，本布局降级为导入/导出格式。

## 1. 顶层布局

```
<repo>/
├── core/                                # Builtin scope（控制面自描述）
│   ├── scheme.yaml                      # Scheme（类型注册 + dispatch 表）
│   ├── builtin.policy.yaml              # Builtin 成员 + 强制文档类型
│   ├── default.policy.yaml              # 默认准入 Policy
│   ├── core.desc.yaml                   # Core 自身 ServiceDesc
│   └── docs/                            # core 的 Goal/Rule/Auth/...
├── global/                              # Global scope
│   ├── agents/<agent-name>/
│   │   └── agent.yaml                   # Agent 对象（concepts/agent.md §3）
│   ├── connectors/<type>/
│   │   ├── connector.yaml
│   │   └── src/                         # 驱动代码（A16）
│   ├── refs/<ref-name>.yaml
│   ├── binds/<bind-name>.yaml
│   ├── policies/<policy-name>.yaml
│   └── credentials/<credential-name>.yaml
├── systems/<system-name>/               # ServiceDesc（一系统一目录）
│   ├── system.yaml                      # 元数据对象（servicedesc.md §3）
│   ├── goal.md / desc.md                # required DocType
│   ├── docs/                            # 其余声明侧文档
│   │   ├── rules.md / workflow-design.md / metrics.md
│   │   ├── data-design.md / data-metrics.md / auth.md
│   │   └── deploy-design.md / code-design.md
│   ├── loops/<loop-name>.yaml           # Loop 对象
│   └── instances/<instance-name>/       # ServiceInstance
│       ├── instance.yaml                # 对象 + Status
│       ├── docs/                        # 实现侧：impl.md / verify.md / drift-*.md / runbook.md
│       └── metrics/                     # MetricsInfo（数据区，非文档对象，gitignore 可选）
└── workservices/<name>/                 # WorkService
    ├── workservice.yaml
    ├── desc.md
    └── connectors/                      # 该外部系统专用驱动（若有）
```

## 2. 映射规则

| 规则 | 内容 |
|---|---|
| 目录=对象 | 一个对象一个目录或一个文件；目录名/文件名=对象 name |
| 路径=scope | core/=builtin，global/=global，systems/<s>/=<s>，…/instances/<i>/=<s>/<i>（scope.md 四层直接物化） |
| 元数据必有 | 每个对象目录必须有一个主 yaml（对象定义）；.md 文档带 YAML frontmatter（name/labels/ownerRefs） |
| 引用=URI | 文档内引用写 `system://<name>/<doc>` 或相对路径，不写绝对路径（换存储留缝） |
| 数据不入库 | metrics/ 是数据区；TSDB 后可整目录 gitignore，instance.yaml 只留查询声明（A17） |
| 命名 | 目录/文件名小写中划线；DocType 文件名=类型 kebab 化（WorkflowDesign→workflow-design.md） |

## 3. 文档 frontmatter 约定

```markdown
---
name: metrics
docType: Metrics            # 已注册 DocType
scope: developer-system
labels: {domain: devtools}
ownerRefs: [{kind: ServiceDesc, name: developer-system}]
---
# 监控设计
...
```

## 4. 本设计仓库自身（元层）

本仓库（core_design/）是这套设计的**声明侧**：concepts/、doctypes/、loop/ 是 Scheme 层的设计文档；它们描述的系统真正落地时，业务内容按本规范住进 systems/ 等目录。两层的边界：**core_design 描述"管理面如何工作"；systems/ 承载"被管理系统是什么"**。当 Core 代码实现后，core_design 中的 core/、global/ 部分可直接作为首版 Builtin 文档被 Igniter 装载（bootstrap.md §2）。

## 5. 迁移预留（v2+）

- Repository 接口：get/apply/list/watch 五方法（对齐 Connector 契约风格）；git 实现 v1 唯一后端。
- 布局与逻辑层解耦：所有访问经 URI，不裸操作文件路径——换 DB 时仅迁移脚本变，概念层零改动。
