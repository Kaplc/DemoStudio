---
name: add_reminder_skip_when_already_saved
task_type: feature/harness-plugin
outcome: success
date: 2026-09-10
prefix: harness/ds-memory
---
## Summary

给 ds-memory 回合末提醒加"本回合已保存过记忆或经验就跳过"判定：agent/pre-step 记当前回合号、tools/result 登记保存类工具（memory_write + experience_save）成功调用，turn-stopping 时回合号相等即不注入；顺带把与实现脱节而恒红的 endOfTurnReminder.test.ts 按现行 turn-stopping + steer 实现翻新，单测 121 全绿 + 编译产物冒烟通过。

## Lessons

1. 判定"本回合"必须跨事件凑齐信息：`agent/turn-stopping` 带 turn，但 `tools/result` 的 ToolExecution **没有** turn 字段（只有 name/agent/parent/signal/token）→ 用 `agent/pre-step`（payload 带 turn）把当前回合号存进 WeakMap<Agent, number>，tools/result 时回填"保存发生在哪个回合"，再与 turn-stopping 的 turn 比较。别名 agent、缺 agent、未观测到回合号一律按"未保存"放行（fail-open，宁可多提醒）。
2. `agent/pre-step` 是 waterfall 事件：监听器必须 `await next()` 并把返回的决策原样传下去，否则否决链上后续监听器与内建行为（cordis `waterfall` 实现：不调 next() 就是 veto）。`tools/result` 的 handler 返回类型是字面量 `undefined`，写成 `: void` 直接 TS2345 —— 必须显式 `return undefined`。
3. 保存判定与联想开关解耦：ds-memory 里 `tools/result` 监听只在 enableAutoAssociate 时才由 associate.ts 注册；新的"已保存"登记必须在自己块里独立注册，否则关掉联想后提醒判定静默失效。
4. 动手前先跑一遍 `npx vitest run`：`tests/endOfTurnReminder.test.ts` 锁的还是早已废弃的"agent/pre-step 第一步注入"实现，5 个用例恒红（假红），不先跑就会被当成"改了才红"。翻新时按现行实现重写（turn-stopping + steer 文本/source/冷却/子 agent/中止/抛错 + 新的跳过分支），用例数 108→121。
5. 验证梯度：单测全绿 → 写个 5 行 node 脚本 `import('file:///<abs>/dist/index.js')` 起桩 ctx，模拟 pre-step→tools/result→turn-stopping 序列断言 steer 次数（能验编译产物真实行为，成本极低）→ 真实会话生效仍需重启内核（junction 插件随进程启动载入）。
6. 跨插件判定用工具名清单而非 import：ds-memory 不依赖 ds-experience，只按 name 认 `experience_save`，并暴露 `reminderSkipTools` 配置（默认两项、`[]` 关闭判定）——避免硬耦合又便于以后扩展 rule_propose 等保存类工具。

## Effective Path

harness/ds-memory/src/index.ts / harness/ds-memory/tests/endOfTurnReminder.test.ts
