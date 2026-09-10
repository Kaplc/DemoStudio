---
name: fix_ds_memory_end_of_turn_reminder
task_type: debug/build-fix
outcome: success
date: 2026-09-10
---
## Summary

修复 ds-memory 回合末提醒从未生效：第一版 WeakMap+agent.inject 仍不投递（会话日志仲裁零 spliced 事件），最终改为 agent/pre-step + decision.messages（associate.ts 同款被验证通道），新回合第一步注入，6 个单测 + 全量 108 测试全绿。

## Lessons

1) 内核工具 execute 返回值必须 lossless JSON：嵌套 undefined 会被拒（ToolOutputError，内核 tools/src/index.ts:548），可选字段用条件展开，永远不返回带 undefined 值的键；测试断言用 'key' in value === false（toBeUndefined 抓不住）。2) 回合边界注入的正确通道是 agent/pre-step + PreStepDecision.messages（associate.ts 同款，有本会话长期成功先例）；session/event + agent.inject 链路不可靠：Session 无 agent 反向引用、inject（send 'next-step', 不唤醒）实测从未投递、插件 logger 输出不可见导致断点无从定位——两代实现先后在此翻车。3) 排查"功能在但没生效"的地面真相是会话持久日志：~/.dsh/sessions/<工作区>/session-<id>/session.jsonl.zstd 是多帧 zstd（帧间有自定义头，按 28 B5 2F FD magic 扫描逐帧解压即可），内核不变量"模型可见⟺已记日志"使它成为注入是否发生的仲裁证据。4) 两 agent 并行改同一插件时：git status + 文件 mtime 先行，冲突区停手，最后全量 vitest 以 108/108 收敛。

## Effective Path

harness/ds-memory/src/index.ts（pre-step 投递版）、tests/endOfTurnReminder.test.ts；改 dist 后必须重启 agent 加载
