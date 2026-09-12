---
name: add_reminder_skip_when_already_saved
task_type: feature/harness-plugin
outcome: success
date: 2026-09-10
prefix: [harness/ds-memory/tests/endOfTurnReminder.test.ts, harness/ds-memory/REQUIREMENTS.md, harness/ds-memory/src/index.ts]
---
## Summary

给 ds-memory/ds-experience 回合末提醒加"本回合已保存过则跳过"判定：pre-step 记 turn + tools/result 登记成功保存；2026-09-10 修订跳过语义为"各自只看自己"（memory 仅认 memory_write，experience 新增同款判定仅认 experience_save），修正 OR 跳过与双写教义的矛盾。

## Lessons

1. 判定"本回合"必须跨事件凑齐信息：tools/result 的 ToolExecution 没有 turn 字段 → 用 agent/pre-step（waterfall，必须 await next() 并原样返回决策，否则 veto 链上后续监听）把回合号存 WeakMap<Agent,number>，tools/result 回填"保存发生在哪个回合"；memory 侧 turn-stopping 自带 turn 直接比，experience 侧 turn/end 不带 turn、读 WeakMap 里的当前回合号（未观测到则 fail-open 照常提醒）。2. tools/result 的 handler 返回类型是字面量 undefined，声明 : void 直接 TS2345——必须显式 return undefined。3. 保存判定与联想开关解耦：跳过判定的 pre-step/tools/result 监听必须在提醒块内独立注册，不能依赖 associate 的监听器（关掉联想判定会静默失效）。4. 动手前先跑 npx vitest run（endOfTurnReminder.test.ts 曾因实现改道 5 用例恒红）；experience 侧启用联想后 agent/pre-step、tools/result 各有 2 个监听器，装配用例要断言 toHaveLength(2)。5. 验证梯度：单测全绿 → node 脚本 import dist 起桩 ctx 模拟事件序列 → 真实会话生效需重启内核（junction 随进程启动载入，改 dist 不影响运行中进程）。6. 跨插件判定用工具名清单而非 import：不依赖对方插件，按 name 认工具并暴露 reminderSkipTools 配置（[] 关闭判定）。7. 2026-09-10 语义修订（用户确认改 1）：旧 OR 跳过与双写教义矛盾——同一次事件应既存结论（memory_write）又存轨迹（experience_save），只存了经验不代表没漏存记忆；修正为"各自只看自己"（memory 默认 ['memory_write']，experience 新增同款判定默认 ['experience_save']）。改提醒跳过语义必须五处同步：两侧 src + 两侧测试 + doc（harness_system.md / dsh_data_flywheel_plan / dsh_data_flywheel_test_cases / REQUIREMENTS.md）+ 记忆条目，漏一处就会出现文档与行为漂移。

## Effective Path

harness/ds-memory/src/index.ts + harness/ds-experience/src/index.ts；tests/endOfTurnReminder.test.ts（mem）+ tests/index.test.ts（exp）
