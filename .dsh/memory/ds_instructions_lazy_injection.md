---
name: ds_instructions_lazy_injection
description: ds-instructions 指令惰性注入机制：global.instructions.md 不会在会话开头自动出现，须等 Agent 读取匹配文件后才触发注入
type: project
---
ds-instructions 的指令注入是"被动触发"而非"主动注入"，这是有意设计。

**Why:** 避免噪音——Agent 闲聊或处理非项目任务时不需要注入规范；按需加载——真正读取相关文件时才消耗 token 注入指令；提高上下文效率——减少无关内容对模型注意力的干扰。

**How to apply:** 第一次会话开始时 global.instructions.md 不会出现在上下文开头。触发条件：Agent 调用 read/glob/grep 等工具读取文件后，ds-instructions 监听 `tools/pre-execute` 与 `tools/result` 事件，按路径映射（如 `src/engine/**` → `engine.instructions.md`，`/` → `global.instructions.md`）将指令注入下一次模型请求。调试指令注入问题时，排查路径匹配规则与 Agent 是否真的执行了文件读取操作。
