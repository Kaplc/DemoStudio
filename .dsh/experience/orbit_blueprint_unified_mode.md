---
name: orbit_blueprint_unified_mode
task_type: feature/gameplay-ui
outcome: success
date: 2026-09-28
prefix: [projects/warm-current/gameplay/systems/OrbitBlueprintComponent.ts, projects/warm-current/gameplay/map/StarMapRenderComponent.ts, projects/warm-current/e2e/orbit_blueprint.spec.ts]
---
## Summary

warm-current「轨道蓝图台」：航线编辑合并建造+航线的统一全息俯视模式（轨道环吸附放置、真实转移轨道弧、KSP 式轨道编辑）；2026-09-29 收敛为纯地月系工作台（其他星球移除 → 太阳移除+地球冻结，取景中心=地球；月球本体可见+全息质感+网格空手态铺设修复），13 单测 + 3 e2e 全绿 + 文档同步。

## Lessons

1) 渲染层交互三处仲裁顺序是成败关键：onPointerDown 里"本体≤20px 取消选中 → 手柄(30px) → selectRefAt"——半径手柄悬在建筑位 +26px，30px 命中圈会吞掉点本体的取消手势，必须给本体留内圈；selectRefAt 必须把 linkable 建筑（relay）让给拖线（拖站=建航线是核心循环），轨道编辑选中走 noteDragClick（拖线原点点按仲裁，替代"站→自己"非法线报错）。2) 航线渲染 quad→弧 ribbon 的兼容关键：沿用 routeQuads 键空间（'id:0'）+ q.mesh 接口，applyViewMode/syncViewFilter 的可见性逻辑零改动；几何=BufferAttribute 逐帧重写 + frustumCulled=false。3) 2026-09-14 太阳系全景屏蔽是"入口屏蔽"不是"能力拆除"：蓝图台取景直接走 viewMode='solar'+applyViewMode+observeFocus(pitch88°)，别动旧屏蔽卫兵；90° 俯视与 up=(0,1,0) 共线会 lookAt 退化，用 88°。4) e2e 弧断言几何课见 memory:warm_orbit_blueprint_arc_invariant（径向共线退化 + 0.12×弦长不变量 + setShipFlying 钉船）；失败截图（read_image 读 test-failed-1.png）一眼定位"弧真是直的"，比看数字猜快得多。5) 失败先行：route_lane 第一版断言连挂两次才认清 phase-依赖——几何断言先推导不变量再写，别拿"某时刻的垂距"赌相位。6) 前端 overlay 调试可读 sm.provider/s sm.buildGroup 等私有字段（JS 反射），但 e2e 断言权威走 mode().blueprint 投影 getter；锁"星球/环显隐"这类渲染态可直接反射 starViews/planetOrbitRings/moonRings/sunGroup，与交互口径断言双保险。7) 2026-09-29 范围两步收敛（决策见 memory:warm_planets_removed_earth_moon_scope）：先其他星球退场、再太阳移除+地球冻结——"冻结恒星"的正确杠杆是 starPosAt 特判返回布局位（=初相位，t=0 连续、旧档瞬移无迁移），地月相对几何派生自 earth pos 故运输经济零变化；显示/吸附/命中/取景中心四处同源 BLUEPRINT_BODIES，改一处必查四处。教训：用户明确废弃的内容别自作主张设计"解锁门控"变相保全。8) 全仓 tsc 门禁被并行会话的半成品改动打红时的判定法：错误文件不在自己的改动集 + 上一次同门禁还是绿的 + 改动时间窗吻合 → 属并行工作区，报告不代修；自己的改动域用"tsc 输出除该错误外零行"背书（当轮对方随後自修，tsc 复零）。9) 网格暗坑：e2e 断言"容器组可见"绿 ≠ 内容存在——buildGroup.visible 常驻蓝 but gridLines 只在 placing 时 ensureGridCoverage 铺设，空手态组内无线条肉眼即"没网格"；断言渲染物要落到最终可见节点本体（gridLines.visible），模式切换类 visibleBodySet 收窄时同步排查"依赖该组的孩子"（本轮太阳组隐藏连坐风险就是靠这排查发现的）。10) 材质帧序权威：render() 里 syncBlueprint 晚于 syncNodes——蓝图态改 starViews 材质（全息半透明）放 syncBlueprint 才能赢下每帧写入，还原值须与 syncNodes 解锁口径一致。

## Effective Path

projects/warm-current/gameplay/systems/OrbitBlueprintComponent.ts || projects/warm-current/gameplay/map/StarMapRenderComponent.ts（syncRoutes ribbon 化 + syncBlueprint overlay + syncBuildMode 网格） || projects/warm-current/e2e/orbit_blueprint.spec.ts || projects/warm-current/e2e/route_lane.spec.ts（弧线口径） || projects/warm-current/gameplay/core/helpers.ts（starPosAt 地球冻结）
