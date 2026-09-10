---
name: ds_memory_end_of_turn_reminder
description: ds-memory 回合末提醒：走 agent/pre-step + decision.messages 投递（session/event + agent.inject 链路不可靠已否决）；60s 按 agent 冷却
type: project
prefix: harness/ds-memory
---
规则：ds-memory 在新回合第一个 `agent/pre-step`（step===1）向 `decision.messages` 追加"检查是否需要保存记忆"提醒（配置 `enableEndOfTurnReminder`，默认开；form:'notice'；按 agent 记 60s 冷却；子 agent 不注入）。与 associate.ts 的 prefix 联想同一条投递通道——本会话内被长期验证能进入模型请求。

**Problem:** 2026-09-10 前提醒从未生效且无日志痕迹。
**Cause:** 两代实现先后踩坑：① `(session as any).agent` 恒 undefined（Session 无 agent 反向引用）且静默跳过；② WeakMap 反查 + `agent.inject` 版本——会话日志（`~/.dsh/sessions/*/session.jsonl.zstd`，多帧 zstd）证实 turn/end 后零 `target:"next-step"` 的 inbox/spliced 事件，注入从未发生且插件 logger 输出不可见，无法定位断点。
**Solution:** 弃用 session/event + agent.inject 链路，改用 agent/pre-step 的 PreStepDecision 消息追加（agent 引用直接来自 payload，无反查）。
**Applicable:** 一切"回合边界向模型注入内容"的插件逻辑：优先 agent/pre-step + decision.messages（有 associate.ts 先例）；agent.inject 的投递语义（send(input,'next-step',false)）在 web profile 实测不可依赖。另：junction 插件代码随进程启动载入，改 dist 必须重启 agent 才生效。

**Why:** agent 每回合无状态，不会主动复盘"学到了什么"；被动提醒兜底防漏存。

**How to apply:** 收到该提醒时按触发点清单（用户纠正/确认、架构决策、根因教训、用户画像、外部指针）检查上一回合，有则当回合 memory_write，无则不保存；该消息来自插件机制而非用户，无需回复。
