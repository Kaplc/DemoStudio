---
name: dsh_mux_projection_frames
description: DSH 交互/事件流的权威协议：0.1.7 起 /api/remote.mux 单 WS（$events 网关通知 + session/follow 会话流），审批/提问走 $events 瀑布 + $events/result 决议；旧 events.mux 帧词汇已整体失效
type: project
prefix: [src/editor/AgentService.ts, electron/main.ts]
---

## 0.1.7 协议定案（2026-10-01 实测定案，取代全部旧帧词汇）

**Problem:** 旧记忆描述的 `events.mux` 帧词汇（session/subscribed、approval/requested|resolved、question/requested|resolved、session/projection 等）在内核 0.1.7-rc.2 全部不存在了——`dsh-host-apiproxy` 包也没了。按旧词汇做的审批/提问监听静默死亡（编辑器面板审批卡片 2026-10-01 缺失的根因）。

**Cause:** 0.1.7 把 events.mux/events.host 两条旧 WS 合并为一条 **`/api/remote.mux`**（typert Remote 流复用，需鉴权 cookie）：客户端发 `{type:'open', streamId, endpoint, payload}` 开逻辑流，服务端回 `{type:'item'|'end'|'error', streamId}`。两条关键逻辑流：
- **`$events`**（网关通知）：首帧 `{type:'ready', clientId, host:{home}}`；之后 `{type:'emit', event, args}`（api-session/added|removed|status|error|activity 等主机级事件）与 `{type:'waterfall', event:'approval/request'|'user-questions/request', eventId, agentId, request}`（**待应答交互事件**，request 为投影后 JSON 载荷）与 `{type:'cancel', eventId}`（已被决议/撤销）。
- **`session/follow`**：单会话流，`{args:{request:{address:{kind:'session', sessionId}, assistantStream:true}}}`；首 item `{type:'snapshot', cursor}` → `{type:'event'}` 逐持久事件 → `{type:'assistant-stream', frame}` 瞬态吐字。

**Solution（应答协议，与 WebUI 逐字节一致）:** 决议走 unary **`POST /api/$events/result`**，client-request 信封，payload 恰好一个 args：`{args:{clientId, eventId, outcome}}`，outcome ∈ `{kind:'result', value?}`（审批 value 即 'allowed-once'|'rejected' 字符串；提问 value 为 `{answers:[{id,selected,custom?}]}`）/ `{kind:'rejected', error:{name,message,code?,details?}}` / `{kind:'next'}`。语义：每客户端各得一份投递，**第一个 result 决议生效**，网关给其余投递方广播 cancel（应答方自己不收 cancel——决议前已摘除投递，所以应答方要自己 emit resolved 移卡）；开流/重连时网关把全部 pending 瀑布**用新 eventId 重放**给新客户端。权威源码锚点：`dsh-api-gateway/lib/index.js`（openRemoteEvents/startRemoteEvent/receiveRemoteEventResult/finishRemoteEvent）+ `dsh-api-gateway/lib/client.js`（ClientRemoteEvents.pumpEvents/answer）+ `dsh-client-ui-approval`（ApprovalFlow）。

**编辑器落地（2026-10-01）：** electron/main.ts mux 桥把 waterfall 翻译为渲染层既有 server-request 帧（rpcId=eventId，payload 附 eventId/clientId）、cancel 翻译为 resolved 帧、断开清本代未决议卡；AgentService 以 `dshRpc('$events/result', {args})` 应答（browser 模式直接 fetch）。详录 doc/editor/integration/agent_panel_system.md §6；回归 tests/dshRemoteEventWaterfall.test.ts + tests/e2e/agent/approval-card.spec.ts。

**Applicable:** 一切"编辑器要感知/应答 DSH 交互"的需求先对照本协议与 dsh-api-gateway 源码；旧 events.mux 帧词汇的引用一律视为 0.1.6 前历史。

## 历史背景（0.1.6 前，仅存档）

旧 events.mux 时代：session/event 全会话广播无订阅过滤、开流重放 pending 问答/审批（稳定 rpcId）、session/projection 投影帧驱动标题实时（mergeProjectionFrame 纯函数仍在 AgentService 供 listSessions 缓存合并）。0.1.7 起投影实时性改由 session.list 行内 projections 快照承载（编辑器桥未接 control 流，投影帧不再实时推送——若需要恢复实时性，找 dsh-api-session-controller 的 SessionControlController `control` 流）。
