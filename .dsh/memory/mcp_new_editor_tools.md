---
name: mcp_new_editor_tools
description: MCP/DSH 编辑器信息工具：get_scene_outline/get_ui_outline/get_assets + CDP 工具，含主进程往返模式踩坑记录
type: project
---
# MCP + DSH 编辑器信息工具（2026-08-19）

**踩坑/教训类条目**

**Problem:** 给 MCP Server 和 DSH 插件添加 `get_scene_outline`/`get_ui_outline`/`get_assets` 三个新工具后，调用返回空数据（只有 `{status: "ok", command: "xxx"}`，没有 outline/files 字段）。

**Cause:** Electron 主进程 `electron/main.ts` 的 `/api/command` 处理器中，只有特定命令名走了「往返模式」（创建 requestId → 发 IPC 到渲染进程 → 等 `sendMCPResponse` 回传）。新命令不在列表中，走了 fire-and-forget 分支，渲染进程的 `sendMCPResponse` 没有对应的 pending promise 接收。

**Solution:** 在 `electron/main.ts` 第 1758 行的 if 条件中，追加 `|| cmd.command === 'get_scene_outline' || cmd.command === 'get_ui_outline' || cmd.command === 'get_assets'`。

**Applicable:** `electron/main.ts` MCP 命令分发处。任何新增的需要渲染进程返回数据的 MCP 命令，都必须加到这个 if 条件中，否则主进程不会等待渲染进程的响应。

## 新增工具清单

| 工具 | MCP (mcp-server.mjs) | DSH (ds-engine-tools) | 渲染进程 (EditorInitializer.ts) |
|---|---|---|---|
| `get_scene_outline` | ✅ callEditor → HTTP | ✅ callEditor → HTTP | ✅ case handler |
| `get_ui_outline` | ✅ callEditor → HTTP | ✅ callEditor → HTTP | ✅ case handler |
| `get_assets` | ✅ callEditor → HTTP | ✅ callEditor → HTTP | ✅ case handler |

## CDP 浏览器操控工具（mcp-cdp.mjs）

独立模块 `editor/mcp-cdp.mjs`，通过 WebSocket CDP（端口 9222）操控 Electron 渲染进程 DOM。13 个工具：
- cdp_click/type/read/hover（DOM 操作）
- cdp_evaluate（执行 JS）
- cdp_navigate/wait/scroll（页面控制）
- cdp_screenshot（截图）
- cdp_list_tabs（列出页面）
- cdp_mouse_click/mouse_move/key_press（输入模拟）

注意：CDP 截图 `Page.captureScreenshot` 和 `Input.dispatchMouseEvent` 在 Electron 中可能超时（15s），需要增大 timeout 或用替代方案。
