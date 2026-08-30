---
name: fix_emit_ai_event_payload_bridge
task_type: debug/build-fix
outcome: success
date: 2026-08-31
---
## Summary

挂载 ds-editor-tools 后做全覆盖测试，发现 emit_ai_event 通过 DSH bridge 传递嵌套 payload 时子对象丢失；通过绕过 engineBridge 直接 HTTP 调 MCP API 修复，并在主进程 MCP handler 中直接处理 dsh-restart 实现远程重启加载新代码

## Lessons

测试插件时不要把异常只看成新插件的 bug，要追到 bridge 抽象层——engineBridge.callTool 会吞掉嵌套 payload，最稳的路径是直接用 fetch 打编辑器 MCP HTTP 端口（9877），端口发现顺序 env DSH_ENGINE_PORT → engineBridge.port → 默认值。DSH agent 是独立孤儿进程，远程重启必须由主进程 kill 旧进程、等端口释放、再 spawn 新进程；转发到渲染进程是错误路径，且改 electron/main.ts 后必须重启编辑器才生效。

## Effective Path

harness/ds-engine-tools/src/tools/emitAIEvent.ts + electron/main.ts MCP handler 直接处理 dsh-restart
