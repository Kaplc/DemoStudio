---
name: ps_probe_localhost_false_timeout
description: 环境坑：PowerShell Invoke-WebRequest 探 localhost:5173 假超时，Node fetch 同 URL 正常，别用 PS 结果误判 Vite 代理故障
type: project
prefix: [e2e/framework/session.ts, e2e/framework/fixtures.ts]
---

**Problem:** 用 PowerShell `Invoke-WebRequest` POST 探测 `http://localhost:5173/api/*`（Vite 代理到 DSH :3080）稳定超时失败，误判为"代理坏了/服务挂了"；同一 URL 用 Node `fetch` 立即返回 200。

**Cause:** PowerShell 的 WebRequest 在本机对 localhost 走 IPv4 回环且受代理/超时语义影响（2026-09-10 实测：PS 超时、Node 200 并存）；Node fetch 对 localhost 走 happy-eyeballs 命中 ::1 监听的 Vite。

**Solution:** 探测 dev server / 代理链路一律用 Node 侧 fetch（`node -e "fetch(...)"` 或 e2e spec 内探针），不要拿 PowerShell 探测结果下"服务不可达"结论；e2e 探针带 5s 超时 + 2 次重试（Vite 代理首访预热可超 3s）。

**Applicable:** tests/e2e 各 spec 的 isDshAlive 类探针、任何"先探服务再跑用例"的前置检查；诊断 Vite /api 代理是否转发时同理。

