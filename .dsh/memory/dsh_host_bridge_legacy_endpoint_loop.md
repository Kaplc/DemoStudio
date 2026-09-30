---
name: dsh_host_bridge_legacy_endpoint_loop
description: host 桥连已不存在的 /api/events.host → 内核 destroy → "socket hang up" 5s 重连死循环的根因与修复方向
type: project
prefix: [electron/dsh/adapters/dsh017.ts, electron/dsh/streamBridge.ts]
---

**Problem:** 编辑器主进程 cmd 窗口持续刷 `[DSH-host] WS 错误: socket hang up` → `WS 已断开，5s 后重连` 死循环；`[DSH-mux]` 桥正常。

**Cause:** dsh017 适配器 `hostEndpoint: '/api/events.host'` 是 0.1.1 legacy 协议端点；0.1.7-rc.2 内核全库唯一注册的 WS upgrade 路径是 `/api/remote.mux`（dsh-api-gateway），events.host 不存在。内核 dsh-host-webserver 对未注册路径的 upgrade 直接 `socket.destroy()`——无 HTTP 错误响应、无 WS close 帧，Node ws 客户端表现为 ECONNRESET = "socket hang up"，5s 重连永不成功。0.1.7 下主机级事件（host/session-status 等）实际由 mux 桥 $events 流的 emit 翻译（translateEventsItem → broadcastHostFrame），host 桥是冗余残留。

**Solution:** 已修复（2026-09-30）：dsh017 适配器 `hostStream: false` + `hostEndpoint: ''`，`connectHostWs` 开头按 capability/hostEndpoint 守卫短路（不连不重连）。勿删 mux 桥的 host/* 翻译广播（渲染层状态灯靠它）。验证：tsc 归零 + 定向 vitest 27 例绿 + 重启后 60s 采样主进程对 3080 恒单连接。**已知遗留**：浏览器调试模式（无 electronAPI）页面仍直连 legacy `/api/events.mux`（AgentService.ts connectMux）与 `/api/events.host`（connectHostStream）——0.1.7 下同为死循环（3s 重连，vite ws 代理转发），只刷页面 console 不损功能；e2e MockWebSocket 基建依赖这两个分支发 WS，修复需连动 e2e 框架，留待"页面级 remote.mux 客户端"任务。

**Applicable:** electron/dsh/streamBridge.ts（connectHostWs）、electron/dsh/adapters/dsh017.ts、内核 dsh-host-webserver upgrade 分发（未注册路径 destroy）。
