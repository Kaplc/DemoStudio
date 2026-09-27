---
name: experience_generation_per_task_rejected
description: 用户否定经验插件"每完成一个任务就存一条"的产生机制；已拍板改造方案（2026-09-30）：回合末复盘清单 + reinforce 确认式强化计数 + 多次使用的记忆提炼为经验，机械注入计数不做
type: feedback
prefix: [harness/ds-experience/src/index.ts, .dsh/reminder/experience-end-of-turn.md, harness/ds-experience/src/experienceTypes.ts]
---

规则：经验插件的产生机制不应是"每完成一个任务就存一条"（2026-09-30 用户明确否定："人类是怎么获得经验的……每完成一个任务都产生经验，不对吧"）。经验的价值信号是**使用强化计数**：agent 复盘确认"真用到了"才计数，而非机械的注入即计数。2026-09-30 用户拍板实施机制：回合末提醒改造为复盘清单——①本回合被召回注入的记忆/经验中逐条判断是否真用到了，用到才调 memory_reinforce / experience_reinforce（返回累计次数）并检查经验是否脱节需覆盖更新；②累计多次被强化的记忆若沉淀反复做事模式且尚无对应经验 → 提炼为经验（案例→规则升华）；③新经验不直接创建，唯一创建通道是"多次被强化的记忆提炼"——踩坑/教训先存为记忆，反复被强化使用达到阈值后才升华成经验；经验侧复盘只做"强化已用到的 + 覆盖更新脱节的"。机械的 associate 注入计数明确不做。

**Why:** 现状回合末提醒锚点在"完成任务"而非"学到新东西"，加上 agent 保守偏差与无淘汰回路，经验库退化成"任务数≈经验数"（80+ 条，含大量常规任务轨迹）；人类经验的粒度是"一个教训"而非"一次任务"，稀疏、踩坑驱动、召回即强化、可遗忘。"被注入但从未被强化"本身就是低价值条目的天然淘汰信号。

**How to apply:** 未来做经验系统相关改动时，不要强化"每任务一条"模式（如把提醒文案写得更积极催存）；涉及产生标准、提醒文案（.dsh/reminder/experience-end-of-turn.md、memory-end-of-turn.md）、强化计数、review 淘汰依据的设计一律对齐复盘强化闭环。experience_save 语义随之变更：仅用于 ①同名覆盖更新已有经验 ②从多次被强化的记忆提炼新经验，不再作为"任务完成"后的主动产出动作；"踩了新坑"类事件走记忆通道（memory_write 存根因教训）而非直接存经验。**已实施（2026-09-30）**：memory_reinforce/experience_reinforce 双工具（harness/ds-memory|ds-experience/src/usageStore.ts + tools），计数落 .usage.json；两侧提醒文案改复盘清单；ds-reminder DEFAULT_REMINDERS 与 scripts/sync-dsh-plugins.mjs 挂载块的 skipTools 均含 reinforce；指导段（memoryTypes/experienceTypes）同步改写；文档 flywheel 两篇 + harness_system.md 已更新。改 .usage.json 行为必须两侧同构同步。

