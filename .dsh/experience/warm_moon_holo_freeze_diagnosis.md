---
name: warm_moon_holo_freeze_diagnosis
task_type: debug/diagnosis
outcome: success
date: 2026-09-16
prefix: [projects/warm-current/gameplay/ui/uiCommon.ts, src/engine/ui/UIManager.ts, projects/warm-current/gameplay/ui/HudScript.script.ts]
---
## Summary

诊断并修复 warm"月球全息卡死"：推翻此前"渲染帧饥饿（环境级，根因未定）"的旧结论，实测定位为 **UI 层常驻面板全量参与渲染**——HUD 一次性 spawn 18 个 widget（3403 mesh / 2665 draw call），关闭态只藏 Body 子节点、面板根与边框/标题/装饰仍 visible=true，全部留在绘制路径 → 20fps。实测修复后 59.6fps。

## Lessons

1) "画面卡死"先分三层测：rAF 帧率 → draw call（`renderer.info.render.calls`）→ 按层隐藏二分（`ui.scene.visible=false` / 逐个 actor 隐藏）。本例 JS 侧极廉价（starMap.render 0.008ms、buildViewModel 0.003ms），纯 GPU 绘制调用开销，只看 JS 心跳会误判为"帧饥饿/环境问题"。2) **关闭的面板必须整树失活**：只把 Body 子节点 visible=false，面板根及其余子节点仍进绘制路径。引擎 `Actor.bActive` setter 已内建 `applyActiveTree` 整树级联，脚本应走它而非直接写 `root.visible`。3) `renderer.info.render.calls` 是比 fps 更稳的判据。4) 旧结论"地球没事、月球卡"不成立：地球全息同样 19.6fps，用户感知差异来自月球公转跟随（逐帧 rig.pan）在低帧率下抖动更显眼。5) **底层统一开关要防误伤**：UIManager 加"二级面板默认整树失活"时，首版用 `parent` 真值判断误把常驻 HUD 内容 widget（createHUD 也走 spawnUIActor 且传 parent=hud）一并失活 → 整个 HUD 不渲染（visibleMesh=0）。豁免判据用 `parent instanceof HUD`，**不能比对 `hud.uiActor` 引用**——createHUD 里 attachUI 在 spawnUIActor 之后调用，spawn 时点该字段尚未赋值。6) 旧"CDP 截图陈旧帧/帧饥饿"教训仍有效：断言用数值（fps/draw call/mesh 数），不用像素。
