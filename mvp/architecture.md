---
name: mvp-dsh-core-agent
docType: ImplDoc
scope: core_system/default
ownerRefs: [{kind: ServiceInstance, name: core_system/default}]
labels: {tier: mvp}
---
# MVP 架构：dsh-core-agent

## 1. 进程拓扑

一台机器一个 node 进程：

```
node ≥24.9 ── dsh CLI（宿主 @deepseek-ai/dsh，profile: core）
                ├─ dsh-core-agent（npm 包名=服务名去后缀）
                │    ├─ core     文档仓 + Apply 管线 + loop 引擎 + goal generator
                │    ├─ tools    exec（白名单）/ probe（http|tcp|file）
                │    └─ console  HTTP 观测面 + 种子 Goal 入口
                └─ llm（dsh 内置 service，provider 配置见 §5）
```

对照 runtime/dsh-plugin.md 完整拓扑的裁剪：root/子 agent 双头指挥、control/console/exec-local/reporter 四插件分工、直控通道全部不做——MVP 只有 core 一个装载单元，Agent=core plugin 内的循环引擎本身。插件契约遵循 dsh 生态（`apply(ctx, config)` + `inject: ['tools']`），非本系统概念。

## 2. 部署（机器 inner-service / 10.10.32.12）

| 项 | 值 |
|---|---|
| 系统 | Ubuntu（PVE 环境），x86_64，root 运行 |
| Node | ≥24.9（dsh engines 硬要求）；装于 /usr/local/node24，不覆盖系统 node18 |
| npm 包 | `dsh-core-agent`，`bin: dsh-core-agent`（`dsh-core-agent start`） |
| 服务名 | `dsh-core-agent.service.code27.cn` → 本机（DNS 已注册）；console HTTP 监听 0.0.0.0:8090，nginx 把域名 80 转发到 8090；dsh web（宿主自带 SPA）在 127.0.0.1:18443 |
| 常驻 | systemd unit `dsh-core-agent.service`，Restart=always |
| 工作目录 | /root/dsh-core-agent/ |

## 3. 目录布局（目录即对象，layout.md 子集）

```
/root/dsh-core-agent/
├── package.json                # dsh-core-agent
├── lib/                        # 插件代码
│   ├── index.js                # apply(ctx)：装载 store/apply/loop/generator/probes/console
│   ├── store.js                # 文档仓：frontmatter 解析、枚举、version 乐观锁（读改写自增）
│   ├── apply.js                # Apply 管线：校验（scheme+probe 引用）→ 写盘 → Event
│   ├── loop.js                 # core-loop-mvp 态机（设计文档 §3）
│   ├── generator.js            # Goal 生成器：LLM 提案 → 提案区
│   ├── probes.js               # http/exec/file 三探针（幂等只读）
│   └── console.js              # HTTP API + 静态观测页
├── docs/                       # 文档面（生效区；对象 = md + frontmatter）
│   ├── goals/current.md        # 当前生效 Goal（一次一个）
│   ├── goals/queue/*.md        # 已生效待接任
│   ├── goals/proposals/*.md    # 提案区（generator 产物，未生效）
│   ├── plans/*.md              # PlanDoc（每次 Plan 必落档，A29）
│   └── sessions/*.md           # SessionLog（每轮必落档，A29）
├── state/                      # 引擎写区（非文档对象）
│   ├── status.json             # phase/conditions/最近 tick/最近 probes 结果
│   ├── pointers.json           # current goal 指针 + requirements 派生进度
│   └── deadletter.json         # 死信（路由不出的 Event）
└── .env                        # API key（EnvironmentFile，0600）
```

写权限三分（P2 物化）：`docs/` 只有人与 generator 经 Apply 写；`state/` 只有 loop 引擎写（人改无效，tick 重算覆盖）；`lib/` 只随 npm 包升级变。

## 4. 一次 tick 的数据流

```
timer(resync) 或 Apply 触发
  └─► loop: Analyze = 对当前 Goal.acceptance 逐条跑 probe
         ├─ 全过 → InSync → generator：
         │     输入  = 当前 Goal + probes 结果 + requirements 存档 + 上轮 DriftReport
         │     输出  = JSON Goal 提案 → 校验 → docs/goals/proposals/ → Apply → 排队
         │     队列空 → Idle（本轮无产出，诚实报告）
         └─ 有 drift → Plan（LLM 产 PlanDoc：步骤引用 tools 白名单 op）
               → Execute（逐步执行，步骤结果记入 SessionLog）
               → Verify（probes 复测）→ Report（status.json 回写 + SessionLog 归档）
               → CoolDown（默认 60s）→ 下一 tick
失败路径：单步失败→重试≤2；Verify 不过→Backoff ≤3；耗尽→Escalated
        （phase=Escalated，console 标红，DriftReport 落 docs/sessions/，等人处理）
```

## 5. LLM

MVP 决策：generator/plan **直连 provider 的 openai-completions HTTP**（GLM coding plan，`baseURL=https://open.bigmodel.cn/api/coding/paas/v4`，模型 glm-5.3-flash），不耦合 dsh-llm 的 session 消息 API——那是 rc 期接口，MVP 不押注；宿主 profile 里 dsh-base 的 llm/agent/session 栈照常装载，供 dsh 自身 Web 控制台使用。key 由 systemd `EnvironmentFile=/root/dsh-core-agent/.env` 注入（`GLM_CODING_API_KEY`，0600，永不入库）。LLM 消费点只有两个：generator（Goal 提案）与 Plan（PlanDoc 步骤）。两者都要求 JSON/受控格式输出：不合法 → 丢弃重试 ≤2 → Escalated。模型选型：任一可用 provider 的 flash 档即可，机制不假设模型能力（P8）。

## 6. Console API

| 方法/路径 | 作用 |
|---|---|
| GET /api/status | status.json 全量（phase/conditions/当前 Goal/最近 probes/tick 历史） |
| GET /api/goals | 生效区 + 提案区 + 队列列表 |
| POST /api/goals | 人 Apply 种子/人工 Goal；校验失败 422 并给出原因（设计文档 §2 规则 3） |
| POST /api/tick | 人手动触发一轮（人工触发源；resync 定时仍是 5m） |
| POST /api/resolve | 人解除 Escalated（处理完现实后调用，恢复循环） |
| GET /api/sessions | SessionLog 列表与内容 |
| GET / | 静态观测页（无登录，仅内网；登录鉴权随权限系统后补） |

## 7. 自举衔接（bootstrap.md 视角）

MVP 即 ignition 第 0 步的最小演示：人（本次开发）扮演 Igniter 完成装载 → 种子 Goal 由人给 → 自循环自持。bootstrap.md 的三步自动 Igniter、core/ global/ builtin 文档全量装载、多系统 scope，全部在 MVP 验证后按原设计推进，本文不预做。
