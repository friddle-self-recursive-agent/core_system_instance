# acceptance/ — 验收与设计基线目录

分层（R-PUB-3 / R-DOC-5）：

| 路径 | 内容 | 入库 |
|---|---|---|
| `acceptance/loop-<seq>.md` 等根文件 | 运行时验收报告 / loop 版本记录 | **否**（.gitignore） |
| `acceptance/<主题>/` | 设计 / 验收基线文档（如 `console/console-ui.md`） | **是** |
| `acceptance/<主题>/<doc>.md.metadatainfo` | 文档索引侧车（tag / tag_type / importance 0–100，R-DOC-6） | **是** |

- 主题子目录按领域分：`console/`、`agent/`、`workflow/`…；一主题一目录，多文件夹区分。
- 运行时报告只落 `acceptance/` 根，不混入主题目录；设计结论影响系统时走文档更新提交（终态制）。
