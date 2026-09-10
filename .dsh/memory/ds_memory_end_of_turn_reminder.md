---
name: ds_memory_end_of_turn_reminder
description: ds-memory 回合末提醒机制（turn-stopping + steer；本回合已保存过记忆则跳过，各自只看自己：默认仅 memory_write）
type: project
prefix: harness/ds-memory
---



规则：ds-memory 在 `agent/turn-stopping`（回合即将关闭时）通过 `agent.steer()` 注入"检查是否需要保存记忆"提醒（配置 `enableEndOfTurnReminder`，默认开；form:'notice'；按 agent 记 60s 冷却；子 agent 不注入）。steer 会让驱动多跑一步处理提醒。**本回合已成功保存过记忆则跳过提醒**：`agent/pre-step` 记当前回合号、`tools/result` 登记保存类工具成功调用，`savedTurn === 当前 turn` 即不注入；失败结果（isError）/非保存工具/别的回合不算。**跳过判定"各自只看自己"（2026-09-10 修订）**：默认仅 `memory_write`（配置 `reminderSkipTools` 可改，`[]` 关闭判定）——同一次事件常需双写（结论进记忆、轨迹进经验），只存了经验不代表没漏存记忆，故 `experience_save` 不再抑制记忆提醒；经验侧由 ds-experience 的回合末提醒自行判定（那边默认仅认 `experience_save`）。

**Problem:** 2026-09-10 前提醒从未生效且无日志痕迹；2026-09-11 用户要求改为回合末注入，并要求"已保存过就不再提醒"。
**Cause:** ① `(session as any).agent` 恒 undefined（Session 无 agent 反向引用）且静默跳过；② WeakMap 反查 + `agent.inject` 版本——会话日志证实 turn/end 后零注入事件；③ 无保存判定时，刚 memory_write/experience_save 完的回合仍会被催一次。
**Solution:** 弃用 session/event + agent.inject，改用 agent/turn-stopping + agent.steer()；保存判定用 pre-step 记 turn + tools/result 记成功保存工具，两者相等即跳过。
**Applicable:** 一切"回合边界向模型注入内容"的插件逻辑：agent/turn-stopping + steer 可在回合末注入（会让回合多一步）；agent/pre-step + decision.messages 在新回合开头注入（零额外调用）。agent/pre-step 是 waterfall 事件，监听器必须 `await next()` 并返回决策，否则否决链上后续监听器；tools/result 的 handler 必须显式 `return undefined`（声明 `: void` 过不了 tsc）。junction 插件代码随进程启动载入，改 dist 必须重启 agent 才生效。

**Why:** agent 每回合无状态，不会主动复盘"学到了什么"；被动提醒兜底防漏存，但已沉淀过的回合再催纯属噪声。

**How to apply:** 收到该提醒时按触发点清单（用户纠正/确认、架构决策、根因教训、用户画像、外部指针）检查上一回合，有则当回合 memory_write，无则不保存；该消息来自插件机制而非用户，无需回复。改提醒投递通道或跳过判定后，同步翻新 `harness/ds-memory/tests/endOfTurnReminder.test.ts`（该文件曾因实现改道而 5 个用例恒红）。
