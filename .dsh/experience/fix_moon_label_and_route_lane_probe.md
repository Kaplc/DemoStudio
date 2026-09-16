---
name: fix_moon_label_and_route_lane_probe
task_type: debug/feature
outcome: success
date: 2026-09-17
prefix: [e2e/warm/route_lane.spec.ts, projects/warm-current/gameplay/map/StarMapRenderComponent.ts]
---
## Summary

移除月球头顶"满载 N/船"悬浮字（syncNodes 不写文本 + syncLabelLod 不点亮 + 删全息期隐藏旧补偿），顺带根因修复 route_lane 旧基线红（探针混用局部/世界坐标）。

## Lessons

1) 月球悬浮字下架（2026-09-19 用户定案，作废 2026-09-15"仅全息期间隐藏"）：三处要一起改——syncNodes 换 clear()、syncLabelLod 排除 moon（防 LOD 复活空文本 sprite，SpriteLabel.set('') 只置 visible=false 不清 mat.map，被外部置回 visible 会渲染已 dispose 贴图）、删 syncHologram 里旧隐藏块。2)【e2e 探针坐标系大坑】starViews[*].body 是蓝图 Actor 的 SphereMesh（Scene/MoonActor 链，世界坐标定位）；飞船/routeQuad 挂 systemGroup（map 空间，局部 z 与世界 z 差 ≈460）。探针比较必须双方都读 matrixWorld，混用 mesh.position vs matrixWorld 会凭空产出恒定 ≈460 的假偏轴。3) stepTicks 只推 manualTick（逻辑帧 dt=1/60s），render/syncShips/syncLabelLod 由 rAF 驱动——逻辑改完取证前必须等 2 个 rAF，否则读到上一帧渲染结果。4) 新船入列先 loading（B.loadSeconds=2s=120 tick 才起飞），断言"在航船"前先 stepTicks(160) 并过滤 state==='flying' 做前置断言。5) 已知基线红"航线偏移"（见 experience:warm_focus_orbit_camera 基线清单）已于 2026-09-19 根因修复，后续回归见到 route_lane 红是真回归，不要再对齐旧基线。

## Effective Path

projects/warm-current/gameplay/map/StarMapRenderComponent.ts || e2e/warm/route_lane.spec.ts || e2e/warm/moon_label.spec.ts
