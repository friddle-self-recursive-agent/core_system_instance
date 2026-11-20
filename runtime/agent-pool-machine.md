# Runtime — agent_pool 机器与双 dsh profile

> R14.1 指定：agent_pool 机器的运行时设计（机器定位、双 profile 分工、自举顺序、install 步骤草案）。
> 本文只做设计；机器现状已按本文 §0 完成（事实记录），后续步骤不实施。

## 0. 机器现状（已验证事实）

| 项 | 现状 |
|---|---|
| 形态 | 内网 KVM 宿主上的一台 LXC 容器（ubuntu 24.04，8C/16G/150G，非特权+nesting，开机自启） |
| 基础环境 | dsh 0.2.2-rc.5（全局 npm）、node 24、go 1.27、git、build-essential、sudo 用户 friddle |
| dsh profiles | `core-system`（web :3081）与 `kube-inner`（web :3082），模型统一走内网 LLM 网关（Provider 语义；key 在 .env，不入库） |
| 公司 git | OneDev 上 `agent_pool/` 前缀仓（A55）承载本机相关报告与后续代码 |

## 1. 双 profile 分工（A57）

```
┌────────────────────── agent_pool 机器 ──────────────────────┐
│                                                             │
│  dsh --profile core-system (:3081)                          │
│  ┌───────────────────────────────────────────────┐         │
│  │ 角色：core_system 自举开发者                      │         │
│  │  跑 developer-system 闭环（A41 core-loop）：      │         │
│  │   desc 仓(声明) ⇄ instance 仓(设计/可行性)        │         │
│  │   ⇄ workservice 仓(代码)                         │         │
│  │  唯一交付目标：                                    │         │
│  │   产出/更新「kube-inner profile 所用的 plugin」   │────────┐│
│  │   （产物经 developer_system 链：build→gate→digest）│       ││
│  └───────────────────────────────────────────────┘        ││
│                                                    产物发布  ▼│
│  dsh --profile kube-inner (:3082)                           │
│  ┌───────────────────────────────────────────────┐  ┌─────────────┐
│  │ 角色：内网接入运行时                               │◄─│ core plugin │
│  │  挂 core plugin（Apply/Event/Workflow/Scheme/权限）│  │ （宿主内）  │
│  │  开始 onedev + 内网集群纳管（impl/kube-inner-      │  └─────────────┘
│  │  integration.md）                                 │
│  └───────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

分工要点：
1. **core-system profile = 自举闭环的执行者**：按本系统自己的 developer-system 流程开发 core_system（首个对象=core plugin 本体，A39/A43：core 跑在 dsh plugin 里）。
2. **唯一交付 = 第二个 profile 的 plugin**：自举的验收不是"写了多少文档"，而是 kube-inner profile 能挂上可用的 core plugin。
3. **kube-inner profile = 消费者**：挂上 plugin 后才开始纳管公司 OneDev 与内网集群；它自己不参与 core_system 的开发。
4. 两 profile 权限域隔离（scope：builtin-self-recursive-core vs 公司系统域），互不引用对方的 ConnectorOps——防自举环把公司环境当试验田。

## 2. 自举顺序（bootstrap 之后的第一对实例）

依赖 loop/bootstrap.md（P9 点火器）完成之后：

```
T0 Igniter 点火 → SelfRecursiveCore（临时/最小形态）
T1 core-system profile 上电：developer-system 闭环接管 core_system 三仓
T2 首个任务：core plugin v0（Apply/Event/Workflow 引擎最小集）
T3 产物链验证：build→gate→digest→发布（OneDev agent_pool 仓留痕）
T4 kube-inner profile 挂载 plugin v0 → onedev/集群纳管（impl/kube-inner-integration.md K0）
T5 循环：kube-inner 侧发现的缺陷 → Event → core-system profile 修复 → 新版 plugin → T4 重放
```

T5 即"唯一目标=更新第二个 profile 插件"的闭环形态；两条 loop 的触发规则与刹车各自独立（cooldown/预算不共享）。

## 3. install 步骤草案（已执行部分打勾，其余不实施）

- [x] 机器创建（LXC，ubuntu 24.04）
- [x] 基础环境（dsh/node/go/git）
- [x] 双 profile 配置与组装验证（--dump-config 通过）
- [x] 公司 git 上 agent_pool 前缀项目建立（报告仓）
- [ ] core plugin v0 实现（workservice 仓，本次不做）
- [ ] T1–T5 循环上电

## 4. 可行性分析

| 项 | 评级 | 风险/约束 | 缓解 |
|---|---|---|---|
| 双 profile 同机隔离 | ✅ | 进程/端口分离（3081/3082）；数据目录按 profile 天然隔离 | 权限域不互引（§1.4） |
| 自举依赖 plugin 首版 | ⚠️ 有条件 | core plugin 未实现前，core-system profile 只是普通 dsh 会话（无 Apply/Event 引擎） | 这正是设计先行（R14.2"不开做"）的原因；v0 最小集见 T2 |
| "唯一交付"的验收判定 | ⚠️ 有条件 | "plugin 可用"需可数据判定（A3） | 验收探针=kube-inner profile 挂载后能跑通一次 core-loop 最小循环 |
| 机器单点 | ⚠️ 有条件 | 一台容器承载自举与接入 | 150G/16G 余量充足（本日已扩容核查）；备份策略进 storage-system 既有设计 |
| 模型网关依赖 | ⚠️ 低 | LLM 网关不可达则两会话停摆 | 网关健康探针 → Event(warn)；网关路由组先到先得可切换 |

## 5. 审阅标注区

| 标记 | 位置 | 说明 |
|---|---|---|
| | | |
