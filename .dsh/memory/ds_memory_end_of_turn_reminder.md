---
name: ds_memory_end_of_turn_reminder
description: ds-memory 插件新增回合末自动提醒机制，提示 agent 检查是否需要保存记忆
type: project
---
## ds-memory 回合末提醒机制（2026-03-25 新增）

**功能说明：**
ds-memory 插件新增了回合末自动提醒机制，在每个回合结束（turn/end）时，自动注入记忆提醒消息，提示 agent 检查是否需要保存记忆。

**触发条件：**
- 回合结束事件（turn/end）
- 冷却时间：60 秒（防止过于频繁注入）

**提醒内容：**
快速回顾本回合是否有值得跨会话记住的信息：
- 用户纠正或确认了某个方向？
- 做出了架构/设计/工作流决策？
- 定位到可复用的根因教训？
- 了解到用户的角色/偏好/工作习惯？
- 拿到外部系统指针（看板/文档站 URL）？

**配置项：**
```yaml
# cordis.patch.yml
- insert:
    - id: ds-memory
      name: '@demostudio/ds-memory'
      config:
        enableEndOfTurnReminder: true  # 默认开启
```

**技术实现：**
- 监听 `session/event` 事件中的 `turn/end` 类型
- 通过 `agent.inject()` 注入提醒消息
- 消息来源标记为 `ds-memory:end-of-turn-reminder`

**Why:** 人类工程师不会在回合末主动反思"今天学到什么要记下来"，但 agent 每回合是无状态的，需要被动提醒来触发记忆保存。

**How to apply:** 该机制默认开启，如需关闭可在配置中设置 `enableEndOfTurnReminder: false`。
