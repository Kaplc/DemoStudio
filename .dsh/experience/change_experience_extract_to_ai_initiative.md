---
name: change_experience_extract_to_ai_initiative
task_type: refactor
outcome: success
date: 2026-09-01
---
## Summary

重构 ds-experience 经验插件的提炼机制：从回合末空闲自动提炼改为人工同意，用户进一步澄清后最终简化为纯 AI 自觉——agent 完成有复用价值的任务后自己调用 experience_save 保存，移除全部状态机/side-query 判定/确认流程，代码量减少约 420 行（index.ts 412→112 行）并编译通过。

## Lessons

用户最初说『主 agent + 人工同意』，第一版实现时加了完整的状态机（judgeIfTask 判定 + 注入确认消息 + 等回复 + 超时），但用户澄清『不需要空闲，准备结束时就提醒 AI』后，才发现真正诉求是轻量和简单，最终方案是靠 system prompt 驱动 AI 自觉调用 experience_save，几乎推翻第一版全部代码。教训：改交互流程前应先用 ask_user_question 把触发时机、判定方式、确认交互问清楚，避免按字面需求先做一遍复杂实现再重写——第二版一共只动了 4 个文件，第一版做的 judgeIfTask/确认状态机全部删除；下次遇到『改提炼/保存时机』类需求，直接追问『需要 AI 自觉还是用户确认』『什么时候触发』再动手。

## Effective Path

harness/ds-experience/src/{index.ts,extractExperience.ts,experienceTypes.ts}
