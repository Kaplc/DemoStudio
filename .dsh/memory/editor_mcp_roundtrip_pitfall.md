---
name: editor_mcp_roundtrip_pitfall
description: 新增需渲染进程返回数据的编辑器 MCP/DSH 命令必须加入主进程往返模式 if 列表，否则返回空数据
type: project
prefix: electron/main.ts
---
**Problem:** 给 MCP/DSH 加 get_scene_outline/get_ui_outline/get_assets 后调用返回空数据（只有 `{status:"ok", command:...}`，没有 outline/files 字段）。

**Cause:** electron/main.ts 的 /api/command 处理器只有白名单内命令走「requestId 往返模式」（发 IPC 到渲染进程 → 等 sendMCPResponse 回传）；新命令落进 fire-and-forget 分支，渲染进程的响应无人接收。

**Solution:** 新增需要渲染进程返回数据的命令时，必须同步加入 main.ts 往返模式的 if 条件。另：CDP `Input.dispatchMouseEvent` 在 Electron 中可能 15s 超时，需增大 timeout 或换输入通道。

**Applicable:** electron/main.ts MCP 命令分发处；一切"编辑器命令需要返回数据"的新增。
