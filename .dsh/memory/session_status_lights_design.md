---
name: session_status_lights_design
description: 会话状态灯设计定案：session.list 行内权威 running 字段做种子（只种开不清）+ turn 边界帧实时翻转 + 流重建清 running；含子代理入列时序坑与 e2e stub 状态翻转要求
type: project
prefix: [src/editor/sessionStatusLights.ts, src/editor/AgentService.ts]
---

## 会话状态灯数据源与生命周期定案（2026-09-16）

**规则：** 会话列表状态灯（绿=回合运行中/红=上次回合失败）的数据源两层：① 实时翻转——mux `session/event` 全会话广播的 turn/start|end 帧，在 `handleMuxFrame` 的 session/event 分支里 current/foreign 分流**之前**统一翻译（一条钩子覆盖全部会话）；② 权威种子——`session.list` 每行自带 schema 保证的 `running` 布尔（`dsh-host-apiproxy/lib/types/api/sessions.schema.js:34`，DSH 查询时权威计算，无需接 host 流），`listSessions` 对 running:true 行应用 turn-started 动作。生命周期：**只种开不清**（RPC 快照可能略旧，种灭会把刚亮的灯闪灭），清灯只由 turn/end 帧负责；`connectMux()` 重建流时清全部 running 防僵尸（error 灯保留，当前会话按 `_isRunning` 重种）；error 灯保留到该会话下次 turn/start。

**Why:** 面板重载/首挂载时没有 turn/start 帧（旧回合已在进行），只有种子能让"谁在跑"立即可见；设计语义与 §14 通知刻意不同——通知是事件提醒（切会话清除），状态灯是持久状态标记（error 不随查看清除）。

**How to apply:** 改 `sessionStatusLights.ts` / `AgentService` 状态灯接线前先读 doc/editor/integration/agent_panel_system.md §16。子代理会话入列时序坑：子代理（origin=subagent）无 title 投影，首回合结束前可能被 blank 过滤挡在列表外，其 sessionStats 投影帧（回合结束才发）才触发防抖全量刷新让它入列——"子代理运行中亮灯"依赖列表已有其条目。e2e stub 陷阱：stub 的 session.list 若恒返回 running:true，面板收 turnEnd 后的回合结束刷新会把灯重新点亮（种子盖过实时帧），stub 必须建模状态翻转（`__statusE2E.listRunning` 可变标志）。
