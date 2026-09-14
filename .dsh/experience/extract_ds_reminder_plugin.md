---
name: extract_ds_reminder_plugin
task_type: refactor/plugin-extraction
outcome: success
date: 2026-09-14
prefix: [harness/ds-reminder/src/index.ts]
---
## Summary

把 ds-memory/ds-experience 各自的回合末提醒脚手架提取为独立插件 @demostudio/ds-reminder：配置声明提醒条目（通道 steer/inject、skipTools 跳过判定、冷却、子 agent 门控），文案文件化 .dsh/reminder/*.md 注入前实时读取；两侧提醒代码与配置移除，测试/文档/记忆全量同步。

## Lessons

1. schemastery 嵌套 schema 坑：z.array(z.object({…})) 的推导类型与"可选字段 + 字面量联合 channel"接口双向对不上（TS2345），解法是 reminders 字段用 z.any<T>().default([...]) 透传、有效性全交运行时 normalizeReminder 把关（无效条目 warn 丢弃不阻塞装载）。2. schema 的 default 值在模块加载时求值：DEFAULT_REMINDERS 必须声明在 Config schema 之前，否则 TDZ ReferenceError。3. 提取同步面清单（缺一即漂移）：两侧 src+测试+REQUIREMENTS+package.json description + 两侧 system prompt 指导段措辞（enableEndOfTurnReminder 等配置名不再存在）+ flywheel 两篇 + harness_system.md + scripts/sync-dsh-plugins.mjs + 记忆条目；测试侧 ds-memory 125→106（删 endOfTurnReminder.test.ts）、ds-experience 72（index.test.ts 重写：提醒 describe 与孤儿 helper 全删、联想装配断言 tools/result 与 pre-step 各 2→1）。4. 挂载顺序：项目侧 patch 由 scripts/sync-dsh-plugins.mjs 生成、editor.bat 复制到 ~——先改生成器（加 reminderDir 块）→ node 跑 sync → mount_plugin（其 patch 步幂等），两侧一致且 Select-String 确认 id 不重复。5. dist 冒烟：node -e import dist + 桩 ctx（on 收集事件名 + logger 静音）直接调 apply，看注册监听清单是否符合通道按需注册预期。6. ds-experience associate 集成测试在并行负载下偶发抖动（已知坑），单次红先重跑再排查。
