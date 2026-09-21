---
name: fix_warm_e2e_baseline_reds
task_type: debug/test-fix
outcome: success
date: 2026-09-21
prefix: [projects/warm-current/e2e/save_menu.spec.ts, projects/warm-current/gameplay/ui/PauseMenuScript.script.ts, src/engine/ui/UIManager.ts, doc/testing/playwright_commands.md]
---
## Summary

修复 warm e2e 全部 12 个基线红（47 用例全绿）：根因=1 个真 bug（autoDeactivatePanels 让 PauseMenu spawn 即整树失活不可见，onStart 兜底激活根修复）+ 11 个 spec 断言随功能演进/定版语义变更陈旧（按钮改名、字段删除、滚轮落点平移定版、bActive 权威、云层真实历法微速、冷却窗时窗竞态），逐个探针取证后修 spec 断言或修实现。

## Lessons

1) 12 红四类根因：①真 bug 1 个——UIManager.autoDeactivatePanels（09-16 帧饥饿修复）让二级面板 spawn 即 bActive=false 整树失活，PauseMenu/StatsPanel 等不走 VisBinder 的独立面板没人兜底激活根 → Esc 菜单肉眼不可见+clickActor"命中层不可见"；修法=PauseMenuScript.onStart 置 this.actor.bActive=true（spawn=打开 语义）。②按钮/字段改名删改（Btn_ship→Btn_inc_*、payloadDesignOpen/openPayloadDesign 已删、overclocked 功能下线、cargo_pod→cargo_hold）——spec 断言跟实现演进脱节，探针打印 __ai.emit 完整回执（error 原文）是最快定位法。③定版语义变更未同步 spec：滚轮落点平移（09-20：俯视态滚轮悬天体只写 rig.target 不进观察，吸附进观察只认双击）、对调优先于换装（09-13）、云层真实历法微速负 spin（09-15：-0.0049/-0.0056，真实帧驱动与 stepTicks 解耦）、bActive 权威整树级联（09-16：关=整树隐藏）。④时窗竞态：跨 page.evaluate 往返 0.3~1s 必超 500ms 冷却窗——时窗内多步操作合进同一次 evaluate 原子执行（坑 59 已录手册）。2) 面板失活的甄别信号：clickActor 报"命中层不可见"且 findRec 能找到按钮树 → 查根 bActive/visible；探针面板树自检打印 root.visible/bActive 一步定位。3) pickShipyardSlotModule 语义：再点已装件=卸下、目标件已装他实例=对调（优先于换装）、空槽=装入——写引用保护类测试前先数清"当前装配"里有什么，再点一次就是卸下不是确认。

## Effective Path

projects/warm-current/e2e/（8 个修复 spec） || projects/warm-current/gameplay/ui/PauseMenuScript.script.ts（二级面板 onStart 兜底激活根） || doc/testing/playwright_commands.md（坑 59）
