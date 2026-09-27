---
name: end_of_turn_noop_dot_reply
reason: 用户 2026-09-30 纠正：回合末提醒"什么都不做"时输出了整段复盘说明，属于噪音，要求直接返回句号。
date: 2026-09-28
---
回合末提醒复盘结论为"无事可做"（无强化、无提炼、无新记忆）时，回复只输出句号「。」——不附加复盘说明、判断理由或思考过程。确有操作（memory_reinforce / experience_save / memory_write）时，才输出对应的一句结论。
