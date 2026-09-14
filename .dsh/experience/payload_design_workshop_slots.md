---
name: payload_design_workshop_slots
task_type: feature/gameplay-ui
outcome: success
date: 2026-09-14
prefix: [projects/warm-current/asset/config/ship_hull.table.json, projects/warm-current/asset/config/ship_module.table.json, projects/warm-current/gameplay/core/balance.ts, projects/warm-current/gameplay/ui/PayloadDesignScript.script.ts, e2e/warm/payload_design.spec.ts]
---
## Summary

火箭三部位改版+荷载设计工坊：槽型更名(payload/fuel/engine、功能槽下线)、主体+附件合成自定义荷载（动态模块注册表投影）、新居中面板与 e2e 全绿

## Lessons

有效路径：① 槽位制改动走「表 + B 默认值双写」：改 ship_hull/ship_module 表必须同步 balance.ts DEFAULT 区，否则单测（只读 B）与运行时口径漂移——本次 warmSupplyChain 3 条旧断言（cargo/tank/utility）即按新口径改写并新增荷载合成锁（875=(300+140+320)×1.15 进 5 取整）。② 自定义合成件挂 balance.ts 动态注册表（setDynamicShipModules/shipModuleDefOf 先查注册表），shipMults/整单价/槽位校验/部位清单全下游零改动透明生效；选项清单用 shipModuleEntries()（静态+动态合并），不能直接迭代 B.shipModules。③ 新居中面板照抄 ShipDesignScript 差分模式（vis.set 收起→8Hz 同步），HudScript centerPanels 登记即得互斥；编译走 HTTP MCP POST /api/command ui_compile（9877 起，新 widget 先手写最小 seed json 否则落盘报"没有打开的工作副本"）。④ e2e 断言"选项数"时先数清状态里存了几个设计（本次漏算 pd2：6 现货+2 设计=8 而非 7）。环境坑：5173 被并行实例占（::1 监听，127.0.0.1 探测 DOWN 但 vite 报 in use）→ npm run dev 落 5174，e2e 用 E2E_BASE_URL 指路；npm run dev 会拉起第二个 electron（DSH 引导 degraded 因 3080 被现有 GUI 占用，属预期噪声不影响 vite 服务页面）。BOM：WarmCurrentGameMode.ts/helpers.ts 每次编辑后必抹，git diff 首行 `-﻿/**` 即实证，按记忆命令补回。
