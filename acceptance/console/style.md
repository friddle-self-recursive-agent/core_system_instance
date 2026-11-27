# console style.md —— 统一样式规范（2026-11-26 用户裁决批）

## 〇、指令与基准

用户指令（2026-11-26）：「页面风格。整个 style 及其混乱。该大不大。button 样式乱七八糟。统一做一套样式.md，然后样式默认 websearch 查下 deepseek，和 deepseek 一致。」

**基准=DeepSeek 网页面板实测 token 体系**（第三方对 deepseek.com getComputedStyle 测量 + 品牌色册，来源见文末）。核心设计原则三条：①**强调色不是动作色**——品牌蓝 #4d6bfe 只做强调/链接/chip，**主按钮是暖近黑 #1a1615**；②**边框承载层级**——黑色 alpha 四级阶梯，不靠灰阶色值；③**玻璃面+发丝环**做深度，不靠重投影。

## 一、现状混乱证据（第一手测量，2026-11-26）

| 病灶 | 实测 | 位置 |
|---|---|---|
| 字号 15 档混用含半像素 | 10/10.5/11/11.5/12/12.5/13/13.5/14/15/17/20/22/24/28px；正文大量 10.5-12px（该大不大实锤） | styles/*.css 全量 |
| 裸色值 40+，两蓝并存 | 亮色 accent=#4d6bfe（DeepSeek）与暗色 accent=#3b82f6（Tailwind）两个体系混血；两绿并存 #16a34a/#22c55e/#4ade80；rgba(77,107,254,.x) 手写 8 档 alpha | base.css 亮暗双主题 |
| radius 10 档，六成绕过 token | 4/5/6/7/8/10/14/16/999/50% 并存；`var(--rad)` 仅 13 处 vs 裸值 37 处 | components/screens.css |
| token 层有名无实 | 变量齐全（--panel/--text/--accent 族）但裸值绕过率高；暗色主题独立漂移 | base.css:1-40 |
| 按钮无变体体系 | button 样式散落各屏按元素/临时类定义，无 primary/secondary/ghost 分级 | screens/components.css |

## 二、Token 定版（保留现有 var 名——值全部换 DeepSeek 定版；新概念用 --ds-* 新增）

> 裁决：**不做全量改名**（--ds-* 迁移是零视觉收益的大churn）；现有 var 名是几百处引用的稳定契约，重赋值即可。暗色主题**本轮删除冻结**（两套色板继续漂移是病灶之一），后续需要时按 --ds-dark 前缀重做。

### 2.1 色板（亮色唯一基准）

| var | 定版值 | 说明 |
|---|---|---|
| --bg | `#f9f8f8` | 页面画布（暖白，非纯白） |
| --panel | `#ffffff` | 实白面板/卡 |
| --panel-2 | `rgba(0,0,0,.02)` | 微凹面 |
| --panel-3 | `rgba(0,0,0,.05)` | 凹面（表头/代码底） |
| --border | `rgba(0,0,0,.06)` | subtle 阶 |
| --border-2 | `rgba(0,0,0,.10)` | default 阶 |
| --ds-border-strong | `rgba(0,0,0,.20)` | strong 阶（新） |
| --text | `#1e232c` | 主文字（藏青黑） |
| --text-2 | `rgba(30,35,44,.70)` | 次文字（alpha 制不用灰阶） |
| --text-3 | `rgba(30,35,44,.55)` | 弱文字/placeholder（#8691a1 等价档） |
| --accent | `#4d6bfe` | 品牌蓝=**强调/选中态/chip/焦点环**；禁大面积填充、禁主按钮 |
| --accent-dim | `rgba(65,118,230,.12)` | brand wash（chip 底） |
| --ds-link | `#234792` | 正文内链接（navy，比品牌蓝深一档，新） |
| --ds-btn-bg | `#1a1615` | 主按钮暖近黑（新）；hover 提亮 `#34302c`，禁变暗 |
| --ok/--warn/--danger/--esc/--llm | `#16a34a`/`#d97706`/`#dc2626`/`#e11d48`/`#7c3aed` | 语义色各留一值；轻底统一 `rgba(<语义色>,.09)`；两绿三值归一为 --ok |
| --glass | `rgba(255,255,255,.45)` + `backdrop-filter: blur(12px)` | 仅侧栏/顶栏/悬浮抽屉；正文卡实白 |

### 2.2 字阶（4 档定死，半像素档全废）

| 档 | 值 | 用途 |
|---|---|---|
| --fs-title | `24px/600` | 屏头标题 |
| --fs-h2 | `20px/600` | 区块标题 |
| --fs-body | `15px/500` | 正文/按钮/表单（控制台默认字号，治「该大不大」） |
| --fs-small | `13px/500` | 列表行/表格/chip 常态 |
| --fs-micro | `12px/500` | **下限**：徽标/工程词形 mono/注脚；10-11.5px 全部清除 |

字体族不变：--sans = system-ui 栈（含 PingFang SC）；--mono = ui-monospace 栈（工程词形专用）。

### 2.3 圆角（5+1 档）

`--rad-sm 8px`（chip/小件）· `--rad 10px`（input/按钮/控件，全局默认）· `--ds-rad-panel 12px`（嵌套面板）· `--ds-rad-card 16px`（卡片/抽屉）· `999px`（pill）· `50%`（圆点/头像）。裸 radius 值全部清零走 var。

### 2.4 间距与阴影

- 间距档：`4/8/12/16/24/32/40`（组件内）+ `80+`（页面级留白）；gap/padding 迁移对档。
- --shadow 定版（发丝环+两层软投）：`0 0 0 1px #f1f5f9, 0 2px 4px rgba(0,0,0,.05), 0 12px 24px rgba(0,0,0,.04)`。
- 焦点环统一：`:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px }`。

## 三、组件规范

### 3.1 按钮四变体（一次定死，全站收编）

| 变体 | 类 | rest | hover | 用途 |
|---|---|---|---|---|
| 主操作 | `.btn` + `.btn-primary` | 底 --ds-btn-bg 近黑、字 #fff、radius --rad、高 36px（sm 28px/13px 字） | 提亮 #34302c | 每屏**至多一个**主操作（发布/批准/点火） |
| 次操作 | `.btn-secondary` | 玻璃白底 rgba(255,255,255,.4)、字 --text、1px --ds-border-strong navy 调、pill 999 | 边框加深 rgba(9,45,78,.36) | 表单旁/取消/次动作 |
| 幽灵 | `.btn-ghost` | 透明、字 --text | 底 rgba(0,0,0,.04) | 行内小操作/工具按钮 |
| 品牌帽 | `.btn-chip` | --accent-dim 底、#4176e6 字、1px rgba(65,118,230,.3)、18px radius、高 34px | 品牌值位移 | 蓝色强调类标签动作（如 AI 修文档） |

纪律：danger/破坏性动作=ghost 形 + --danger 字色（不引入第五变体）；禁 inline style 按钮。

### 3.2 其余组件

- **chip/kind 徽**：--fs-micro mono、pill、panel-2 底 border subtle；语义 chip 用语义色 .09 底+.text 前景（禁纯色底白字）。
- **卡**：实白 --panel、--ds-rad-card、--shadow、内边距 16/24。
- **表格/列表行**：无斑马纹；行 hover panel-2；分隔线 --border。
- **表单 input**：底 --panel、边 --border-2、radius --rad、高 36px、focus 边 --accent。
- **空态/骨架**：维持现有诚实词形纪律，仅换 token。
- **导航**：侧栏玻璃底；active 项 --accent-dim 底 + --accent 字（禁渐变蓝底 `linear-gradient(135deg,#1d3a68,#3b82f6)` 现存违例）。

### 3.3 弹窗与提示（2026-11-28 用户裁决「不要用系统弹窗……要用标准的 deepseek style 实现弹窗。默认请用 modal」）

- **原生弹窗全站禁用**：`window.confirm` / `window.alert` / `window.prompt` 一律不得出现（grep 判据=src 内三个调用清零）——原生框不受 token 体系管、无法带品牌语义、且阻断样式不可控。
- **确认类交互=modal**（默认形态）：复用 `.chat-modal` 族（mask rgba(0,0,0,.45) + panel 卡 + head 标题 + body 正文 + acts 按钮）——确认动作=主操作变体（破坏性=ghost 形 --danger 字），取消=次操作；Esc/点 mask=取消；Promise 语义（`confirmModal({title, body, confirmText, danger}) → boolean`），调用点不嵌回调地狱。
- **结果/错误提示=toast**（非阻断）：右上浮层 `.chat-toast`（panel 底+shadow+语义色左条），3.5s 自动消散；失败类 error 语义条 --danger、成功 accent——不抢主操作焦点，不打断流程。
- **判据**：任一屏触发确认/错误提示，视觉=DeepSeek 组件（同 token 同 radius 同字阶），截图无浏览器原生框。

## 四、落地批（S-01..S-06，机械迁移判据）

| # | 动作 | 判据 |
|---|---|---|
| S-01 | base.css 重写：token 定版 §2 全表落位；删除暗色主题块与旧值 | grep 旧值 #3b82f6/#0b0e14 等清零；文件 ≤800 行 |
| S-02 | components.css/screens.css 全量裸值→var：色值 40+、字号 15 档→4 档、radius→5+1 档 | `grep -E "#[0-9a-f]{3,8}" components.css screens.css` =0（token 定义文件除外）；`grep "font-size"` 仅 {12,13,15,20,24}px 五档 |
| S-03 | 按钮收编四变体：全站 button 临时样式类删除→.btn 族；主操作唯一性逐屏核对 | grep 各屏 `.btn-primary` 每屏 ≤1；UI 拍按钮区截图 |
| S-04 | 渐变蓝底/违例点清理：nav active 渐变、::selection 尾蓝改 brand alpha | grep `linear-gradient` 非法项清零 |
| S-05 | 密度回归：正文字号 10.5-12px 区升档后，列表/表格行高与截断复查（1080p 与 1100px 窄幅两档截图） | 三屏（welcome/workflows/objects）before-after 截图 + 零横向滚动 |
| S-06 | npm test 全绿+UI 拍零 pageerror；dist 重建部署 | dist/console.css 重建（豁免行数红线）；CT116 软链生效 |

## 五、来源（DeepSeek 实测依据）

- [oh-my-design DeepSeek DESIGN.md](https://oh-my-design.kr/design-systems/deepseek)（82 个 --ds-* token 实测：色板/边框阶梯/按钮四变体/字阶/间距/圆角/阴影/玻璃）
- [Brandfetch DeepSeek](https://brandfetch.com/deepseek.com)（#4D6BFE 品牌蓝 + #212327 近黑 + 白，"cool blue-and-white palette, spacious orderly compositions"）
- [360 skillhub DeepSeek 品牌指南](https://skillhub.360.com/skills/start-ten/deepseek-brand-guidelines)（#4D6BFE 首页/品牌强调 与 #3964FE 聊天内按钮蓝两档之分）

> 诚实注脚：DeepSeek 无官方公开设计规范；本规范以第三方实测为准，控制台密度场景（数据表格/mono 词形）在「主按钮近黑/品牌蓝只强调/边框阶梯/玻璃侧栏」四原则上与 DeepSeek 一致，字阶与圆角按控制台可读性裁剪（micro 12px 下限、card 16px）——偏差逐条已标注，不冒充逐像素复刻。
