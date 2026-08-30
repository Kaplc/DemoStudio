---
name: agent_window_log_pitfall
description: Agent 窗口日志无法进入主窗口 Console 面板与日志文件的根因及修复方向
type: project
---
## Agent 窗口日志丢失

**Problem:** agent 面板在独立 Electron 窗口时，`logger.info` 既不能显示在主窗口 Console 面板，也无法写入 `console_*.log` 文件。

**Cause:** ① `logger` 是 JS 单例，但每个 BrowserWindow 有独立 V8 上下文，主窗口注册的 `setOutputCallback` 无法跨窗口共享；agent 窗口只渲染 AgentPanel，不渲染 Console，所以 `onOutput` 未注册。② 文件写入依赖主进程监听 `webContents.on('console-message')`，但该监听只挂在 `mainWindow` 上，`openAgentWindow()` 创建的 `_dshWebuiWindow` 未注册。③ 废弃的 `write-log-file` IPC 保留空实现（main.ts 中 `ipcMain.handle('write-log-file', async () => {})`），不再写盘。

**Solution:** 在 `openAgentWindow()` 中为 `_dshWebuiWindow.webContents` 同样添加 `console-message` 监听，将消息追加到 `CONSOLE_LOG_FILE`；若需要同步到主窗口 Console，需通过主进程广播或共享日志事件通道，不能依赖 renderer 内单例。

**Applicable:** electron/main.ts（agent 窗口创建）、src/engine/Logger.ts、src/components/Console.tsx
