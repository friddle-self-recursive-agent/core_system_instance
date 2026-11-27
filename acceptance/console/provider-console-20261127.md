# 验收报告 — Provider 控制台配置面（添加/配 key/Agent 绑定）

> 2026-11-27 用户指令「页面上哪里可以配置 Provider 哪里添加 Provider 配置 openai 的 key。然后修改 agent 默认绑定的 provider 以及不同智能绑定不同的 provider。验收的时候给我验收报告」。浏览器经门活体验收（CT116 core_agent，双服务重启后新 bundle，dist hash 双端一致 cd6b4264f772ec52）。

## 结论：五项全过，零阻塞遗留

| # | 需求 | 结果 | 证据 |
|---|---|---|---|
| 1 | 页面上哪里配置 Provider | ✅ 三处入口：①对象工作台 Provider 对象页（`#/obj/Provider`）；②Workflow 详情页 11 个 Provider 徽章（节点表+设计表，点击开抽屉）；③会话页右栏 Provider 按钮（同一 openProviderDrawer） | 截图 3：workflow 页 OpenAIProvider 配置面板（rv=1）展开活体 |
| 2 | 添加 Provider | ✅ 对象工作台 Provider kind 页「+ 添加 Provider」表单（name/account/密钥引用/baseUrl/low/standard/high 七字段）→「创建 Provider」apply 落库 | 截图 1：表单活体；创建后 Provider count=2→3（gh/openai-2/openai-default）；事件账 `apply:Provider/global/openai-2:1` |
| 3 | 配置 openai 的 key | ✅ 抽屉「密钥引用 (auth.secret.source)」字段——**引用式零明文**（secret:/vault:/env: 前缀），真实 key 值落部署侧 secret 源；openai-2 创建即配 `secret:llm/openai-key` 引用 | 截图 3 密钥引用字段活体；provider 对象 yaml auth.secret.source 在册 |
| 4 | 修改 agent 默认绑定的 provider | ✅ Agent 对象详情卡「Agent 默认 Provider 绑定」（scheme `spec.defaultProvider`，缺省 openai-default）——下拉选在册 Provider+手填→「保存绑定」apply | 截图 2：core-headless 绑定卡 rv=15；落库核验 `defaultProvider: openai-2`（rv=15）；事件账 `apply:Agent/global/core-headless:15` |
| 5 | 不同 agent 绑不同 provider | ✅ 机制=per-Agent spec.defaultProvider：core-headless=openai-2（本轮页面改），其余 Agent/全局缺省=openai-default（workflow 节点徽章仍显示 openai-default——同屏对比活体） | 截图 2 与截图 3 同屏两态；corectl get Agent 核验 |

## 附带活体证据（同屏）

- **gh-issue-trigger 端到端联通**（上一任务批）：workflow 详情页 `bound`/`run #43 converged (24h 3)`/九节点相位链含第 9 节点 issue-feedback（connectops-gh·issue-comment）全部活体可见——截图 3 上半部。

## 提交账

- workservice@94c6032：`feat(console)` 对象工作台 Provider/Agent 增强（web/src/screens/objects.js+dist）；web 118 pass
- plugin@1efc212：submodule pin bump
- CT116：plugin pull+submodule update→94c6032，dist sha256 双端一致（cd6b4264f772ec52），dsh-core-system→dsh-kube-inner 顺序重启（三服务 active，cored addr 轮换 :32965）

## 已知边界（诚实注记）

1. **openai-2 的 key 实值未落**：引用名 `secret:llm/openai-key` 已配，真实 key 值=部署侧 secret 源（CT116 环境 vault），部署方落值后即生效；baseUrl 当前=表单缺省 `https://api.openai.com/v1`，指向实际网关经抽屉改 baseUrl+引用即可。
2. **编辑器通路**：对象工作台「编辑器」按钮可改任意对象 YAML（含 Provider/Agent）——字段化表单是本轮新增的快捷面，编辑器是兜底全景面。
3. 截图留存：本报告引用截图存 ZCode 会话 artifacts（sess_e5a0392f）；正式截图归档随 acceptance 惯例入 report 附注。
