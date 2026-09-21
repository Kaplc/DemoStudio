---
name: dsh_session_list_overload_storm
description: session.list 独立卡死的诊断路径与编辑器侧自我放大器（已落 single-flight+退避止血）
type: project
prefix: [electron/main.ts, src/editor/AgentService.ts]
---

# session.list 过载风暴：诊断路径与编辑器侧放大器（2026-09-20 实测）

**Problem:** 2026-09-20 23:08 起 agent 面板 `session.list` 持续 30s 超时（console log 累计 664 次失败、零成功），侧边栏靠缓存苟活；同期 mux 帧（session/projection、session/event）照常推送、其他 agent 会话正常跑——**host 明显活着，只有 session.list 这条 RPC 卡死**。

**Cause:** 双重叠加。① DSH host 单进程处理 session.list 要全量 summarize 全部会话（当时 348 个会话目录/91.7MB），host 忙时该请求排队 30s+；② 编辑器侧放大器：投影帧驱动的 `scheduleProjectionRefresh` 每 300ms 防抖一发全量 listSessions，无 single-flight 无退避，host 越慢重发越密，超时请求在 host 端积压成风暴。超时阈值锚点：`electron/main.ts` dsh-rpc 的 `AbortSignal.timeout(30000)`。

**Solution:** 诊断三步：① 数 console log 的 "session.list 失败" 计数与时间分布（持续 vs 瞬时）；② 看 mux 帧是否还在推（区分 host 死活——host 活只是 list 卡）；③ 外部 fetch 探 :3080 不可信（见 memory:dsh_http_rpc_probe_blocked），别用它下结论。止血已落 `AgentService.listSessions`：single-flight（并发复用在途 Promise）+ 失败指数退避（2^n 秒封顶 60s，成功清零），投影帧已实时合并进缓存所以退避期回缓存无损。根治切换卡顿靠虚拟会话快速路径绕开 RPC（doc/editor/integration/agent_panel_system.md §19）。

**Applicable:** electron/main.ts（dsh-rpc 超时阈值）、src/editor/AgentService.ts（listSessions 及其调用方）；一切"某条 RPC 独立超时但面板其他功能正常"的症状先套这个分流。
