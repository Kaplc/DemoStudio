---
name: ds_experience_reminder_and_associate
description: ds-experience 回合末提醒（60s 冷却；本回合已 experience_save 则跳过，各自只看自己）+ prefix 联想（与 ds-memory 同构）
type: project
prefix: harness/ds-experience
---


规则：ds-experience 自 2026-09-09 起具备两条确定性链路（用户决策"同步 mem 的那种架构"）：
1. **回合末提醒**：`turn/end` 注入"回合末经验提醒"（60s 冷却，`enableEndOfTurnReminder` 默认 true），提示自查"本回合是否完成过有复用价值的完整任务"，有则当回合 `experience_save`；**本回合已成功 `experience_save` 则跳过**（2026-09-10 新增，与 ds-memory 提醒"各自只看自己"——双写场景互不抑制：`agent/pre-step` 记 turn + `tools/result` 登记，turn/end 时相等即不注入；默认仅认 `experience_save`，`reminderSkipTools` 可改、`[]` 关闭；fail-open——未观测到回合号照常提醒）。
2. **prefix 联想**：经验 frontmatter `prefix:` 表达式（`a || b` / `a && b`，与 ds-memory 同构），读到匹配文件时该经验全文自动注入（每会话去重；`enableAutoAssociate` 默认 true，项目根从 `<root>/.dsh/experience` 推导）。实现在 `harness/ds-experience/src/associate.ts`。

**Why:** 纯自觉保存实测触发/写入都太弱（经验当时无 prefix 联想、全靠手动检索 → 冷通道盲区；回合末提醒被 ds-memory 独占；更新旧经验比新建更易漏）；这是对 2026-09-08 裁撤"LLM 自动提炼"决策的**补充而非回退**——判定永远在主 agent，插件只给触发信号，零模型请求，`harness_no_llm_design` 依然成立。

**How to apply:** 收到"回合末经验提醒"按触发点检查；写高频领域经验时顺手带 `prefix`（如插件开发 → `harness`）；"经验插件会不会提醒/联想"以本条为准，无需重新调研代码。
