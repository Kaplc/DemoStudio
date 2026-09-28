---
name: warm_defeat_line_removed
description: 2026-09-30 warm 环熄灭失败线下线的边界决策（保留温度展示+燃料门、删败局框架）与被否方案
type: project
prefix: [doc/game/modules/09-胜负与结算.md]
---

# warm 环熄灭失败线下线（2026-09-30 用户拍板）

规则：warm-current 堆心温度归零**不再判负**——checkDefeat/defeat 事件/败局结算/重试本幕/败北音效整体移除，`SimOutcome` 只剩 playing/victory，`actSnapshots` 字段删除（旧档 `defeat` 读入映射 `playing`）。**保留**：堆心温度状态与全部 UI 展示（状态行文案"熄灭"改"归零"）、断环燃料门（储量耗尽停烧停建、ring='decaying'）、蓄热井建筑（cool/warmTimeMult 仍作用于降温/回温时长）。当前 warm 无失败线，仅胜利结算。

**Why:** 用户三问三答定的边界——①深度选"只摘失败判定"（否决全链删除：温度体系保留），②燃料门保留（否决一并移除），③defeat 框架一并删除（否决保留插口）。"先移除"表明失败机制处于重做前夜，新失败线未定。

**How to apply:** 后续 warm 结算/失败机制相关改动以 doc/game/modules/04、09 的 2026-09-30 追记为准；若用户新提失败机制，直接搭新线（不再有 defeat 事件/outcome 插口，需重新引入）；回归锁在 projects/warm-current/e2e/no_defeat.spec.ts 与 tests/warmCurrentCoreTemp.test.ts。
