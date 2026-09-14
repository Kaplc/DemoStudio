---
name: dsh_mux_projection_frames
description: DSH mux 帧权威语义：events.mux 全会话广播（session/event 无订阅过滤）+ 开流重放 pending 问答/审批，权威 schema 锚点 events.schema.js；跨会话动态气泡即基于此
type: project
prefix: [src/editor/AgentService.ts, electron/main.ts]
---

**Problem:** 编辑器 agent 面板 2026-09-10 前只处理 mux 的 6 种帧（question/approval 4 种 + session/event + session/subscribed），`session/projection` 被静默丢弃——头部会话标题、侧边栏统计不实时，要重开面板（重挂载触发全量刷新）才更新。

**Cause:** DSH host 在投影变化（title 生成/更新、sessionStats 回合统计）时主动经 mux 推 `{ type: 'session/projection', sessionId, key, value, seq }` 帧（扁平字段），这是 DSH WebUI 会话标题实时刷新的同一机制；WebUI 参考实现在 `dsh-client-runtime/lib/client.js` 的 `handleMuxEnvelope` → `projectionStore.apply`（`seq <= 水位` 丢弃，last-wins）与 `truncate`（session/subscribed 基线回退时截断本地高水位）。mux 连接是多路复用的，**其他会话的帧也会推过来**，分支必须按 sessionId 过滤。

**Solution:** 编辑器侧已在 `AgentService.handleMuxFrame` 增加 projection 分支：`mergeProjectionFrame` 纯函数（src/editor/AgentService.ts 导出，单测覆盖）合并进 `sessionsCache` 并广播 `sessionsUpdated` 事件；会话不在缓存（blank→listed）或未跟踪键走 300ms 防抖 `listSessions()` 全量。**以后给编辑器加任何"实时感知会话元数据"的能力，先对照权威帧 schema：`dsh-host-apiproxy/lib/types/api/events.schema.js` 的 muxFrameSchema（session/event|subscribed、approval/requested|resolved、question/requested|resolved、session/queue、session/jobs、session/projection、stream/error）与 hostFrameSchema（host/session-added|removed、host/session-status(running)、host/agent-error 在独立 /api/events.host 流上，编辑器未接）。**

## mux 是全会话广播（2026-09-13 核实，跨会话动态气泡的地基）

**规则：** `events.mux` 的 `session/event` 由 host `ctx.on('session/event')` 对**所有会话**广播，无订阅过滤；开流基线 = 全会话 `session/subscribed` + 重放仍 pending 的 question/approval 请求（稳定 rpcId）+ queue/jobs 快照。编辑器现有 mux 连接天然能感知其他会话的 turn 边界与待定请求，不需要新连接/RPC。

**Why:** 跨会话动态气泡（doc/editor/integration/agent_panel_system.md §14）完全建立在这条事实上——`consumeForeignSessionEvent` 提炼其他会话 turn/start|end，question/approval 跨会话帧进通知、切换时 adopt 成可操作卡片。

**How to apply:** 任何"感知其他会话"的需求先在 mux 帧分派按 sessionId 分流（当前会话完整管线 / 其他会话提炼），别丢弃外部帧；要"任意会话 running 态"从 turn 边界推导即可，不必接 host 流。

**Applicable:** src/editor/AgentService.ts（handleMuxFrame 帧分派、listSessions 缓存）；electron/main.ts mux WS 转发（全量广播不过滤，渲染进程自己过滤）；一切需要会话元数据实时性的面板功能。

