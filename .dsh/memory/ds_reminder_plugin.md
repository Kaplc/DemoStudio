---
name: ds_reminder_plugin
description: 回合末提醒机制 2026-09-13 起由独立插件 @demostudio/ds-reminder 承载：配置声明提醒条目、文案文件化 .dsh/reminder/*.md 实时读取、steer/inject 双通道、skipTools 各自只看自己
type: project
prefix: [harness/ds-reminder/src/index.ts, scripts/sync-dsh-plugins.mjs]
---

# 回合末提醒机制（ds-reminder）

规则：回合末提醒 2026-09-13 起由独立插件 `@demostudio/ds-reminder` 统一承载（用户决策"提取成单独的提醒插件 + 提示词文件化"）——ds-memory/ds-experience 不再自带提醒代码与 `enableEndOfTurnReminder`/`reminderSkipTools` 配置。

**Why:** 两个业务插件各自维护几乎相同的回合末提醒脚手架（~80 行 × 2），且提醒文案硬编码在源码里、改文案要重编译重启。

**How to apply:**
- 改提醒行为/加提醒条目 → `harness/ds-reminder`（配置声明条目：id/file/channel/skipTools/cooldownMs/enabled；无效条目 warn 丢弃不阻塞装载）。
- **改提醒文案 → 直接编辑 `.dsh/reminder/` 下的文案文件（memory-end-of-turn.md / experience-end-of-turn.md / 文档更新提醒.md），注入前实时读取，改文件即生效，无需重编译或重启**。
- **新增提醒条目**：reminders 是全量替换语义——在 `scripts/sync-dsh-plugins.mjs` 的 ds-reminder 块里把全部条目（含原有两条）一起声明 + `.dsh/reminder/` 放文案文件，改完跑 sync 脚本，重启生效。
- 通道：steer=`agent/turn-stopping`+`agent.steer()`（回合多跑一步）；inject=`turn/end`+`agent.inject()`（入队下回合）。跳过判定"各自只看自己"不变（记忆条认 `memory_write`、经验条认 `experience_save`，双写互不抑制）。
- 挂载：`scripts/sync-dsh-plugins.mjs` 的 `reminderDir: 'E:/DemoStudio/.dsh/reminder'` 块是权威源（editor.bat 启动重新生成 patch，漏改它改动会丢）。
- **过渡期双发（2026-09-14 实测）**：提醒机制迁移后、内核重启前，旧插件（内核内存里的旧 ds-memory 代码）与新挂载的 ds-reminder 会**同时各发一条相同提醒**——重启内核即收敛为单发，不是 ds-reminder 的 bug。
- 机制细节与踩坑史见 memory:ds_memory_end_of_turn_reminder（Applicable 段仍适用于一切回合边界注入）。
