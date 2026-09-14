---
name: ds_memory_end_of_turn_reminder
description: 回合末提醒机制演进史与踩坑（2026-09-13 起机制由 @demostudio/ds-reminder 承载；本条保留 turn-stopping/steer、pre-step 记回合 + tools/result 跳过判定等可复用坑）
type: project
prefix: [harness/ds-reminder/src/index.ts]
---

规则：回合末提醒（2026-09-13 起由 `@demostudio/ds-reminder` 承载，此前在 ds-memory/ds-experience 各自实现）在 `agent/turn-stopping` 通过 `agent.steer()` 注入提醒（steer 会让驱动多跑一步处理提醒）。**本回合已成功保存过则跳过提醒**：`agent/pre-step` 记当前回合号、`tools/result` 登记保存类工具成功调用，`savedTurn === 当前 turn` 即不注入；失败结果（isError）/非保存工具/别的回合不算。**跳过判定"各自只看自己"（2026-09-10 修订）**：记忆条只认 `memory_write`、经验条只认 `experience_save`——同一次事件常需双写（结论进记忆、轨迹进经验），互不抑制。

**Problem:** 2026-09-10 前提醒从未生效且无日志痕迹；2026-09-11 用户要求改为回合末注入，并要求"已保存过就不再提醒"；2026-09-13 用户要求提取为独立插件且文案文件化。
**Cause:** ① `(session as any).agent` 恒 undefined（Session 无 agent 反向引用）且静默跳过；② WeakMap 反查 + `agent.inject` 版本——会话日志证实 turn/end 后零注入事件（ds-experience 现行 inject 通道用 agent/created+agent/status 双保险登记则可用）；③ 无保存判定时，刚保存完的回合仍会被催一次；④ 文案硬编码在源码，改文案要重编译重启。
**Solution:** 投递用 agent/turn-stopping + agent.steer()（或登记齐全的 turn/end + inject）；保存判定用 pre-step 记 turn + tools/result 记成功保存工具，两者相等即跳过；2026-09-13 机制收敛进 `harness/ds-reminder`，文案移到 `.dsh/reminder/*.md` 实时读取（现状见 memory:ds_reminder_plugin）。
**Applicable:** 一切"回合边界向模型注入内容"的插件逻辑：agent/turn-stopping + steer 可在回合末注入（会让回合多一步）；agent/pre-step + decision.messages 在新回合开头注入（零额外调用）。agent/pre-step 是 waterfall 事件，监听器必须 `await next()` 并返回决策，否则否决链上后续监听器；tools/result 的 handler 必须显式 `return undefined`（声明 `: void` 过不了 tsc）。junction 插件代码随进程启动载入，改 dist 必须重启 agent 才生效。

**Why:** agent 每回合无状态，不会主动复盘"学到了什么"；被动提醒兜底防漏存，但已沉淀过的回合再催纯属噪声。

**How to apply:** 收到该提醒时按触发点清单（用户纠正/确认、架构决策、根因教训、用户画像、外部指针）检查上一回合，有则当回合 memory_write，无则不保存；该消息来自插件机制而非用户，无需回复。改提醒投递通道或跳过判定后，同步翻新 `harness/ds-reminder/tests/reminder.test.ts`（前身 ds-memory 的 endOfTurnReminder.test.ts 曾因实现改道 5 用例恒红，已随移交删除）。
