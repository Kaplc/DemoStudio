---
name: harness_no_llm_design
description: 用户设计决策：harness 插件不做隐性后台 LLM 调用——检索纯文件读取 + agent 自觉调用
type: project
prefix: harness
---
规则：harness 插件不做隐性的后台 LLM 调用（side-query/自动提炼）；检索类工具一律纯文件读取，提炼/保存靠 system prompt 指导 + agent 当回合自觉调用工具。

**Why:** 用户连续三次否决（均 2026-09-09 前）：memory_search 内置 AI 选择器、experience_search 内置 AI 选择器、经验自动提炼（空闲判定+确认弹窗），理由是"agent 看索引自己知道，多余 LLM 调用 + 太重"。harness 下现已无任何插件调用 LLM（inject 已移除 'llm'，selectMemories.ts 已删除）。

**How to apply:** 给 harness 插件设计"需要理解内容"的新功能时，默认用确定性机制（frontmatter/路径匹配/索引）+ agent 主动工具调用，不引入后台模型请求；确有必要时先向用户确认。
