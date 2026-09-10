---
name: dsh_mux_projection_frames
description: DSH mux 下行帧不止 session/event：session/projection 承载 title/sessionStats 实时推送，编辑器曾因丢弃该帧导致面板标题不实时（prefix: src/editor || electron）
type: project
prefix: src/editor || electron
---

**Problem:** 编辑器 agent 面板 2026-09-10 前只处理 mux 的 6 种帧（question/approval 4 种 + session/event + session/subscribed），`session/projection` 被静默丢弃——头部会话标题、侧边栏统计不实时，要重开面板（重挂载触发全量刷新）才更新。

**Cause:** DSH host 在投影变化（title 生成/更新、sessionStats 回合统计）时主动经 mux 推 `{ type: 'session/projection', sessionId, key, value, seq }` 帧（扁平字段），这是 DSH WebUI 会话标题实时刷新的同一机制；WebUI 参考实现在 `dsh-client-runtime/lib/client.js` 的 `handleMuxEnvelope` → `projectionStore.apply`（`seq <= 水位` 丢弃，last-wins）与 `truncate`（session/subscribed 基线回退时截断本地高水位）。mux 连接是多路复用的，**其他会话的帧也会推过来**，分支必须按 sessionId 过滤。

**Solution:** 编辑器侧已在 `AgentService.handleMuxFrame` 增加 projection 分支：`mergeProjectionFrame` 纯函数（src/editor/AgentService.ts 导出，单测覆盖）合并进 `sessionsCache` 并广播 `sessionsUpdated` 事件；会话不在缓存（blank→listed）或未跟踪键走 300ms 防抖 `listSessions()` 全量。**以后给编辑器加任何"实时感知会话元数据"的能力（标题/统计/用量/任务），先对照 WebUI `handleMuxEnvelope` 的完整帧清单（session/event|projection|jobs|queue|subscribed），别默认只有 session/event。**

**Applicable:** src/editor/AgentService.ts（handleMuxFrame 帧分派、listSessions 缓存）；electron/main.ts mux WS 转发（全量广播不过滤，渲染进程自己过滤）；一切需要会话元数据实时性的面板功能。

