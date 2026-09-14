---
name: editor_cdp_live_port_discovery
description: 编辑器 DevToolsActivePort 文件会过期，CDP 真端口按 electron 进程 PID 扫监听端口找；agent 独立窗口是独立 page target 可抓 DOM/截图
type: project
prefix: [harness/ds-editor-tools/src/tools/editorScreenshot.ts]
---

**Problem:** 抓编辑器/agent 窗口做实机取证时，DevToolsActivePort 文件里的端口（55282/50080）全部 ECONNREFUSED，9222 也超时；`editor_screenshot` 工具本次还报 `value.width must be a number`（schema 错但截图实际落盘成功）。

**Cause:** DevToolsActivePort 是上次启动的残留（多套 userData 目录各一份，都可能是旧的）；编辑器重启后 CDP 端口变化，文件没跟上。CDP 客户端（playwright connectOverCDP / 手工 fetch /json/list）按文件找端口必然失败。

**Solution:** 真端口按进程找：`Get-NetTCPConnection -State Listen` 过滤 `LocalAddress=127.0.0.1` 且属主进程名匹配 electron/DemoStudio，得到唯一监听端口（2026-09-13 实测 55225）再探 `/json/list`。页面目标里 agent 独立窗口是独立 page（title "DSH Agent"，url 含 agent.html），playwright `connectOverCDP` → `contexts()[0].pages().find(p => p.url().includes('agent.html'))` 可直接 evaluate 查 DOM / screenshot——比 editor_screenshot（抓主窗口）更适合验证 agent 面板 UI。

**Applicable:** harness/ds-editor-tools（editorScreenshot 等 CDP 工具的端口发现）；任何要实机抓编辑器 DOM/截图的验证——先扫进程监听端口，别信 DevToolsActivePort 文件。

## agent 窗口可能跑旧代码（HMR 断连陈旧页，2026-09-14）

**Problem:** 改了 CSS/组件后，编辑器实机窗口行为不变（computed style 还是旧值），但 dev server fetch 出来的模块是新代码。

**Cause:** 窗口页面的 vite HMR 连接断过（dev server 重启/切换端口/休眠），之后文件变更不再推送，页面一直跑加载时的旧模块——`/?agentWindow=1`/`agent.html` 独立窗口尤其容易在后台悄悄断掉。

**Solution:** 实机验证"改了没生效"先 reload 该 page（CDP `page.reload()`，agent 面板走 localStorage 会话恢复链路可安全刷新）再取证；判定方法 = 对比 dev server HTTP 返回的模块内容与页面 computedStyle/行为。

