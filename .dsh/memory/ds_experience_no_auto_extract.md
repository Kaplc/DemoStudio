---
name: ds_experience_no_auto_extract
description: 经验插件移除自动提炼，改为 AI 自觉调用 experience_save
type: project
---
经验插件已移除自动提炼机制，改为 AI 自觉保存。

**Why:** 用户认为自动提炼（空闲判定+确认弹窗）太重，agent 自己知道做了什么，靠 system prompt 指导即可。

**How to apply:** ds-experience 插件不再监听 `agent/status` 和 `agent/pre-step`，不再有 `judgeIfTask()` 和自动提炼流程。经验保存完全由主 agent 在回合内主动调用 `experience_save` 工具完成。
