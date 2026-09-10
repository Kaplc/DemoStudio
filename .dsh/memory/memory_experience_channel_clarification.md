---
name: memory_experience_channel_clarification
description: 用户纠正：记忆和经验现在不是冷/热通道之分，两者都是混合通道（prefix 自动注入 + 按需检索）
type: feedback
---

规则：不要把记忆和经验简单描述为"冷通道/热通道"——两者现在都是混合通道，都支持 prefix 自动注入（热）和 memory_search/experience_search 按需检索（冷）。

**Why:** 早期设计中记忆=热（自动注入）、经验=冷（按需检索），但 ds-experience 后来也加了 prefix 自动联想机制，两者读取方式已同构。继续用冷热比喻会误导分工理解。

**How to apply:** 描述记忆/经验分工时，用"写入触发点不同"（记忆=事实规则纠正，经验=做事轨迹）和"内容粒度不同"（记忆=一句话结论，经验=一次完整任务提炼）来区分，不要用冷热通道比喻。
