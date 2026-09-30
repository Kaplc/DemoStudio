---
name: agent_window_log_pitfall
description: 日志路由坑合集：agent 独立窗口日志进不了主窗/日志文件的修复 + 主进程日志不落 console_*.log（只收渲染层转发），主进程状态用 MCP 9877 探
type: project
prefix: [electron/main.ts, src/engine/Logger.ts]
---
**Problem:** agent 面板独立 Electron 窗口时，logger.info 既不显示在主窗口 Console 面板、也不写入 console_*.log。

**Cause:** renderer 的 logger 是 JS 单例，但每个 BrowserWindow 是独立 V8 上下文——主窗口注册的 setOutputCallback 跨窗口不可见；文件写入依赖 webContents 的 console-message 监听，而监听只挂在主窗口上。

**Solution:** 已修复（2026-09-09 核实）：electron/main.ts `openAgentWindow()` 已为 _dshWebuiWindow 单独挂 console-message 监听写入同一日志文件。沉淀教训：**每新增一个 BrowserWindow 都要单独挂 console-message 监听**，不能依赖 renderer 内单例或跨窗口回调。

**Applicable:** electron/main.ts（窗口创建）、src/engine/Logger.ts、任何多窗口 Electron 改造。

## 主进程日志不落 console_*.log（2026-09-30 实测）

**Problem:** grep `logs/console_*.log` 找主进程的 `[DSH]`/`[dsh-adapter]` 日志必然扑空，误判"适配层没生效"。

**Cause:** console_*.log 只收**渲染进程** console（webContents console-message 转发，per 窗口挂监听）；主进程 console.log 走 dev 终端 stdout，不落任何文件。

**Solution:** 验证主进程状态/适配层走 **MCP HTTP**：`POST http://127.0.0.1:9877/api/command` body `{"command":"dsh-status"}`（端口从 9877 起逐个探；响应含 ready/port/lifecycle/adapter）。

**Applicable:** 一切"主进程行为验证/适配层生效确认"；console_*.log 只用于渲染层 [Trace]/[Agent] 线索。
