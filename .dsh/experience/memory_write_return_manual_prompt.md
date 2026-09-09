---
name: memory_write_return_manual_prompt
task_type: feature
outcome: success
date: 2026-09-10
---
## Summary

把 ds-memory 的 memory_write 从"工具落盘"改为"校验+查重后返回写入指引提示词"，由 agent 手动 write/edit 落盘并同步索引、完成后全库检查过时记忆。

## Lessons

1) defineTool 的 output.schema 会反向约束 execute 返回类型：字面量字段（action: 'manual_write'）不写 as const 会被拓宽成 string 导致 TS2719——返回对象里字面量一律 as const。2) 测试断言失败暴露设计缺口：指引提示词没带本次声明的 prefix，agent 落盘时无从得知要写什么进 frontmatter——提示词类返回值要把"调用方意图参数"原样带回。3) "工具返回提示词让 agent 手动做"模式的分工：工具保留确定性部分（路径计算/查重/格式校验），提示词写清步骤与验收标准，系统提示文本（SAVE_FLOW_TEXT）与工具 description 同步改口径。

## Effective Path

harness/ds-memory/src/tools.ts（createMemoryWriteTool）、harness/ds-memory/src/memoryTypes.ts（buildManualWritePrompt）、tests/memoryWriteTool.test.ts
