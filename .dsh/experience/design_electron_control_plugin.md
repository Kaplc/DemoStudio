---
name: design_electron_control_plugin
task_type: feature/design
outcome: success
date: 2026-08-31
---
## Summary

设计一个可操作 Electron 的插件：先读 ds-engine-tools 插件、electron main/preload、AI 事件注册和 Zustand store，理清 DSH Agent → MCP → IPC → renderer AIModule.emit 链路，再规划两层事件架构（editor.* 操作编辑器 UI store + 主进程 IPC 操作窗口/对话框）并输出完整方案。

## Lessons

有效路径是复用已有 emit_ai_event 转发能力，不必新造通信通道：渲染进程侧加 editor.* 事件操作 Zustand store，主进程侧新增 ai.windowAction / ai.showDialog IPC handler。踩的坑：编辑器 UI 状态分散在 editorStore（运行时态）和 editorPrefsStore（持久化布局）两个 store，设计事件时要区分清楚。下次设计同类插件先画清命令链路、确认哪些能力已具备（如任意 ai.* 事件名已支持），避免重复发明轮子。

## Effective Path

harness/ds-engine-tools/src/index.ts（参考插件范式）+ electron/main.ts（IPC 入口）+ src/engine/ai/AIEvents.ts（事件注册）
