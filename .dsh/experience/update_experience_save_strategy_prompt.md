---
name: update_experience_save_strategy_prompt
task_type: feature/instruction-update
outcome: success
date: 2026-09-02
---
## Summary

用户问发现更优路线时如何处理旧经验，助手读取 ds-experience 的 store/types 确认当前同名覆盖机制，决定不改代码，改在 system prompt 指导段新增"发现更优路线时"的处理规则（同名覆盖但保留旧坑、不同名新建互相引用），随后构建和 lint 通过

## Lessons

这类策略问题优先考虑通过 system prompt 指导 AI 行为而不是改代码；修改前先读现有 store/types 确认去重机制；指导段强调不要丢失旧经验中"踩了什么坑"的信息，因为那是最有价值的部分；agent 保存前应先 experience_search 查旧经验再做覆盖或新建决策
