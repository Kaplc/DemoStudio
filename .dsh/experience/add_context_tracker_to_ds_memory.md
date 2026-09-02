---
name: add_context_tracker_to_ds_memory
task_type: feature
outcome: success
date: 2026-09-02
---
## Summary

在 ds-memory 插件中新增上下文占用跟踪功能：监听 session/event 提取 token usage，在 agent/pre-step 时检测是否超过阈值并注入提醒消息

## Lessons

- DSH 插件中获取上下文长度最可靠的方式是直接监听 session/event 事件，而非依赖 sessionProjections 服务（后者在 harness 运行时可能不可用）
- token usage 从 assistant/message 和 assistant/chunk（type=usage）事件中提取，contextWindow 从 request/context 事件中提取
- agent/pre-step 事件的 handler 签名中 messages 是 readonly 的，需要展开为新数组再修改
- createUserMessage 的 source 必须使用 MessageSourceMap 中已有的 kind（如 plugin），自定义 kind 需要 module augmentation
- z.schemastery 的 z.number() 不支持 .int() 链式调用，需用 z.number().min().max()

## Effective Path

harness/ds-memory/src/contextTracker.ts, harness/ds-memory/src/index.ts
