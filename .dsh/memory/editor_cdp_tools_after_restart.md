**Problem:** 2026-09-17 editor_restart 后，ds-editor-tools 的 editor_screenshot 持续报 `value.width must be a number`（工具结果 schema 校验失败）；editor_click 在多窗口状态下点击无效果（目标打错）。
**Cause:** 截图工具对返回 PNG 尺寸的 schema 校验有 bug（未深挖插件源码）；CDP attach 在多页面状态下可能选错页——agent 面板独立窗口 agent.html 与主编辑器同源 localhost:5173，会混入候选。
**Solution:** 绕行链路：playwright `chromium.connectOverCDP('http://127.0.0.1:<真实端口>')`（真端口按 electron PID 扫监听，DevToolsActivePort 文件可能过期），主编辑器页用 `/^http:\/\/localhost:5173\/?$/` 精确匹配排除 agent.html；游戏内操作走 `page.evaluate` 里 `window.__ai.emit('ai.clickActor'|'ai.gmCommand', ...)`，截图 `page.screenshot` 落盘后 read_image 查看。
**Applicable:** editor_* 工具失效/存疑时的编辑器实机取证与操作（截图、点按钮、GM 命令）。
