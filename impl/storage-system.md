---
name: impl-storage-system
docType: ImplDoc
scope: builtin-storage-system
ownerRefs: [{kind: ServiceDesc, name: builtin-storage-system}]
---
# ImplDoc — builtin-storage-system 怎么实现（本机目录存储）

> 2026-11-27 用户裁定：**builtin 就本机存储**。builtin=随 core_system 默认代码带出、跑在本机、零外部依赖（concepts/builtin.md 的定义）；NAS/OSS 是外部基础设施，不是内置概念。旧版"NAS+OSS 三层"作废——那属于部署方接了 nas/oss connector 之后的部署形态，与 builtin 无关。

## 1. 存储形态：一个本机目录

builtin-storage-system 全部职责 = 管好 storage root 这一个本机目录：

```
storage root（本机目录，随实例）
├─ docs/      文档库本体（git 仓，权威；Apply=commit）
├─ files/     大文件与构建产物（digest 命名，不进 git）
├─ snapshots/ ops DB 快照（sqlite 文件级）
└─ templates/ WorkServiceTemplate 镜像（install 取件，digest 校验）
```

| 子目录 | 放什么 | 节奏 |
|---|---|---|
| `docs/` | 全部文档对象、scheme；ops 不在此 | 每次 Apply 即 commit |
| `files/` | 构建产物、镜像 tar、其他大文件（digest 命名） | 产物入库即写 |
| `snapshots/` | ops DB 快照（sqlite 单文件+WAL checkpoint） | 每日 |
| `templates/` | 模板镜像（install 取件时校验 digest） | install 时 pull |

## 2. 为什么没有 NAS/OSS

- **builtin 的定义就是零外部依赖**：随默认代码带出、装完即用、跑在本机。要求用户先有 NAS 或 OSS 才能用内置系统，直接违反 builtin 语义。
- **NAS/OSS 属部署形态**：要远端备份/归档，部署方从 workservice connector 库显式接 nas/oss connector；接上之后，远端 sync/归档/冷转储 = 部署配置的 Task/Workflow 的事。storage-system 本体不感知、不承诺。
- resolver/install 链里的远端源同理：**local 是唯一内置源**；nas/oss 源只有显式接了 connector 才存在。

## 3. Connector 实现要点

| Connector | ops | 说明 |
|---|---|---|
| `gitfs` | commit/fsck/restore | 文档轨全部操作（本地仓） |
| 本地目录 op | put/get/head/verify | files/snapshots/templates 四目录统一读写；digest 强校验；快照=WAL checkpoint 后拷贝 |

（v0.8：驱动鉴权一律走 Provider.auth.secret，Credential 概念已删 A40。旧版 `nas-driver`/`oss-driver` 从本系统组成中移除——归 workservice connector 库，部署方可选接入。）

## 4. guarantees（怎么保障 Desc 的 acceptance）

- A1（快照）：ops DB 每日快照落 snapshots/，滚动保留 N 份；快照延迟指标进 MetricsInfo。**内置不承诺远端备份**——远端是外接 connector 后部署方自配的加分项。
- A2（可恢复）：恢复演练 = snapshots/ + docs/ 重建到临时目录→checkout 任意提交→比对 digest，DriftReport 留痕；季度纪律排进 deploy 的 scheduling.yaml。
- A3（digest 可校验）：产物写 files/ 时算 digest 回写 ImplDoc/DriftReport；模板镜像取件时校验（install-service.md 规则1）。
- A4（健康）：storage root 一个 condition（Primary）：盘满/权限/fsck 探针；异常 Event(warning)。旧版 Backup/Archive 双 condition 作废。

## 5. 关键取舍

- **权威唯一=本机目录**。没有"远端镜像"承诺，断网/断 NAS/OSS 一概不影响任何功能——因为根本不依赖。可用性天然满足（本地写本地读）。
- **ops DB 快照走文件级**（sqlite 单文件+WAL checkpoint），不引入 DB 复制——DB 可重建，轻备份即可（runtime/ops-log.md §3）。
- 大文件（镜像 tar）**不进 git**（.gitignore+LFS 白名单），落 files/——防文档库膨胀（H2 缓解）。
- **远端是加分项不是承诺**：接了 nas/oss connector，sync/归档=部署的 Task/Workflow；没接，系统完整可用。旧版"文档库 10min push NAS"的 A1 承诺作废。

## 6. 可行性

| 项 | 评级 | 说明 |
|---|---|---|
| 本地目录+git | ✅ | workservice gitfs+sqlite 已有实现形态，零新组件 |
| digest 校验链 | ✅ | 写入/取件两端各算一次比对，纯代码 |
| sqlite 文件快照 | ✅ | WAL checkpoint 后拷贝即一致快照 |
| 远端外接 | ✅ | connector 模式已验证（onedev-driver 同构）；接与不接都不改内置契约 |
| 恢演练季度 | ⚠️ 纪律 | 排进 deploy 的 scheduling.yaml，忘记=drift 可见 |
