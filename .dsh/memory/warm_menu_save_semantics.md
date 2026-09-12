# warm 主菜单存档语义（2026-09-13 核实）

**Problem:** 主菜单 e2e 对「CONTINUE 无档停留」的断言全反：点了 CONTINUE 反而切进星图；「菜单场景无调试桥」的断言也红了（save_menu.spec 既有红基线之一）。

**Cause:** ① 仓库自带出厂档 `projects/warm-current/data/slot1.json`（savedAt 2026-09-10），SAVE_SLOT_FILES 相对仓库根，浏览器模式 Mock readJsonFile 有 dev-server fetch 回退、真机直读磁盘——两条通道都读得到 → CONTINUE **恒有档可读**，「三槽全空停留」分支在当前仓库状态不可达。② `switchToMenuScene` 也会 `installDebugBridge()`——`window.__warmCurrent` 在菜单场景就存在，只是 `ready()` 为 false（仅星图场景 ready）。

**Solution:** 主菜单 e2e 切场景断言一律用 `__warmCurrent.ready()`，不用桥存在性；CONTINUE 用例按「读出厂档 → 切星图 → 桥就绪」写（e2e/warm/main_menu.spec.ts）。

**Applicable:** `e2e/warm/` 所有主菜单/存档 spec；`projects/warm-current/gameplay/core/save.ts` 槽位路径、`WarmCurrentGameInstance.ts` 场景路由。
