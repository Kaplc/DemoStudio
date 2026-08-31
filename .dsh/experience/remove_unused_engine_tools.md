---
name: remove_unused_engine_tools
task_type: refactor/code-removal
outcome: success
date: 2026-08-31
---
## Summary

用户要求 ds-engine-tools 只保留 emit_ai_event 工具，助手删除 7 个工具源文件、精简入口注册和 ALL_TOOLS、检查 guards.ts/engineContext.ts 依赖后保留，最后 tsc 通过。

## Lessons

删除大量工具时先确认清单并逐个移除源文件；清理入口后必须用 grep 检查剩余工具是否仍依赖公共模块（guards/engineContext），不要盲目删除；最后用 tsc --noEmit 验证编译。下次做类似清理可以沿用：明确范围 → 删文件 → 清理注册 → 查依赖 → typecheck。

## Effective Path

harness/ds-engine-tools/src/tools/emitAIEvent.ts 的 import 检查，决定了 guards.ts 和 engineContext.ts 是否保留
