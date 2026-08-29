---
description: "Use when creating, modifying, or navigating documentation files under doc/. Provides a quick index of what each folder covers and which document to read for a given topic."
applyTo: "doc/**"
---
# doc/ 文档目录速查

`doc/` 是 DemoStudio 的系统设计文档库。**修改任何引擎/编辑器功能前，先查对应文档避免重复调研。**

---

## 文件夹速查表

| 文件夹 | 覆盖范围 | 入口文档 |
|--------|----------|----------|
| **`doc/`（根目录）** | 系统总览索引（`system_overview.md`） | `system_overview.md` |
| **`doc/engine/`** | 引擎基础设施（`src/engine/`）：实体层级、游戏流程、渲染、UI、输入/物理/脚本、资产工具、AI 事件、GM 命令、导航、Ursina 参考 | `engine/entity_system.md` |
| **`doc/editor/`** | 编辑器子系统（`src/editor/` + `src/components/`）：编辑器核心、视口、选择变换、蓝图编辑、撤销重做、属性检查器、资产/代码 lint、React 面板、UI 增强/锚点、MCP 集成、Agent 面板 | `editor/core_system.md` |
| **`doc/projects/`** | 项目级文档：ClashMaster（fish）项目总览、关卡系统、战斗系统、gameplay 代码规范 | `projects/clash_master.md` |
| **`doc/harness/`** | Harness 工程与 DSH 集成：agent 常驻化、所有权 watchdog、崩溃自愈、preset 同步、VS Code PRD | `harness/dsh_engine_integration.md` |
| **`doc/testing/`** | 测试与调试：Playwright 浏览器测试流程、命令速查、MCP 调试 | `testing/playwright_testing.md` |

---

## 按功能找文档

| 你想了解… | 读这个文件 |
|-----------|-----------|
| 实体/Actor/组件系统 | `doc/engine/entity_system.md` |
| 游戏流程（GameMode/GameState/World） | `doc/engine/gameflow_system.md` |
| 渲染管线、相机、后处理 | `doc/engine/rendering_system.md` |
| 世界 UI / HUD / UI 控件 | `doc/engine/ui_system.md` |
| CanvasUIComponent / hitTest | `doc/engine/ui_canvas_component.md` |
| 输入、物理、脚本注册 | `doc/engine/input_physics_script_system.md` |
| 资产注册、蓝图、配置表、存档 | `doc/engine/asset_tools_system.md` |
| AI 事件系统 / MCP 控制游戏 | `doc/engine/ai_system.md` |
| GM 调试命令 | `doc/engine/gm_system.md` |
| Ursina API 兼容性参考 | `doc/engine/ursina_reference.md` |
| 编辑器核心 / 事件总线 / 快捷键 | `doc/editor/core_system.md` |
| 视口（Scene / Game） | `doc/editor/viewport_system.md` |
| 选择与变换 / TransformGizmo | `doc/editor/selection_transform_system.md` |
| 蓝图编辑 / UndoManager | `doc/editor/blueprint_edit_system.md` |
| 蓝图撤销/重做 | `doc/editor/undo_redo_system.md` |
| Inspector 属性编辑 | `doc/editor/property_edit_system.md` |
| 资产预览与 assetLint | `doc/editor/asset_preview_lint_system.md` |
| 代码扫描 CodeLint | `doc/editor/code_lint_system.md` |
| React 面板组件 / stores | `doc/editor/ui_components_system.md` |
| UI 增强（Tween/Toast/Tooltip） | `doc/editor/ui_enhancement_system.md` |
| UI 锚点布局 | `doc/editor/ui_anchor_system.md` |
| MCP 集成与调试桥 | `doc/editor/mcp_integration.md` |
| Agent 面板通信 / 事件流 | `doc/editor/agent_panel_system.md` |
| ClashMaster 项目总览 | `doc/projects/clash_master.md` |
| 关卡系统 / 地图面板 | `doc/projects/level_system.md` |
| 战斗系统 / 放兵 / 防御塔 | `doc/projects/battle_system.md` |
| gameplay 代码规范（七角色边界） | `doc/projects/gameplay_code_standard.md` |
| Harness 工程总览 | `doc/harness/harness_system.md` |
| DSH agent 常驻化 / 崩溃自愈 | `doc/harness/dsh_engine_integration.md` |
| Playwright 浏览器测试 | `doc/testing/playwright_testing.md` |
| Playwright 命令速查 | `doc/testing/playwright_commands.md` |
| Playwright MCP 调试 | `doc/testing/playwright_mcp_commands.md` |
| DSH agent 常驻化 / 崩溃自愈 | `doc/harness/dsh_engine_integration.md` |
| ClashMaster 项目 | `doc/projects/clash_master.md` |

---

## 编写新文档的规则

1. **先查 `doc/README.md`**：确认放在哪个子文件夹，更新索引表。
2. **模板**：照抄同目录下任意现有文档的章节结构（概述 → 核心类 → 使用方法 → 工作流程 → 边界条件）。
3. **代码事实**：所有类名/方法名必须能在源码中 grep 到，禁止凭印象描述 API。
4. **不要重复**：新内容如果已被其他文档覆盖，用相对链接引用，不要复制。
