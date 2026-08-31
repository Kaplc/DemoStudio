---
name: editor_screenshot_tool_removed
description: 更新编辑器工具可用性：editor_emit/editor_click/editor_read 等已可用；editor_screenshot 仍禁用
type: project
---
## 编辑器工具可用性更新

**Problem:** 旧记忆记录 editor_emit/editor_click/editor_read 不可靠，以及编辑器工具不可用。

**Cause:** DemoStudio 编辑器的 Playwright CDP 连接在早期版本中存在问题，但经过迭代修复后，编辑器 UI 工具（editor_emit/editor_click/editor_read/editor_type/editor_scroll/editor_hover）已经可以正常使用。

**Solution:** 以下工具在编辑器中可用：
- `editor_emit` — 调用编辑器 AI 事件（如 editor.getState, editor.togglePanel 等）
- `editor_click` — 点击编辑器 UI 元素
- `editor_read` — 读取编辑器 UI 元素文本/属性
- `editor_type` — 在编辑器输入框中输入文字
- `editor_scroll` — 滚动编辑器 UI 元素
- `editor_hover` — 悬停编辑器 UI 元素

**注意**：`editor_screenshot` 工具已被用户要求移除，**不要使用或建议该工具**。

**How to apply:** 在编辑器自动化操作中，可以根据场景选择合适的工具。对于游戏内 AI 事件操作，仍优先使用 `emit_ai_event`（走 MCP 通道）。对于编辑器 UI 操作（如点击按钮、读取面板文字），可以使用 `editor_click`/`editor_read` 等工具。
