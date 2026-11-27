# 验收报告 — ops_core_inner_agent 审批判决文档（2026-11-28）

> 用户裁定：审批裁定走小内置 agent[调 LLM]整理 DocumentDiff 生成 Diff 文档告诉我改了什么；继续用 ops_core_inner_agent（scheme 配置）。

## 全链活体证据（CT116，bin 5ba2407a→9 系列）

| 环节 | 证据 |
|---|---|
| 引擎挂接 | cored 启动旗标「判决文档生成面=on（ops_core_inner_agent）」（隔离冒烟取证——authority stderr socketpair 黑洞走 probe） |
| 派发窗口 | run 57-62 挂 AwaitingApproval 即 trace enter（/tmp/approvaldiff.log）——landAfterAdvanceLocked 人审挂起唯一窗口 |
| 读稿读现值 | base-read len=839/6890/… + draft-read len=7465（staged 稿） |
| Provider 解析 | modelTiers/taskModelMapping["ops_core_inner_agent"]=group/core-agent（真网关模型名——tier 词形网关不认） |
| 真 LLM 调用 | http-do url=magpie.tools.yicoson.cn/v1/chat/completions model=group/core-agent→200（502 瞬态重试×2 生效） |
| 判决落库 | DocumentDiff/global/docdiff-workflow-gh-issue-trigger rv=1（kinds 21 含新 kind；apply_log fieldManager=workflow-engine） |
| 判决内容 | 三条差异逐条（注释行新增/rv 删除/格式对齐）+原因+影响面风险——**与真实 diff 完全吻合** |
| 对象页可读 | #/obj/DocumentDiff/global/docdiff-workflow-gh-issue-trigger 正文含判决（活体） |

## 修过的坑（全部真 bug）

1. diffDocName 双拼接尾杠→对象名不合命名规则；
2. verdict 块标量缺换行→yaml line13 解析失败；
3. main typed-nil Secrets 穿接口→nil 指针 store.Secret panic（真 nil 接口走缺口可见）；
4. Provider models 词形（seq）+modelTiers（真名映射 taskModelMapping）；
5. magpie.ListenAll.cn DNS 不通→hosts 固定 10.10.32.220；443 SNI 不认→切 magpie.tools.yicoson.cn（dsh 同源端点）；
6. 网关 flash 档 502（=BugDoc #3 在册病）→Generator 502/503 退避重试×2；
7. 判决片独立注水（稿消费后 diff 缺席时判决最有用）。

## 已知边界（诚实）

1. 审批卡「Diff 判决」片渲染有时序问题待修（核心链路全通；对象工作台页可读判决正文兜底）；
2. gh-issue-trigger CT116 上 approval.mode=human（验收切档）；权威 YAML 仍 agent 档待用户裁；
3. Provider openai-default 已改 baseUrl=magpie.tools.yicoson.cn+secret source=env:MAGPIE_GATEWAY_KEY（CT116 实配）；mapping ops_core_inner_agent=group/core-agent。
