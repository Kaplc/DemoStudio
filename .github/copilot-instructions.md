# DemoStudio 项目约定

## 文档参考（AI 专用）

`doc/` 目录下包含系统架构与设计文档，AI 在处理相关任务时应先查阅对应文档，避免重复调研或做出与既有设计冲突的改动：

- `doc/README.md` — 文档目录索引（所有引擎/编辑器系统文档入口，先查此文件定位）
- `doc/system_overview.md` — 系统总览：引擎/编辑器/项目/资产类型全量统计与架构索引（改动前先查此文档定位子系统）
- `doc/engine/*.md` — 引擎系统文档（实体/游戏流/渲染/UI/输入物理脚本/资产工具/AI 事件，每个系统一份）
- `doc/editor/*.md` — 编辑器系统文档（核心/视口/选择变换/蓝图编辑/预览与检查/UI 组件，每个系统一份）
- `doc/undo_redo_system.md` — 蓝图编辑器撤销/重做系统设计（涉及蓝图编辑/UndoManager 时必读）
- `doc/ursina_reference.md` — Ursina 参考文档（涉及 API 兼容性设计时参考）

## 浏览器调试模式（AI 专用）

AI 可通过 VS Code 内置的 Playwright 浏览器工具操作页面，**不影响 Electron 窗口**：
1. `open_browser_page` — 在集成浏览器中打开 `http://localhost:5173/`
2. `click_element` — 点击页面上的按钮/元素
3. `read_page` — 读取页面当前状态快照
4. `screenshot_page` — 截取页面截图

适用于快速验证 UI 逻辑，但 `electronAPI`（如 `readJsonFile`）在浏览器中不可用。

### 浏览器调试手册（AI 专用，必查 + 必更新）

- **操作前必查**：`doc/playwright_commands.md` — Playwright 命令速查 + 踩坑（编辑器通用），涉及任何浏览器端调试/测试时先查此手册，避免踩已知坑（hidden 页面 dispatchEvent、HMR 不重建实例、deferredResultId 等）
- **遇到新坑/新命令自动更新**：调试过程中发现手册未覆盖的坑、有效的新命令/片段、或手册描述与实际行为不符时，**必须当场更新 `doc/playwright_commands.md`**（追加踩坑表行、补充代码片段、修正描述），保持手册永远是最新最准的
- 方法论/流程详解见 `doc/playwright_testing.md`（与手册互补）

## 运行日志（AI 专用）

`logs/` 目录下包含完整的运行日志信息文件，AI 可直接读取这些文件来查看编辑器或游戏的运行状态、错误信息和调试输出：

### 日志文件类型

1. **控制台日志**（每次启动独立文件）：`logs/console_2026-07-16_201808.log`  
   浏览器控制台输出的完整记录，文件名格式为 `console_YYYY-MM-DD_HHmmss.log`。每次启动编辑器会生成一个新文件。使用 `read_file` 工具直接读取对应日志文件，例如：

- 最新控制台日志：查看 `logs/` 目录下最新的 `console_` 开头的文件
适用于诊断启动问题、运行时错误、崩溃原因等场景，无需依赖 Electron 窗口或浏览器页面。

### 日志埋点规范（AI 专用）

在编写代码时，应在关键流程位置添加 `logger.info` / `logger.warn` / `logger.error` 日志跟踪，以便排查问题：

1. **生命周期方法**：构造、初始化、启动、暂停、销毁等阶段必须加 `logger.info` 记录进入/退出
2. **分支/判断逻辑**：条件分支、状态迁移处加 `logger.info` 记录流向和关键变量
3. **异常/错误处理**：`catch` 块必须用 `logger.error` 记录错误信息和上下文
4. **IPC/事件处理**：事件回调入口加 `logger.info` 记录事件名和参数
5. **文件/网络 IO**：读取、写入、请求等操作前后加 `logger.info` 记录路径、大小、耗时

> 详细程度以"运行时看到日志能还原执行路径"为准，避免过度记录高频循环体。

## 组件添加新字段

组件添加新字段要同步更新资产和资产检查器

## 开发规则：组件优先

**添加新功能优先用组件（Component / BehaviourScript / UIScriptComponent 等）实现，非必要不修改拥有者（owner）。**

- 拥有者指承载功能的宿主类（Actor / GameMode / GameInstance 等），修改它们会把跨子系统逻辑耦合进单一类中。
- 新行为应优先通过"挂组件/挂脚本"的方式实现：组件内部自管生命周期（onStart / onUpdate / onDestroy），并自行清理资源与订阅。
- 若需要多个拥有者协作（如面板开关互斥 HUD 显隐），拥有者只广播状态（公开回调字段，如 `onBuildModeChange`），由相关组件注册回调自治处理。
- 修改拥有者前先确认该逻辑是否只能由拥有者承载（如世界级生命周期、输入路由、核心状态机），否则优先组件化。
