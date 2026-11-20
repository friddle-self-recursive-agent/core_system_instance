---
name: impl-storage-system
docType: ImplDoc
scope: builtin-storage-system
ownerRefs: [{kind: ServiceDesc, name: builtin-storage-system}]
---
# ImplDoc — builtin-storage-system 怎么实现（NAS + OSS）

## 1. 三层架构（R1.3 / R1.6）

| 层 | 载体 | 放什么 | 节奏 |
|---|---|---|---|
| primary | 本地文件夹 git（文档库本体） | 全部文档对象、scheme、ops 不在此 | 每次 Apply 即 commit |
| backup | NAS（NFS/SMB 挂载） | 文档库 git remote 镜像 + 大文件/LFS + ops DB 每日快照 | push 每 10min（TaskScheme `sync`）+ 快照每日 |
| archive | OSS（对象存储） | WorkServiceTemplate 镜像文件地址（install 取件）、构建产物（带 digest）、冷归档（>90d 的 DriftReport/ops 冷数据） | 事件驱动（产物入库即传）+ 冷转储定时 |

```
本地 git(权威) ──sync 10m──► NAS remote(热备)          ──冷转储──► OSS(归档)
构建产物 ──────────────────────────────────put+digest──►OSS(services/<name>/)
模板镜像 ◄─pull+digest 校验────────────────────────────OSS(templates/<name>/)
```

## 2. Connector 实现要点

| Connector | ops | 说明 |
|---|---|---|
| `gitfs` | commit/push/fsck/restore | 文档轨全部操作；NAS remote 就是普通 git remote（挂载点路径） |
| `nas-driver` | snapshot/verify/quota | ops DB 快照（sqlite 文件级）、LFS 对象同步；NFS 不可达→condition Backup=False→Event(warning) |
| `oss-driver` | put/get/head/lifecycle | 产物与镜像；digest 强校验；分段上传大镜像 |

（v0.8：驱动鉴权一律走 Provider.auth.secret，Credential 概念已删 A40）

## 3. guarantees（怎么保障 Desc 的 acceptance）

- A1（10min 备份）：TaskScheme `sync`（cron */10）→ push NAS + 校验 fsck；延迟指标进 MetricsInfo。
- A2（可恢复）：季度恢复演练 = verify 模板全深度跑一次（NAS 克隆→临时目录→checkout 任意提交→比对 digest），DriftReport 留痕。
- A3（digest 可校验）：产物 put 时算 digest 回写 ImplDoc/DriftReport；模板镜像 pull 时校验（install-service.md 规则1）。
- A4（三层健康）：每层一个 condition（Primary/Backup/Archive），探针各自 driver 的 head/fsck。

## 4. 关键取舍

- **文档库不做多主**：NAS 只是 remote，权威唯一（本地）。断 NAS 不影响写（本地 commit 照常，sync 挂起重试）——可用性优先于对称冗余。
- **ops DB 快照走文件级**（sqlite 单文件+WAL checkpoint），不引入 DB 复制——DB 可重建，轻备份即可（runtime/ops-log.md §3）。
- 大文件（镜像 tar）**不进 git**（.gitignore+LFS 白名单），直接 OSS/NAS——防文档库膨胀（H2 缓解）。

## 5. 可行性（摘要，全文见 feasibility.md）

| 项 | 评级 | 说明 |
|---|---|---|
| NAS=git remote | ✅ | 普通 NFS 挂载点放 bare repo，零新组件 |
| OSS 大镜像分发 | ✅ | 分段上传+digest；带宽是唯一变量（局域 NAS 可作镜像缓存） |
| sqlite 文件快照 | ✅ | WAL checkpoint 后拷贝即一致快照 |
| 恢演练季度 | ⚠️ 纪律 | 排进 deploy 的 scheduling.yaml，忘记=drift 可见 |
