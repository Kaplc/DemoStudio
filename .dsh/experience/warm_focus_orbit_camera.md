---
name: warm_focus_orbit_camera
task_type: feature/gameplay-camera
outcome: success
date: 2026-09-15
prefix: [projects/warm-current/gameplay/base/WarmCurrentGameMode.ts, src/engine/rendering/CameraRigComponent.ts, projects/warm-current/WarmCurrentGameInstance.ts, e2e/warm/focus_orbit.spec.ts, projects/warm-current/gameplay/map/SolarCameraActor.ts]
---
## Summary

warm 行星系聚焦环绕改版：聚焦天体默认右键环绕（关平移/边缘平移、左键留地图交互）+ 双击月球聚焦（环绕+逐帧跟随公转）+ 双击/Esc/切聚焦全链路，引擎 CameraRigComponent 加 leftOrbitEnabled 开关；受影响 e2e 11 用例全绿，全量 35 绿 8 红（全部为既有基线/工坊域陈旧红）。

## Lessons

1) 设计落点：引擎 orbitMode 拆出 leftOrbitEnabled（默认 true，hoi4/fish/观察态零影响）；GameMode 单点 applyFocusCameraMode 在 focusSolarSystem 尾部收口（clearObserveState 回落"视图默认语义"而非旧 free-pan）；卫星聚焦 = observeBody 放宽 MoonId + Tick 逐帧 rig.pan 跟随（与全息 holoLastTarget 同口径，pan 成对平移 target+相机保环绕几何）；双击链路统一 bodyAt（planetAt 死代码删除，单击 fall-through 保拖线/信息面板）。2) 左键环绕必须与右键拆分：聚焦默认视角左键留地图交互（耀斑框选/拖线），否则 orbitMode 会吞框选——这是不加开关直接开 orbitMode 的隐藏回归。3) 验证顺序有效：受影响 spec 先行（5 spec 11 用例全绿）再全量回归；8 红全部对齐 experience:fix_inspector_getproperties_key_case 的基线清单（点击冷却×2/二级按钮/航线偏移/存档桥×2）+ 工坊域 2（payload/ship_design 断言随配置表演进陈旧，与 vitest 11 红同源）——对照清单判定勿误修。4)【本session最大坑】基线对照用 git stash pathspec 差点毁工作区：快照陈旧 + pop 报 kept，规则见 memory:git_stash_pathspec_stale_snapshot_pitfall；stash 往返还会二次抹 BOM（WarmCurrentGameMode 补了两次）。5) e2e 细节：distMoon 断言必须用含 y 的 3D 球心距离（35° 俯角 + 球心 y=r×0.55，2D 水平距离 ≈65 会踩 70 下限）；拖拽后轮询相机停稳（headless stepDelay 节流 1s/步）；5173 被并行 vite 占（IPv6）→ 自起 dev 落 5174 + E2E_BASE_URL（已知坑）。

## Effective Path

projects/warm-current/gameplay/base/WarmCurrentGameMode.ts（applyFocusCameraMode/enterMoonObserve/Tick 跟随块） || src/engine/rendering/CameraRigComponent.ts（leftOrbitEnabled） || e2e/warm/focus_orbit.spec.ts
