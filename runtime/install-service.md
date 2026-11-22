# 运行时设计 5：install service 流程（R1.4）

> 概念依据：core_system/concepts/template.md（WorkServiceTemplate = builtin Scheme）。

## 1. 流程总览

```
用户（console 命令 / 口头意图）
  → InstallRequested Event ──► 路由到 builtin-deploy-system 的 Workflow
  1. 发现：GitHub org（https://github.com/friddle-self-recursive-agent）搜 "*-template" 仓
     └─ connector: github-org-driver（只读：列仓/读README/读模板yaml）
  2. 读模板描述：template.yaml（WorkServiceTemplate 对象）
     └─ 校验：digest 必填、connector 已注册、install 步骤动作在白名单
  3. TemplateFound Event → console 呈现（provides/resources/asks）
  4. 询问：asks 逐项填（endpoint、凭证引用等）+ 显式确认（ApprovalNeeded→挂载 role 的人）
  5. 安装：deploy-system 执行 install 段（TaskScheme `install` 模板渲染）
     pull-image(digest 校验) → render-config → start-service(健康检查)
     失败：三段 undo（镜像/配置/服务），机器不留半成品
  6. 纳管：postInstall → register-workservice（自动建 WorkService 对象；tools 面成对 cleanup op 随注册声明）
  7. 留痕：全程 ops DB（install 每步一行）+ DriftReport 归档
```

## 2. 关键规则

1. 无 digest 不装；asks 未答完不装；无人确认不装（模板再"安全"也过一遍人）。
2. 安装幂等：装第二遍=no-op（deploy-system Goal.A2）；组件级幂等由 Connector 契约保证。
3. 镜像地址默认 OSS（storage-system Archive 层）；无 OSS 走模板声明的 nas/local 备选源。
4. 恶意模板防线：来源限定本 org + digest + install 动作白名单 + 高危动作（exec/写系统路径）人审。

## 3. 首批模板（建议）

| 模板 | 用途 | 备注 |
|---|---|---|
| `onedev-template` | developer-system 的 scm/ci | 既有 onedev 纳管优先于新装；模板同样描述"纳管已有实例"的路径（install 段可仅注册+验活） |
| `prometheus-template` | MetricsInfo 后端 | 观测面落地即装 |

## 4. 与 GitHub 的关系

org 里的 `*-template` 仓 = 模板分发渠道（可被 fork/PR——模板生态的将来）。模板内容（template.yaml+config.tmpl）本身也是文档对象：拉取后经权限系统扫描入库（global/templates/）。org 的 Ref 指针：`ref/github-org-templates`。

## 5. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| org 搜索 API 限流 | ⚠️ 低 | 只读+缓存；结果进 Ref/TermCache |
| "纳管已有实例"与"新装"混合语义 | ⚠️ 中 | 模板显式声明 mode: adopt|install；adopt 模式跳过镜像段只做注册+验活+版本探测 |
| 三段 undo 覆盖不全 | ⚠️ 中 | install 步骤声明 undo 动作；做不到的标 undoUnsupported→装前必须人批卸载策略 |
