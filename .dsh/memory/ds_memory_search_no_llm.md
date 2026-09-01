---
name: ds_memory_search_no_llm
description: memory_search 改为纯文件读取，移除 LLM 调用
type: project
---
记忆插件 memory_search 工具已改为纯文件读取，不再调用 LLM。

**Why:** 用户认为 memory_search 内部的 AI 选择器 side-query 也是多余的 LLM 调用，agent 看到 MEMORY.md 索引后自己知道要读哪个文件。

**How to apply:** `memory_search` 工具现在接收 `names: string[]`（文件名列表），直接读取对应记忆文件返回正文+元数据。空数组时返回全部记忆摘要（不含正文）。不再依赖 `selectMemories.ts`（已删除）。`MemoryToolHost` 不再需要 `selectProvider`/`selectModel`。
