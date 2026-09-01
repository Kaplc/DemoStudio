---
name: ds_experience_search_no_llm
description: experience_search 改为纯文件读取，harness 下无 LLM 调用
type: project
---
经验插件 experience_search 已改为纯文件读取，不再调用 LLM。整个 harness 下所有插件已无 LLM 调用。

**Why:** 用户认为 experience_search 内部的 AI 选择器 side-query 也是多余的，agent 看到 INDEX.md 索引后自己知道要读哪个文件。

**How to apply:** `experience_search` 工具现在接收 `names: string[]`（文件名列表），直接读取对应经验文件返回。空数组时返回全部经验摘要。`ExperienceToolHost` 不再需要 `selectProvider`/`selectModel`。`inject` 数组移除了 `'llm'`。
