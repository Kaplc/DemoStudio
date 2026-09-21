---
name: fix_partial_adopt_on_switch_back
task_type: bugfix
outcome: success
date: 2026-09-21
prefix: [src/components/AgentPanel.tsx, tests/agentPartialAdopt.test.tsx, doc/editor/integration/agent_panel_system.md]
---
## Summary

修复"切回会话出现两个思考卡且下面的卡很卡"：日志取证定位双根因（flush 清空重放已上屏前缀 + a-skip 捷径无半截段守卫），consumeDisplayItem 改为半截段原地采纳免重放（扫描式判定），3 例单测回滚验证双向证明。

## Lessons

有效路径：① 用户给截图先比对会话 id——截图里的会话正是上一个报同题的会话（问题在排查中复现），console_*.log 的 [Trace] 管线（fold/入队/消费/采纳）能完整还原真实事件序列，先取证再推演。② 双根因定案：a) flush 的 replacingPartial 把半截段清空后打字机重放已上屏前缀（30~200 字/s，2k-12k 字符段 20-120s）="很卡"；b) a-skip 快速路径（queueLength>0）append 不查半截段=同文两截="两个思考卡片"，其触发前提（HMR/重连恢复恰好落在回放期间）解释了"时不时"。③ 修复=原地采纳免重放；半截段判定必须从尾向前扫描而非只看末位——ready{restored} 路径的 pushSystem('会话已恢复') 会把半截段顶离尾部（这是单测抓出来的人民词汇级别陷阱，尾部判定版测试全绿是假阴性）。④ 回滚验证必须把旧行为恢复完整：第一版回滚只短路了预判标志、in-updater 扫描采纳仍活着，测试假绿；补齐 partialIndex 强制 -1 后才双红，且探针 DOM 恰好复现"推理 2 段"双卡。⑤ 测试机制坑：本环境 jsdom rAF 是真实的（vitest toFake rAF 不生效），打字机推进靠真实帧——断言平滑动画文本前要 vi.advanceTimersByTime 推帧（fake setTimeout 生效时）或依赖真实时间窗；跨 act 边界的真实 rAF drain 提交顺序不可靠，受控场景要显式推帧把 drain 圈进 act。⑥ 根包无 eslint（lint script 既有损坏），门禁=tsc+vitest：tsc 现存 3 个 warm e2e 预置错误在并行改动域，按"错误文件与本次改动域求交集"判定不阻塞。规则沉淀见 memory:react_stale_ref_guard_pitfall（2026-09-21 段）。

## Effective Path

src/components/AgentPanel.tsx（consumeDisplayItem：a-skip 守卫 + 扫描采纳 + 免重放分支）；tests/agentPartialAdopt.test.tsx（3 例判别器）；doc/editor/integration/agent_panel_system.md §22
