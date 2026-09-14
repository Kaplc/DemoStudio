---
name: dsh_http_rpc_probe_blocked
description: DSH :3080 HTTP RPC 对外探活不通（127.0.0.1 直连超时/localhost 带 Origin 403 来源门禁）——依赖 isDshAlive 探针的 4 个 agent e2e 在本环境恒 skip，不是回归
type: project
prefix: [tests/e2e/agent/header-session-title.spec.ts]
---

**Problem:** 2026-09-13 起 4 个 agent e2e（header-session-title / image-paste / session-recovery / usage-stats）全部 skip，skip 原因都是 `isDshAlive` 探针失败；但 DSH 明明在跑（编辑器 agent 正常对话）。手工 `fetch('http://127.0.0.1:3080/api/session.list')`（正确的 client-request 信封）也 TimeoutError。

**Cause:** DSH host 对 HTTP RPC 有来源门禁：`127.0.0.1:3080` 直连挂起（超时），`localhost:3080` 带 `Origin: http://localhost:5173` 立即 403。Vite dev server 的 /api 代理同样不通（5173 代理超时、5174 ECONNREFUSED）。探针走的就是这条路 → 恒失败。这是 host 的安全策略（编辑器本体走 Electron IPC 的 `api.dshRpc`，不经 HTTP），不是 DSH 挂了。

**Solution:** 判定"agent 相关 e2e skip 是否异常"先手工探一次 3080（直连超时 + 带 Origin 403 = 门禁，属预期）；要跑这 4 个 spec 需在浏览器页面内发请求（浏览器 Origin 在白名单）或放开 host 门禁，别改成 Node 直探。无副作用 spec（tool-card-diff / session-notice-bubble 等 stub fetch + mock WebSocket）不受影响，任何环境都能跑。

**Applicable:** tests/e2e/agent/*（isDshAlive 前置跳过的 spec）；任何从 Node/脚本直探 DSH :3080 HTTP RPC 的验证尝试——先想来源门禁，别误诊为 DSH 未启动。
