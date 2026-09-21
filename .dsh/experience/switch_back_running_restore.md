---
name: switch_back_running_restore
task_type: debug
outcome: success
date: 2026-09-21
prefix: [src/editor/AgentService.ts, src/editor/sessionStatusLights.ts, tests/agentSwitchRunningRestore.test.ts, tests/e2e/agent/running-restore.spec.ts, doc/editor/integration/agent_panel_system.md]
---
## Summary

修复"运行中切走会话再切回输入框误判未运行"：ghost 缓冲只覆盖切走后事件导致 scanUnclosedTurn 扫不到回合边界，恢复判定并入状态灯跨会话运行态记忆兜底，单测 4 例 + e2e 1 例 + 回滚验证全过

## Lessons

① 判定链路取证顺序：先找 UI 信号源（停止按钮 ← running prop ← runningChange ← setRunning），再数 setRunning(true) 的全部调用点，锁定切换路径的恢复判定。② 根因模式：「窗口内扫描边界」类判定（scanUnclosedTurn）遇到后缀缓冲（ghost 只存切走后的事件）天然盲区——turn/start 在窗口外，扫描结果 false 不代表回合闭合。③ 跨会话运行态记忆现成可用：sessionStatuses 状态灯表（turn/start 亮/turn/end 灭、全会话统一翻译）就是权威镜像，兜底 OR 进恢复判定即可，别新建平行状态。④ 测试坑：AgentService.send() 守卫要求 connected+sessionId（setState('connected') 直设）；isMuxAlive 必须桩 true 否则 resume/send 的离线分支拉起轮询循环挂死测试；空历史页 unclosedTurn 是 undefined 不是 false（loadHistory 空事件提前返回）。⑤ e2e 断言运行态用 .composer__stop（仅 running 渲染）的 visible/hidden 翻转，比读类名稳。

## Effective Path

src/editor/AgentService.ts（resumePendingTurnFromPage 记忆兜底）+ tests/agentSwitchRunningRestore.test.ts + tests/e2e/agent/running-restore.spec.ts + doc/editor/integration/agent_panel_system.md §19.2
