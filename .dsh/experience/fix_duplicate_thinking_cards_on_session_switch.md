---
name: fix_duplicate_thinking_cards_on_session_switch
task_type: debug/race-condition-fix
outcome: success
date: 2026-09-16
prefix: [src/components/AgentPanel.tsx, src/components/agent/liveCardGuard.ts, tests/agentLiveCardRace.test.tsx]
---
## Summary

修复"切回运行中会话出现两张相同思考卡"：根因是 live 卡创建守卫读滞后的 messagesRef + 整表替换后 live ref 未作废；裁决移入 updater 纯函数 + ref 作废，配竞态窗口判别器测试双向验证。

## Lessons

有效路径：① 排查顺序：先看渲染分组（消息→step→ReasoningBlock bare 模式无 .tool-card__name，断言选择器要用 .reasoning-block__text）→ 再沿「谁会追加同内容卡片」找全部追加源（live delta / flush 入队 / 历史回放）→ 对每个源的守卫逐条核对时序。② 测试判别器设计：resolveSwitch 后 await Promise.resolve() 让续体 microtask 先跑、再同步 emit delta，即可在 act 内复现「历史已入队、messagesRef 未同步」窗口；日志双行（live 卡创建 → 创建放弃）就是修复生效的直接证据。③ 回滚验证别只改断言——把组件 updater 临时换回旧实现跑出 [pre, pre] 长度 2 的红，才证明判别器抓的是真竞态。④ SessionSidebar 桩数据 updatedAt 必须用 Date.now()，旧时间戳进折叠分组导致 getByText 找不到条目；VirtualList 在 jsdom 需 polyfill ResizeObserver + Element.scrollTo。⑤ vi.hoisted 里的 mock 对象要在 use 前声明 SwitchPage 等类型别名，否则 tsc 对 hoisted 推断类型报错。⑥ 全量 vitest 12 红全部预置（11 warm 数值 + 1 imageLightbox ToolCard 回退，均与本次零 import 交集），照 memory:root_lint_script_broken 用直连 node 二进制跑。

## Effective Path

src/components/agent/liveCardGuard.ts（appendLiveCard 裁决）；src/components/AgentPanel.tsx（两处 live handler updater + restoreHistory/handleSwitchSession 的 ref 作废）；tests/agentLiveCardRace.test.tsx（判别器用例）
