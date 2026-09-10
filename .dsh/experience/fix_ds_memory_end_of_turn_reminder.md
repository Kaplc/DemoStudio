---
name: fix_ds_memory_end_of_turn_reminder
task_type: debug/build-fix
outcome: success
date: 2026-09-10
prefix: harness/ds-memory
---
## Summary

修复 ds-memory 回合末提醒从未生效：第一版 WeakMap+agent.inject 仍不投递，改为 agent/pre-step + decision.messages 后生效；2026-09-11 用户要求改为回合末注入，改为 agent/turn-stopping + agent.steer()。

## Lessons

1. agent.inject 投递语义（send(input,'next-step',false)）在 web profile 实测不可依赖，会话日志证实零注入事件；2. agent/pre-step + decision.messages 是被长期验证能进入模型请求的路径（associate.ts 同款）；3. agent/turn-stopping + agent.steer() 可在回合末注入，但会让回合多跑一步；4. junction 插件代码随进程启动载入，改 dist 必须重启 agent 才生效。

## Effective Path

harness/ds-memory/src/index.ts
