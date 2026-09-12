---
name: fill_two_plans_missing_regressions
task_type: test/regression-fill
outcome: success
date: 2026-09-11
prefix: [e2e/warm/slots_design.spec.ts, tests/warmCurrentSlotsAndDesign.test.ts]
---
## Summary

两方案（槽位化+设计权）实施记录虚标回归：重写 warm_ring_build 单测、新建 warmCurrentSlotsAndDesign 综合单测、联动修 5 个存量红文件、新建 e2e slots_design 探针 spec，vitest 345 全绿 + tsc 0 + e2e 21 过/6 条既有红基线。

## Lessons

1) 核实"测试是否存在"必须实跑 vitest：本仓 .gitignore:156 整个 tests/* 有意不入库，文档声称的测试名在 git/工作区都可能查无此物；grep path 圈目录还会假阴性，用 include 全仓过滤交叉复查。2) e2e evaluate 模板字符串页面原文执行不过 TS 转译，串内 as/类型注解直接 SyntaxError——串内纯 JS，断言放串外。3) 调试桥 state() 回活引用，原子 evaluate 内"改→读→改→读"若把 find 结果存变量，return 时全读到最终值（别名污染）——每步立即提取原语快照。4) earthH3 差值口径混入焚烧与拆后续建灌入，拆除断言改 ledger.ringBuild 增量 + 循环 stepTicks 到拆完立即回收点数停泵，才能精确等于拆除费。5) suppressFlare 会把 phase 置回 idle，测框选决策须显式 beginFlareWarn；stepTicks 走 GameMode.Tick，pause 即冻结，防自然败局用大储量+压耀斑而非暂停。6) 确定性三板斧（原子 evaluate/容忍漂移/压制时机）实战有效；全量 warm e2e 既有红基线 6 条（点击冷却×2/二级按钮/航线偏移/存档桥/开局取景）2026-09-11 复核仍在。

## Effective Path

tests/warmCurrentSlotsAndDesign.test.ts || e2e/warm/slots_design.spec.ts
