---
name: warm_panel_close_camera_semantics
description: warm 面板关闭不重设相机取景的交互定案（2026-09-15）：关闭只清状态不飞镜头，closeHologram 已按此实现
type: project
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts]
---

# warm 面板关闭不重设相机取景（2026-09-15 用户定案）

规则：warm-current 任何面板**关闭**操作（全息面板 ✕ / Esc、互斥开新面板时的收口）一律保持玩家当前相机位置与姿态，不重新取景。`closeHologram` = `clearObserveState()`（清全息态 + 相机交互回落视图默认语义，不飞镜头）+ `applyZoomFloor(聚焦天体 r)` 回落缩放下限；**禁止** `focusSolarSystem`/`observeFocus` 重取景。

**Why:** 玩家在特写（环绕/缩放调出的地球/月球视角）里操作面板，关闭即被 `focusSolarSystem` 拉回 dist=3200 默认斜视取景，调好的视角丢失。用户原话："点击关闭不需要重新设置摄像机位置要保持原来的位置"。

**How to apply:** 新增面板/模式的退出链路照此口径——退出"面板"不动相机，只清状态字段与交互开关；只有显式"退出观察视角"（双击/Esc 退观察 `exitPlanetObserve`）才允许重新取景。e2e 锁法：同帧 before/close/after 相机 xyz 逐位一致（e2e/warm/hologram.spec.ts §4）。
