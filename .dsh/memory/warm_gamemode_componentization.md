---
name: warm_gamemode_componentization
description: warm GameMode 2026-09-20 组件化定版：21 组件布局 + 薄转发门面约定 + 类型 re-export 路径（prefix: WarmCurrentGameMode.ts）
type: project
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts]
---

# warm GameMode 组件化定版（2026-09-20 用户拍板"abc都改了吧"）

规则：WarmCurrentGameMode 只保留生命周期编排（InitGame/BeginPlay/Tick 门控/EndPlay）、Esc 优先级分发、暂停/存档/重开编排、星图指针拖线胶水；**新增玩法逻辑一律做成组件**（`readonly xxx = this.addComponent(XxxComponent)` 字段初始化器），不加在 GameMode 本体。

**Why:** 3580 行单文件不可维护；2026-09-20 按 A/B/C 三层下沉为 10 个 BObjectComponent：sky/hit/feedback/vm/ship/payloadDesign/panels/fleet/holo/view（systems/ 目录，与原 11 个系统组件并列，合计 21）。GameMode 公开方法保留**薄转发门面** + 选择态**只读 getter 门面**——UI 脚本（wcMode().xxx）与 e2e 调用面不变，是本次零调用点改动的关键。

**How to apply:**
- HUD 视图模型类型（WarmCurrentVM/Hud*）在 `systems/ViewModelComponent.ts`，经 WarmCurrentGameMode.ts `export type {}` re-export——外部 import 路径仍是 `../base/WarmCurrentGameMode`，勿改。
- 跨组件私有依赖已公开化：GameMode.applyZoomFloor/clearObserveState/pendingObserveClick、四个跨域 buildXxxVM（buildHologram/buildShipyardVM/buildShipDesignVM/buildPayloadDesignVM）。
- "面板关闭不动相机"语义在 view.clearObserveState（清状态不取景 + holo.clearTransient）；全息卫星跟随=holo.tickFollow（pan 口径），观察跟随=view.tickObserveFollow（原地转头口径），均在 GameMode.Tick 同位调用。

