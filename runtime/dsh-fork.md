# dsh 锁定模式与 fork 策略（2026-11-24 用户裁决）

> 用户要求：dsh 本身能否禁用"添加"，只能按需求来；做不到就 fork 一个 dsh，按需求完全实现。

## 0. 结论

- **第一波不需要 fork**：dsh 的 Web 面由 bundle patch 层按行组装（`rows here override base rows by id, with the profile's own cordis.patch.yml and any --patch overlays still to come`），可以在**我们自己的 profile patch 层**按行 id 禁用入口（插件管理/插件清单/Workspace 控制器/自动化任务等），再用文件权限锁住 CLI 侧 `dsh plugin add`。这能实现"入口不出现 + API 拒绝"，属"锁定模式"。
- **fork 作为兜底**：当需求是"改行为"（而不是隐藏入口）——例如强制单一会话模型、改路由/品牌、服务端拒绝某类命令、多租户隔离——再 fork。dsh 为 MIT 开源（repo=deepseek-ai/deepseek-harness，默认分支 master，packages/{client,bundle,workspace,settings,web,core...} 齐全），fork 与源码构建可行。

## 1. 锁定模式（首选，不改 dsh）

| 面 | 做法 | 证据/判据 |
|---|---|---|
| UI 入口 | profile patch 按行 id 禁用：`plugin-manager` / `tool-plugin-manager` / `plugin-inventory` / `workspace-controller` / `workspace` / `schedule` / `settings-controller`（需要保留的项逐条评估） | 侧栏无"添加插件/新建 Workspace/新建自动化任务"；对应 API 403/404 |
| 插件 Browsing/Creator | 不装载 `ui-entry-customization`（Web 默认加载，负责三个导航区的插件浏览/Creator 草稿） | 三个 More 区无条目 |
| CLI 侧 | `~/.dsh/profiles/*` root 属主 + 目录不可写；仅部署侧管理员可改 | 非 root `dsh plugin add` 失败 |
| console 侧 | 我们的 console plugin 只注册需求内页面（§1.23 九项），不提供"添加"类操作 | DOM 无 add 入口 |

注意：锁定=隐藏+拒绝，不是改语义；被禁用的宿主能力若已有数据（历史会话/项目）仍可读（只读保留）。

## 2. fork 触发条件（任一满足）

1. 需要改**行为**而非隐藏（如"只允许 Service→project 一一对应，禁止自由新建"、强制单一 Workspace）；
2. 需要服务端拒绝某命令（CLI/HTTP 层），profile patch 做不到；
3. 需要改产品标识/路由/信息架构（品牌、默认页、导航模型）；
4. 需要多租户/多用户隔离（当前单用户模型不够）；
5. 上游不接受所需 feature flag 的 PR，而 patch 层无法表达。

## 3. fork 方案（触发后执行）

- **仓**：部署侧 fork（私有），不进公开核心六仓；LICENSE(MIT)+THIRD_PARTY_NOTICES 保留。
- **分支**：`upstream/master` 只读跟踪 + `locked` 分支承载单一补丁面；每季度 rebase 上游（或季度 tag）。
- **补丁面最小化**：优先加 feature flag（`ui.features.plugins=false`、`ui.workspace.mode=service`、`session.new=disabled`），UI 条件渲染 + 服务端命令闸；不重构内核。
- **构建**：pnpm workspace 构建（需镜像/native 依赖评估）；产物 digest 入账；部署到 CT116/sybran 的 dsh 安装前缀，profile 不变。
- **验收**：与 console-ui.md §11 + §1.23 同一判据；额外验证上游同步演练（取下一个 upstream tag 能 rebase 成功）。
- **红线**：fork 代码不含真实凭据/内网信息；不破坏既有 profile/plugin 契约（我们的 core_system 插件必须零改动可用）。

## 4. 与当前队列的关系

loop-console-native（能力 C）先按 §11 E1/E2 做锁定模式；只有触发 §2 的条件时，才启动 fork 评估（本轮不预先 fork）。
