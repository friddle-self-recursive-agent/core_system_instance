# 运行时设计 5：install / instantiate 流程（R1.4 + 2026-11-26 模板裁决）

> 概念依据：core_design/concepts/template.md（统一 `Template` kind ×四层 appliesTo；要求语义；R-DOC-5 双仓承载）。
> 用户裁决（2026-11-26）：模板资源=**要求**不是实际系统（storage={类型偏好,大概空间,速度要求}）；**resolver 自动判断配置好，解析不了就一层层询问**；实例化逐层下探（确认 Service→ServiceInstance 模板→ServiceWorkSpace 模板→未装的 WorkService 安装链）。

## 1. 流程总览

```
用户（console 命令 / 口头意图 / agent 节点）
  → InstallRequested / 实例化意图 Event ──► 路由到 builtin-deploy-system 的 Workflow
  1. 发现：GitHub org 搜 "*-template" 仓
     └─ connector: github-org-driver（只读：列仓/读README/读模板yaml）
  2. 读模板描述：template.yaml（Template 对象，appliesTo 定层）
     └─ 校验：digest 必填、connector 已注册、install 步骤动作在白名单、requires 无实际地址（lint）
  3. resolver 预解析（新增，先于询问）：
     对 requires 逐项对照在册能力（storage-system 自备 → Provider/WorkService 能力匹配）
     → 能解析的自动选型（偏好可降级 oss→nas、hot→warm），选型留痕「已自动选 X：原因」
     → 解析不了的进 asks；asks 必带缺省与示例（R-UX-1：能推断不问）
  4. 逐层询问（chain 层序，每层一张确认卡）：
     ① 确认 Service（对象选择器，「是这个 service 吗？」）
     ② ServiceInstance 模板层：resolver→asks
     ③ ServiceWorkSpace 模板层：resolver→asks
     ④ requires.systems 引用的 WorkService 未装 → 下探其 workservice 层模板（安装链）
     已解析项跨层不重问；asks 未答完不执行；最后显式人确认（ApprovalNeeded→挂载 role 的人）
  5. 安装：deploy-system 执行 install 段（TaskScheme `install` 模板渲染）
     pull-image(digest 校验) → render-config → start-service(健康检查)
     失败：三段 undo（镜像/配置/服务），机器不留半成品
  6. 纳管：postInstall → register-workservice（自动建 WorkService 对象；tools 面成对 cleanup op 随注册声明）
  7. 留痕：全程 ops DB（install 每步一行 + resolver 选型行）+ DriftReport 归档
```

## 2. 关键规则

1. **要求语义 lint**：requires 里出现实际地址/主机名=拒绝入库（类型偏好+量化要求+ask 标记才合法；镜像 source 例外，digest 不变）。
2. **resolver 先行**：能从在册资源解析的要求不得抛给用户；自动选型必须留痕（原因+可改，ops DB 选型行）；解析不了才 asks。
3. 无 digest 不装；asks 未答完不装；无人确认不装（模板再"安全"也过一遍人）。
4. **逐层下探**：按 `chain` 层序执行；跨层要求自动下探对应层模板；已解析项跨层不重问。
5. 安装幂等：装第二遍=no-op（deploy-system Goal.A2）；组件级幂等由 Connector 契约保证。
6. 镜像地址默认 storage-system 本地 templates/（**local 是唯一内置源**）；部署方显式接了 nas/oss connector 才有远端源可选——选远端是配置决策非降级，缺源走 resolver 链显式降级回 local，留痕非静默。
7. 恶意模板防线：来源限定本 org + digest + install 动作白名单 + 高危动作（exec/写系统路径）人审。
8. 询问面复用 intake 引擎（`/v1/intake/*`，R-UX-1 六步）与 scheme 驱动控件（R-UX-2）；agent 节点（autoLevel=all）可自动答可解析项并自确认（同准入链留痕）。

## 3. 首批模板（建议）

| 模板 | 层 | 用途 | 备注 |
|---|---|---|---|
| `onedev-template` | workservice | developer-system 的 scm/ci | 既有 onedev 纳管优先于新装；模板同样描述"纳管已有实例"的路径（install 段可仅注册+验活） |
| `prometheus-template` | workservice | MetricsInfo 后端 | 观测面落地即装 |
| `developer-system-template` | servicedesc | 有哪些系统/要求/goal | systems=[onedev, prometheus]；实例化时逐层下探 |

## 4. 与 GitHub 的关系

org 里的 `*-template` 仓 = 模板分发渠道（可被 fork/PR——模板生态的将来）。模板内容（template.yaml+config.tmpl）本身也是文档对象：拉取后经权限系统扫描入库（global/templates/）。org 的 Ref 指针：`ref/github-org-templates`。

## 5. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| org 搜索 API 限流 | ⚠️ 低 | 只读+缓存；结果进 Ref/TermCache |
| "纳管已有实例"与"新装"混合语义 | ⚠️ 中 | 模板显式声明 mode: adopt|install；adopt 模式跳过镜像段只做注册+验活+版本探测 |
| 三段 undo 覆盖不全 | ⚠️ 中 | install 步骤声明 undo 动作；做不到的标 undoUnsupported→装前必须人批卸载策略 |
| resolver 选型失准 | ⚠️ 中 | 选型行留痕可改 + 降级链显式 + asks 兜底；确认卡标注「已自动选 X」 |
| 逐层询问过繁 | ⚠️ 低 | resolver 先行 + 每问带缺省 + 跨层不重问；autoLevel=all 的 agent 自动答可解析项 |
