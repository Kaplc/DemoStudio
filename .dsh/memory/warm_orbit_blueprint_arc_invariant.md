---
name: warm_orbit_blueprint_arc_invariant
description: 转移轨道弧在端点-主天体径向共线时视觉退化为直弦（phase-依赖），可断言的不变量是"弧中点比弦中点远离主天体 0.12×弦长"；蓝图台是 2026-09-14 视角锁定后唯一合法太阳系全景入口
type: project
prefix: [projects/warm-current/gameplay/core/helpers.ts, projects/warm-current/e2e/route_lane.spec.ts, projects/warm-current/gameplay/systems/OrbitBlueprintComponent.ts]
---

**Problem:** e2e 断言"飞船/弧中点偏离月→地直弦 > N px"连续两轮拿到 0：游戏画面里弧线就是直的（截图实证），但 orbit_blueprint 同类断言却绿。

**Cause:** 转移弧控制点 = 弦中点沿「中点−主天体」方向外推 0.24×弦长（helpers.transferArcControl）。新局月球初相位恰好在地月径向上（moonRelativeAngle(0)=0），「背向主天体」方向与弦共线 → 弧几何上正确地退化为直弦（径向转移在圆轨理想化里就是直线）；偏移量的垂直分量 ∝ sin(相位角偏差)，初局 ≈0，相位一变断言就翻——纯 phase-依赖断言。

**Solution:** 断言相位无关不变量：`|弧中点−主天体| − |弦中点−主天体| = 0.5 × BEND × 弦长`（offset 平行于径向，代数恒等，≈144px@月球线）——永远成立且只在"有弧"时成立（直弦旧实现为 0）。另：飞船位置断言用 `setShipFlying(0.5)` 钉船（月球线 leg 仅 6s，锁步船对 tick 数超敏感，stepTicks 赌步数必翻车）。

**Applicable:** warm 转移弧（core/helpers.ts transferArc*）的一切几何断言；2026-09-29 起轨道蓝图台（routeEditMode）是 2026-09-14「锁定地球视角」后唯一合法的太阳系全景入口（ViewDirector.enterBlueprintView，88° 俯视——90° 会与 up=(0,1,0) 平行使 lookAt 退化），旧"全景已屏蔽"类记忆/断言对此入口例外。
