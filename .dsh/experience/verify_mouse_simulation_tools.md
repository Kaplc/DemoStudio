---
name: verify_mouse_simulation_tools
task_type: test/verification
outcome: partial
date: 2026-09-01
---
## Summary

验证新加的 mouse_click 等模拟玩家输入工具能否端到端使用：先 mount_plugin 挂载插件，再用 emit_ai_event 探测编辑器/游戏状态，发现 editor DOM 工具不可靠后改为纯 MCP 通道，并通过 grep launchGame 定位启动游戏的 MCP 命令。

## Lessons

验证插件新工具要先挂载再启动游戏，状态探测优先用 emit_ai_event（editor.getState/ai.getState）而不是 editor_emit/editor_click/editor_read——这些 Playwright 工具在 DemoStudio 编辑器上不可靠（CDP 连到的常是 DevTools 页面而非编辑器 DOM）；启动游戏没有 editor.startGame/launchGame 这类编辑事件，launchGame 是 MCP 命令，应通过 emit_ai_event 触发，找不到入口时用 grep 在 src/editor、electron 下搜 startGame/launchGame 定位。

## Effective Path

mount_plugin 挂载后，用 emit_ai_event 发 editor.getState/ai.getState 确认状态，游戏未启动时 grep MCP 命令名（如 launchGame）而非尝试 DOM 点击。
