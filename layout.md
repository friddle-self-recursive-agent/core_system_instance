# 目录结构规范（SQLite 默认权威 + Git 导出/公开布局）

> 概念依据：core_design R-DOC-6 / R-DOC-7 / R-DOC-8（`rule/rule_doc.md`）。**SQLite `docs DB`（`--docs-backend sqlite`）是默认文档内容权威**；本目录结构是**种子导入与定时导出/公开（output/public）的标准布局**（目录即 scope，文件即对象；每篇 `.md` 同目录带 `<name>.md.metadatainfo` 侧车；每个 `.yaml` 严禁多 Scheme 合一）。

## 1. 顶层布局

```
<repo>/
├── core/                                # Builtin scope（控制面自描述）
│   ├── scheme.yaml                      # 根 Scheme（aspect: root；严禁多 Scheme 在同一文件，R-DOC-8）
│   ├── schemes/<aspect>.yaml            # 按 aspect 细粒度拆分的单文件单 Scheme（可选分册）
│   ├── core.desc.yaml                   # Core 自身 ServiceDesc
│   └── docs/                            # core 的 Goal/Rule/Auth/...（同目录带 .md.metadatainfo）
├── global/                              # Global scope
│   ├── agents/<agent-name>/
│   │   └── agent.yaml                   # Agent 对象（concepts/agent.md §3）
│   ├── connectors/<type>/
│   │   ├── connector.yaml
│   │   └── src/                         # 驱动代码（A16）
│   ├── refs/<ref-name>.yaml
│   ├── binds/<bind-name>.yaml
│   ├── roles/<role-name>.yaml           # v0.9 权限系统（A45）
│   ├── groups/<group-name>.yaml
│   ├── credentials/<credential-name>.yaml
│   └── workservices/<name>/             # WorkService（作用域=Global，workservice.md §头表；v0.44 起归 global/ 桶——路径=scope 准绳 §2）
│       ├── workservice.yaml
│       ├── desc.md
│       └── connectors/                  # 该外部系统专用驱动（若有）
├── systems/<system-name>/               # ServiceDesc（一系统一目录）
│   ├── system.yaml                      # 元数据对象（servicedesc.md §3）
│   ├── goal.md / desc.md                # required DocType
│   ├── docs/                            # 其余声明侧文档
│   │   ├── rules.md / workflow-design.md / metrics.md
│   │   ├── data-design.md / data-metrics.md / auth.md
│   │   └── deploy-design.md / code-design.md
│   ├── workflows/<workflow-name>.yaml           # Workflow 对象
│   └── instances/<instance-name>/       # ServiceInstance
│       ├── instance.yaml                # 对象 + Status
│       ├── docs/                        # 实现侧：impl.md / verify.md / drift-*.md / runbook.md
│       └── metrics/                     # MetricsInfo（数据区，非文档对象，gitignore 可选）
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

> **core/ 层无 policy 文件**（v0.9 对齐，A44：Policy 并入权限系统）：强制文档类型归 DocType 注册（core/scheme.yaml）；准入/人审档由权限系统对象承载（global/roles/、global/groups/，permission.md），builtin 治理按 `core/origin: builtin` label 匹配规则（builtin.md §5）——不以 core/*.policy.yaml 文件形式存在。

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

本仓库（core_design/）是这套设计的**声明侧**：concepts/、doctypes/、workflow/ 是 Scheme 层的设计文档；它们描述的系统真正落地时，业务内容按本规范住进 systems/ 等目录。两层的边界：**core_design 描述"管理面如何工作"；systems/ 承载"被管理系统是什么"**。当 Core 代码实现后，core_design 中的 core/、global/ 部分可直接作为首版 Builtin 文档被 Igniter 装载（bootstrap.md §2）。

## 5. 存储权威与定时导出（R-DOC-7 / R-DOC-8）

- **默认权威 = SQLite `docs DB`**（`--docs-backend sqlite --docs-db <path>`，root 部署固定 sqlite，不得选 git）；
- **Git 布局 = 种子导入与定时导出/公开格式**：系统按规则定时从 SQLite 导出工作树（含 `.md.metadatainfo` 侧车）→ commit → push 远程（详见 `runtime/docs-export.md`）；
- **单文件单 Scheme（R-DOC-8）**：自己保存的 `.yaml` 严禁多 Scheme 合一（仅 `import` 输入包例外，落库必拆为单文件单 Scheme）。
