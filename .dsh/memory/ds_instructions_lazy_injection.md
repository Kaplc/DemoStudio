---
name: ds_instructions_lazy_injection
description: ds-instructions 注入时机：global（prefix:/）已在 step1 自动注入，其余前缀仍是读到匹配文件才惰性注入（2026-09-09 更新）
type: project
prefix: harness/ds-instructions
---
规则：ds-instructions 注入分两种时机——`prefix: /` 的全局指令在 agent **step 1 自动注入**（harness/ds-instructions/src/index.ts:325，每 agent 一次）；其余前缀指令仍是**惰性注入**：Agent 读到匹配路径的文件后才注入下一次模型请求。

**Why:** 全局兜底规范必须每会话在场；目录级指令按需加载，避免闲聊/无关任务时浪费上下文。

**How to apply:** 排查"指令没出现"先分清哪种：global 不出现 = step1 注入分支失效（查 index.ts:325）；目录指令不出现 = (a) 被读路径不在其 prefix 下（段级匹配，src/engine 不命中 src/engine2）或 (b) Agent 没真正读文件。改时机行为在 harness/ds-instructions/src/index.ts。
