---
name: editor_tools_channel_choice
description: DemoStudio 自动化通道选择：游戏运行层走 emit_ai_event，编辑器 UI 用 editor_* CDP 工具；editor_screenshot 已移除勿建议
type: project
prefix: harness/ds-editor-tools
---
规则：DemoStudio 自动化按目标层选通道——**游戏运行层**（HUD/场景/游戏内按钮）走 `emit_ai_event`（ai.getHUD/ai.clickActor 等）及 get_hud/mouse_click 等运行层工具；**编辑器 UI**（面板/按钮/输入框）用 `editor_click`/`editor_read`/`editor_type`/`editor_scroll`/`editor_hover`/`editor_emit`（CDP :9222，已修复可用）；`editor_restart` 高危（重启整个 Electron 应用）。

**Why:** 早期 editor_* CDP 工具连到 Chrome DevTools 页面、AIModule 未就绪（旧结论"全走 emit_ai_event"因此产生）；CDP 通道迭代修复后编辑器 UI 工具已可靠，旧结论过时（2026-09-09 更新）。`editor_screenshot` 已按用户要求移除（2026-09-06），勿使用或建议。

**How to apply:** 编辑器 UI 自动化直接用 editor_* 工具；游戏内状态/交互用 emit_ai_event / get_hud / mouse_click；需要截图时不要找 editor_screenshot（不存在）。
