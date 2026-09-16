---
name: warm_holo_freeze_ui_panels_always_render
description: warm 全息"卡死"根因=18 个常驻 UI widget 全量参与渲染（3403 mesh / 2665 draw call），关闭态只藏 Body 未整树失活 → 20fps；已用 UIManager 统一开关 + VisBinder 走 bActive 修复至 59.6fps
type: project
prefix: [projects/warm-current/gameplay/ui/uiCommon.ts, src/engine/ui/UIManager.ts, projects/warm-current/gameplay/ui/HudScript.script.ts]
---

# warm 全息"卡死"= 常驻 UI 面板全量渲染（2026-09-16 定案并修复，推翻同日"帧饥饿"旧结论）

**Problem:** 用户报告"点开月球全息 → UI 卡死，地球全息没事"。此前（2026-09-16 早些）误诊为"渲染帧饥饿 rAF 1~11fps，环境级根因未锁定"。

**Cause:** `HudScript.onStart` 一次性 spawn 18 个 widget（HUD + 17 个二级面板），3403 mesh / 2665 draw call **常驻绘制路径**。面板"关闭"仅由各脚本 `vis.set(actor, 'XxxBody', false)` 隐藏 Body 子节点，面板根与边框/标题/装饰仍 `visible=true` 全部提交 GPU。实测：全部 UI 可见 20~25fps，隐藏全部 UI 62.8fps。JS 侧极廉价（starMap.render 0.008ms/call、buildViewModel 0.003ms/call），纯绘制调用开销。"地球没事"是错觉（地球全息同样 19.6fps），月球因公转跟随逐帧 `rig.pan` 在低帧率下抖动更显眼。

**Solution（已落地，三处）:** ① `uiCommon.ts` 的 `VisBinder.set` 走 `a.bActive`（`applyActiveTree` 整树级联），并在显示子节点时**兜底激活面板根**；② `UIManager` 加 `autoDeactivatePanels`（默认 true），二级面板生成即整树失活；③ 5 个面板脚本（HexModal/Settle/ReserveInfo/StatsPanel + 3 处 cell 池）的面板根显隐从 `root.visible` 统一改为 `bActive`。实测：空闲 20→60.3fps，月球全息 17.6→60fps，可见 mesh 352→117。测试 `tests/uiPanelDeactivate.test.ts`（11 绿）。

**踩坑 1（豁免判据·曾致改动完全空转）:** 首版豁免用 `parent instanceof HUD` —— 但二级面板不传 parent 时 `spawnUIActor` 内默认 `parent = this._hud`，与 `createHUD` 传的 HUD 内容 widget **parent 完全相同**，该判据把全部 17 个二级面板一并豁免，UIManager 改动对 warm **零生效**（实测 `inactivePanels=0`，页面 `spawnUIActor` 源码仍含旧判据）。正确判据 = `createHUD` 期间置位的私有标志 `_spawningHudContent`（`attachUI` 在 spawn 之后调用，比对不了 `hud.uiActor` 引用）。教训：**验证 HMR 是否真生效** —— 改完引擎代码页面仍跑旧码，须重开一局（或确认 `spawnUIActor.toString()` 含新代码）再断言。

**踩坑 2（面板永远打不开·未引爆的冲突）:** `applyActiveTree` 生效值 = 自身 `bActive && 父链 effective`。面板根一旦失活，脚本只置 Body 为真 → 仍不可见，**面板永远打不开**（实测手动 `hp.bActive=false` 后 `openHologram` 得到 `visibleMesh=0`）。故 VisBinder 必须兜底激活面板根，且直接写 `root.visible` 的脚本必须改走 `bActive`，否则权威分裂（一次 `bActive` 写入会从根重算并无声覆盖手写的 `visible`）。

**Applicable:** warm 及一切"多 widget 常驻 + 脚本自驱动显隐"的项目（hoi4 有自己的 uiCommon 无 VisBinder，不受影响）；诊断"卡死"先测 draw call 再按层二分，勿只看 JS 心跳。
