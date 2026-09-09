---
name: agent_window_log_pitfall
description: Agent 独立窗口日志进不了主窗口 Console/日志文件的根因（renderer 单例不跨窗口）与已落地修复（2026-09-09 核实）
type: project
prefix: electron
---
**Problem:** agent 面板独立 Electron 窗口时，logger.info 既不显示在主窗口 Console 面板、也不写入 console_*.log。

**Cause:** renderer 的 logger 是 JS 单例，但每个 BrowserWindow 是独立 V8 上下文——主窗口注册的 setOutputCallback 跨窗口不可见；文件写入依赖 webContents 的 console-message 监听，而监听只挂在主窗口上。

**Solution:** 已修复（2026-09-09 核实）：electron/main.ts `openAgentWindow()` 已为 _dshWebuiWindow 单独挂 console-message 监听写入同一日志文件。沉淀教训：**每新增一个 BrowserWindow 都要单独挂 console-message 监听**，不能依赖 renderer 内单例或跨窗口回调。

**Applicable:** electron/main.ts（窗口创建）、src/engine/Logger.ts、任何多窗口 Electron 改造。
