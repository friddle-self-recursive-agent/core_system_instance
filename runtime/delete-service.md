# Runtime — delete service 流程

> 概念依据：concepts/scope.md（**目录即对象——删目录=级联删除其下一切**）+ concepts/workservice.md 规则（外部副作用清理=tools 成对 cleanup op；无系统级 Finalizer）。删除没有独立 Kind，这是**统一流程**。

## 1. 流程总览

```
删除请求（人 / Workflow 提案 / cascade 目录删除）
  1. 影响预览：core 计算级联范围
     ├─ 目录树：将被删除的对象清单（cascade，目录即对象）
     ├─ 引用面：谁 ref 了它（→ 拒绝或提示一并删除）
     └─ 外部副作用：该对象集合关联的 WorkService.tools cleanup op 清单
     → console 呈现预览（树+副作用清单，全部可点）
  2. 确认：ApprovalNeeded → 人批
     （删 builtin/global 高敏对象=权限系统更高档位；builtinRoot/内置 role=硬拒）
  3. 执行（顺序固定，逐步留痕 ops DB）：
     ① 停依赖：挂在该对象上的 workflow → enabled=false；agent 停派发（running 任务幂等中断）
     ② 断引用：外部指向它的 Ref/引用项清理或随级联删除
     ③ 目录删除：目录即对象，子树级联（git 记录=可恢复点）
     ④ 外部清理：tools 面成对 cleanup op 逐条执行（装了什么删什么；cleanup 缺失的
        装前就不该过审——install 白名单保证）
     ⑤ 留痕：ops DB（每步一行）+ Event(Deleted) + git 提交
  失败：从失败步逐步 undo（与 install 三段 undo 同契约）；半删状态=Event(warn)+观测面亮灯
```

## 2. 关键规则

1. **引用计数>0 的可删对象不静默删**：预览强制列出引用面，要么提示"将被一并删除"，要么要求先断引用——无隐式悬挂引用。
2. **外部清理与安装对称**：cleanup op 与 install 动作在 tools 面成对声明（Lint 强制）；装前没声明卸载策略的，install 时就拦下（undoUnsupported→装前人批卸载策略）。
3. **删除可恢复**：git 历史即备份——误删=从历史恢复目录重新 Apply（对账 Workflow 校验与现实的差异后追平）；不设回收站。
4. **workflow/task-scheme 模板删除**：走 delete 流程但外部清理段为空（纯文档对象）；builtin 起源模板不可删（task-scheme 四操作规则）。
5. **用户/role 删除**：先摘绑定（role.on 清理）再删对象——权限面不留死引用。

## 3. 可行性

| 风险 | 等级 | 缓解 |
|---|---|---|
| 级联范围算漏 | ⚠️ 中 | 预览强制+引用面穷举（core 索引）；大范围删除强制人批 |
| cleanup op 执行失败 | ⚠️ 中 | 逐步留痕+undo；外部残留=Event(warn)+观测面残留清单（人工收尾可查） |
| 误删恢复歧义 | ⚠️ 低 | git 历史恢复+对账追平；删除每步一行 ops DB 可审计 |
