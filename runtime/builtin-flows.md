# Runtime — 内置能力流程总表

> 各 builtin 系统/能力的**核心流程**一页索引：每条流程=触发→步骤→失败路径，细节指向对应 impl/runtime 文档。install / import / delete 三个服务级流程见各自文档（install-service.md / import-service.md / delete-service.md）。

## 1. developer-system：build-and-verify（研发闭环）

```
Event(push/需求) → Analyze → Gate（红线：test/lint 全绿才产物）
 → onedev-driver.checkout（pull，同 ref 幂等）
 → exec-local build+test → 产物 digest 入库（oss）
 → build-status 回写 → Verify 探针 → Status 追平 + Event(DriftFixed)
 → Report：loop 版本记录 `loop-<seq>`（runtime/acceptance.md）→ acceptance/（gitignore，不入公开仓）
失败：retry→backoff→escalate（root）
```

## 2. deploy-system：三渠道发布（每业务 DeployDesign 声明）

| 渠道 | 流程骨架 | 失败路径 |
|---|---|---|
| C1 kube | get→diff→patch（server-side dryRun）→rollout-status→健康门槛→（分批）下一批 | 健康不过→停批→undo（回滚上一代）→escalate |
| C2 ssh-host | docker inspect→比较→restart/compose up→容器健康命令 | 断链=Event(warn)；失败→undo+告警 |
| C3 onedev-ci | build-status 回写+gate 只读抽查+产物登记 | 状态不符=drift |

prod 档位强制人批（core-system-developer-loop 审批闸约束）；每业务 VerifyDoc.probes 出验收探针。

## 3. storage-system：本机目录存储（2026-11-27 裁定：builtin 无 NAS/OSS）

```
内置：storage root 本机目录——docs/（git 文档库权威）+ files/（产物 digest）
     + snapshots/（ops DB 每日快照）+ templates/（install 镜像）
恢复：snapshots/ 回放 + docs/ checkout 任意提交 → 对账 Workflow 校验差异
外接（可选）：部署方接 nas/oss connector 后，远端 sync/归档=部署配置的 Task/Workflow；
     不接则系统完整可用（builtin 零外部依赖）
```

## 4. user-system：认证 + 目录同步（impl/user-system.md）

```
认证：用户→ ldap-authn（管理面 API）→ token→ role 投影→ session
同步：定时全量 diff（LDAPS 经 sync 通道）→ User/Group 增改 → 组→role 投影刷新
     → 飞书 userid 映射补全（未映射 warn）→ Account Mapping 更新
失败：水位丢失=全量重同步；映射缺口=群兜底
```

## 5. event 生命周期（core_event_operator → 分发）

```
产生（watch/阈值/巡检/Apply/人工）→ 去重（dedupKey+窗口）→ 路由（Scheme.dispatch，谓词含 exists/notIn）
 → 触发 Workflow / 通知（Notification：feishu 账号映射 / kafka 通道）
 → 归档（默认 30d，critical 1y）
路由不到→死信；死信率超阈→**熔断该源**（半开恢复）；打标失败→warn 不阻塞
```

## 6. metrics（core_metrics_operator → 摘要报告）

```
采集：ps/docker 级探针（ConnectorOps.get）→ 原始序列观测面
摘要：默认 workflow（可勾选，默认勾）→ agent 生成报告（1 天一次，保留 7 天）
     保存策略=提示词+代码，可编辑
```

## 7. workflow 生命周期（platform，runtime/workflow-runtime.md）

```
落地：apply-workflow agent（接线+缺的连接层调 developer-system 写自定义 connector+自监控注册）
运行：触发→相位态机→回归→冷却；全程 ops DB 相位流水
操作：enable/disable / 编辑（表单+YAML）=Apply / 克隆 / 导入（origin=imported，首期 observe）
展示：console 详情页五 tab（流程图/事件/流转/数据流/成本）
```

## 8. 服务级流程入口

| 流程 | 文档 | 触发 |
|---|---|---|
| install（装新的） | install-service.md | InstallRequested |
| import（纳管存量/导入编排） | import-service.md | ImportRequested |
| delete（级联删除+外部清理） | delete-service.md | 删除请求/提案 |

三个流程共用同一骨架：**预览（dry-run/影响面）→ asks → 人批（ApprovalNeeded）→ 执行（幂等+逐步留痕）→ 失败 undo → Event 收尾**——机制同构，差异只在动作集与风险档位。
