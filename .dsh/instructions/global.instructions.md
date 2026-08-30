---
prefix: /
---
# DemoStudio 全局开发规范

> 本指令为全局兜底指令：Agent 读取项目根下**任意路径**的文件（`src/`、`doc/`、`electron/`、`scripts/`、根目录配置等）时自动注入；具体目录指令（如 `engine.instructions.md`、`harness.instructions.md`）命中时优先于本指令。

## 文档优先

- 处理引擎/编辑器/项目相关任务前，先查 `doc/README.md` 定位文档索引，再读对应系统的文档，避免重复调研或与既有设计冲突
- 涉及蓝图编辑器撤销/重做时必读 `doc/editor/undo_redo_system.md`
- 涉及 Ursina API 兼容性时参考 `doc/engine/ursina_reference.md`

## 开发流程约束

- **Lint 检查**：每次修改完成文件后必须做 lint 检查，全部归零才能结束
- **文档同步**：每次修改或添加新功能后，检查 `doc/` 是否有需要创建或更新的文档，保持文档实时最新
- **日志埋点**：生命周期方法、分支判断、异常处理、IPC/事件、文件 IO 等关键位置必须加 `logger.info/warn/error`，以"运行时看日志能还原执行路径"为准
- **组件优先**：添加新功能优先用组件（BehaviourScript/UIScript）实现，非必要不修改拥有者（owner）类

## 资产与配置

- **组件添加新字段**：必须同步更新资产文件与资产检查器（assetLint）
- **创建/编辑资产**（`.blueprint.json` / `.scene.json` / `.config.json` / `.table.json` / `.widget.json`）必须遵循对应技能规则，产出零 lint 错误

## 浏览器调试（DSH Agent 专用）

- 调试编辑器 UI 时可用 VS Code 内置 Playwright 浏览器工具操作 `http://localhost:5174/` 页面
- 操作前必查 `doc/testing/playwright_commands.md`（已知坑：hidden 页面 dispatchEvent、HMR 不重建实例、deferredResultId 等）；遇到新坑必须当场更新该手册
- 浏览器中 `electronAPI` 不可用，涉及文件读写需走编辑器自身能力

## 运行日志

- `logs/` 下可读控制台日志（`console_YYYY-MM-DD_HHmmss.log`）与 DSH agent 日志（`logs/dsh-agent.log`）排查运行问题
- DSH agent 引导失败（degraded）时，第一现场是 `logs/dsh-agent.log`，先读它再判断

## 开发中关键流程必须添加log跟踪