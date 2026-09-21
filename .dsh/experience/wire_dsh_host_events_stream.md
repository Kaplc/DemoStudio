---
name: wire_dsh_host_events_stream
task_type: feature
outcome: success
date: 2026-09-21
prefix: [src/editor/AgentService.ts, electron/main.ts, src/editor/sessionStatusLights.ts, tests/e2e/agent/session-status-light.spec.ts]
---
## Summary

（二轮更新）把编辑器会话状态灯的运行态权威源从 mux turn 事件推导升级为 DSH host 状态机流（/api/events.host），根治僵尸绿灯；二轮追加模型芯片对齐 WebUI：host/remote-event 白名单事件（llm/adapters-updated、settings/document-updated）+ 会话切换 + host 流重开三路失效，300ms 防抖广播 modelDirectoryChanged 驱动 ModelSelector 自动重拉，单测 10 例 + e2e 回滚验证全过

## Lessons

① 传输事实（读 dsh-client-connection 定案）：/api/events.host 是 WS 单向下行，客户端发任何消息被 1008 "downlink only" 关闭、无需握手信封（服务端 upgrade 时自建 rpcId），帧是裸 JSON hostFrameSchema（{type:'host/session-status',sessionId,running}），鉴权靠 Origin 头——main 进程桥与 mux 桥完全同构；Vite 代理 /api 带 ws:true 已覆盖，浏览器模式零配置。② 新增归约动作 host-idle 而非复用 turn-ended(settled)：权威 idle 只清 running、必须保住 mux turn/end(error) 记的红灯（error 灯语义"保留到下次 turn/start"）。③ host 流重连不要发 stream-reopened：connect() 时 mux+host 双双新建，第二次 clear 会把 mux 刚重种的当前会话灯清掉——host 流重连只做 listSessions 重播种。④ hostIdleConfirmed 只由 host 自己的 running:true 移除，mux turn/start 不碰它（真回合必有 host running:true 伴随；僵尸 turn/start 迟到属跨 socket 微秒级竞态，可忽略）。⑤ e2e 零新增基建：全局 MockWebSocket 收所有 socket，emitFrame 广播信封帧时让 handleHostFrame 兼容 server-request 信封解包（与 handleMuxFrame 同款 f.method||f.type / f.payload??f），mux 与 host 两 socket 各取所需互不干扰。⑥ 回滚验证一行 no-op（handler 首行 early return）→ 仅新用例红、旧 3 例绿，判别器非 vacuous。⑦ host/remote-event 是通用的"host→客户端设置类失效"推送通道：转发 dsh-api-remotes 的 API_REMOTE_FORWARDED_EVENTS 白名单，其中 llm/adapters-updated 与 settings/document-updated 即 WebUI ModelDirectory 的两个失效源——今后任何"配置/目录类缓存失效"需求优先挂这条通道（编辑器已落 notifyModelDirectoryChanged 300ms 防抖 + ModelSelector 订阅重拉，对齐 WebUI 连发合并与失败保留上次好状态语义）。根因与 WebUI 机制见 memory:session_light_zombie_turn。

## Effective Path

electron/main.ts（connectHostWs 桥，紧邻 mux 桥）；src/editor/AgentService.ts（connectHostStream/handleHostFrame/handleHostSessionStatus/hostIdleConfirmed/notifyModelDirectoryChanged）；src/editor/sessionStatusLights.ts（host-idle 动作）；src/components/agent/ModelSelector.tsx（modelDirectoryChanged 订阅重拉）；tests/agentHostStatusStream.test.ts
