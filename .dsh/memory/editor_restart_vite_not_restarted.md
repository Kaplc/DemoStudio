---
name: editor_restart_vite_not_restarted
description: editor_restart 只 relaunch electron 不恢复 Vite dev server，编辑器停「加载中」的根因与恢复路径
type: project
prefix: [electron/main.ts]
---

**Problem:** 2026-09-30 并行会话调 editor_restart 后，编辑器永远停在「加载中」（loading.html）：CDP `/json/list` 只有 loading 页、渲染层起不来，实机验证/取证全部受阻。

**Cause:** editor_restart 是 `app.relaunch + app.exit`，只重启 electron 本体；renderer 页面由 `npm run electron:dev` 拉起的 **Vite dev server**（5173+）供码，exit 时父进程树连带杀掉 Vite，新 electron 实例连不上 Vite 就永远停在加载页。

**Solution:** 恢复 = 重跑整套 `npm run electron:dev`，不是再调 editor_restart。诊断指纹：`Get-NetTCPConnection` 查 5173-5180 全空 + `/json/list` 只有 loading.html。附带两点：① 9222 可能是假监听（`/json/version` 探活超时即弃，见 doc 坑 37）；② 真 CDP 端口读 `%APPDATA%\DemoStudio\DevToolsActivePort` 首行或扫 electron PID 的 127.0.0.1 监听端口。

**Applicable:** 编辑器实机验证/CDP 取证前先确认 Vite 活着；多会话并行开发时 editor_restart 是全局破坏性操作（杀别的会话的验证环境）。
