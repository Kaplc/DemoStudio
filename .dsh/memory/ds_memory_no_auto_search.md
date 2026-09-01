---
name: ds_memory_no_auto_search
description: 记忆插件移除自动检索注入，改为 agent 自觉调用 memory_search
type: project
---
记忆插件已移除自动检索注入（agent/pre-step side-query），改为只注入 MEMORY.md 索引让 agent 自己调用 memory_search。

**Why:** 用户认为每次用户消息都跑一次 side-query（小模型选记忆）太重，agent 看到索引后自己判断是否需要检索更合理。

**How to apply:** ds-memory 插件不再监听 `agent/pre-step`，不再有自动检索注入流程。system prompt 注入 MEMORY.md 索引（目录），agent 看到后主动调用 `memory_search` 工具按需检索。`selectMemories.ts` 中的 `renderSelectedMemories` 和 `alreadySurfaced` 已移除，`findRelevantMemories` 仅供 `memory_search` 工具内部使用。
