---
name: demo_editor_emit_ai_event_channel
description: DemoStudio 编辑器操作应走 emit_ai_event 通道，editor_emit/editor_read/editor_click 等 DOM 工具连到的是 Chrome DevTools 或 AIModule 未就绪
type: project
---
## 编辑器 AI 操作通道

**Problem:** 通过 `editor_emit` 发送 `editor.openScenePreview` 报 AIModule 未就绪；通过 `editor_click`/`editor_read` 探测界面时读到的却是 Chrome DevTools 页面，无法直接操作 DemoStudio 编辑器 DOM。

**Cause:** DemoStudio 编辑器前端不是可通过常规 DOM 工具直接操作的页面，AIModule 事件通道在会话中未初始化；而 `emit_ai_event` 是直接对接编辑器内核的可靠通道，能正确派发事件并读取状态。

**Solution:** 需要打开场景、切换工程、读取编辑器状态等操作时，一律使用 `emit_ai_event` 发送事件（如 `editor.openScenePreview`、`editor.getState`），不要使用 `editor_emit`、`editor_click`、`editor_read` 等面向浏览器 DOM 的工具。

**Applicable:** 编辑器自动化 AI 工具调用、场景预览开关、面板状态读取。
