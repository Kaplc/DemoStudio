---
name: add_session_status_lights
task_type: feature
outcome: success
date: 2026-09-16
prefix: [src/editor/sessionStatusLights.ts, src/components/agent/SessionSidebar.tsx, tests/e2e/agent/session-status-light.spec.ts, scripts/verify-session-status-light.mjs]
---
## Summary

给 agent 面板会话列表加状态灯（绿=运行中带呼吸脉冲、红=上次回合失败）：mux session/event 回合边界推导 + session.list 行内权威 running 字段种子，纯归约层 + AgentService 接线 + SessionSidebar 渲染，vitest/e2e/CDP 真机三层验证全过。

## Lessons

有效路径：① 需求=感知其他会话 → 先翻 memory:dsh_mux_projection_frames 的帧清单决策（turn 边界推导、不接 host 流），权威帧形状读 events.schema.js 的两个 discriminatedUnion 一次看清；本次又从 sessions.schema.js:34 挖到 session.list 行内 running 权威布尔，种子+实时帧两层关闭了"重载后不知道谁在跑"缺口。② 真机取证的可靠套路是"自己就是信号源"：本回合运行中重载 agent 窗口，恢复路径拉 session.list 行内 running:true 直接种灯（子代理方案是 racy 的——turn/start 可能早于页面重连、且子代理会话被 blank 过滤挡在列表外）。③ 探 DSH HTTP RPC 必须带完整 {type:'client-request',rpcId,method,payload} 信封，裸 {method} 报 invalid-request；PowerShell 探 127.0.0.1 假超时（memory:ps_probe_localhost_false_timeout），用 node fetch。④ e2e stub 必须建模状态流转：恒 running:true 的 stub 会让"回合结束刷新列表"把灯重新点亮，看起来像清灯失效——实际是 stub 说谎；让 session.list 的 running 可切换（listRunning 标志）后断言才有意义。⑤ AgentPanel.tsx 编辑三次撞 file-changed-since-read（mtime 稳定=无并发写，fresh read 后立即重试即过）；编辑大文件前先读目标区域再动手，连续编辑被外部触碰的文件要逐段 read-edit。⑥ 全量 vitest 有 11 个 warm 游戏数值测试预置失败——判定是否与本次改动相关看 import 交集（零交集 + tsc 全绿 + 相关文件全过即可判定预置失败，写进报告不阻塞）。设计事实沉淀见 memory:session_status_lights_design（种子只种开不清 / 流重建清 running / e2e stub 翻转要求）。

## Effective Path

src/editor/sessionStatusLights.ts + AgentService（mux session/event 分支钩子 + listSessions 种子）；tests/e2e/agent/session-status-light.spec.ts；scripts/verify-session-status-light.mjs
