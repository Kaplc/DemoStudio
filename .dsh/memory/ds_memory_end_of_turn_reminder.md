---
name: ds_memory_end_of_turn_reminder
description: ds-memory 回合末自动提醒机制：turn/end 注入保存提醒，60s 冷却，配置 enableEndOfTurnReminder
type: project
prefix: harness/ds-memory
---
规则：ds-memory 在每个回合结束（turn/end）自动注入一条"检查是否需要保存记忆"的提醒（60 秒冷却防刷屏，默认开启，配置项 `enableEndOfTurnReminder`），来源标记 `ds-memory:end-of-turn-reminder`，经 agent.inject 进入上下文。

**Why:** agent 每回合无状态，不会像人类那样主动复盘"学到了什么"；被动提醒兜底防漏存。

**How to apply:** 收到该提醒时按触发点清单（用户纠正/确认、架构决策、根因教训、用户画像、外部指针）检查本回合，有则当回合 memory_write，无则不保存；该消息来自插件机制而非用户，无需回复。
