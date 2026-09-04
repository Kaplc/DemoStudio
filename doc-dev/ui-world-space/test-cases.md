# 验收用例：3D 场景 UI（World-Space UI）

> 关联：[plan.md](./plan.md)。状态标记：⬜ 未实施 / ✅ 通过 / ⏭ 阶段未到暂 skip。

## P0 前置

- **TC-W0.1 projectToUi 基础投影** ✅
  操作：已知相机位姿 + 世界点，调 `UICamera.projectToUi`。
  断言：屏幕正中世界点 → `[960, 540]`；NDC 换算与手算一致；返回 px 为数值（非米）。
  验证：`tests/uiWorldSpace.test.ts`（引擎侧单测，28 用例含本组）。
- **TC-W0.2 背面剔除** ✅
  操作：世界点置于相机背后。
  断言：`projectToUi` 返回 null（不产生镜像坐标）。
  验证：同上。
- **TC-W0.3 LootFlyFx 残留清理** ✅
  断言：`LootFlyFx` 不再私有定义半画布常数（4.8/2.7 零命中），改用 `projectToUi`，掉落飞字表现不回归。
  验证：`tests/uiUnitUnification.test.ts` 6/6 绿 + 源码 grep 零命中。

## P1 screen 跟随

- **TC-W1.1 锚定跟随** ✅
  操作：`spawnAnchoredWidget(血条, target=单位A, offset=[0,2.2,0])`；移动单位 A 与相机。
  断言：每帧根 UITransform position == `projectToUi(锚点世界坐标)`；相机/实体静止时 position 稳定不抖。
  验证：`tests/uiWorldSpace.test.ts`。
- **TC-W1.2 恒定屏占** ✅
  操作：`constantScreenSize=true`，相机从 5m 退到 20m。
  断言：widget 屏幕像素尺寸不变；`constantScreenSize=false` 时尺寸随距离反比缩放。
  验证：同上（距离 10→20 scale 减半）。
- **TC-W1.3 出屏钳制** ✅
  操作：`clamping='clamp'`，锚点移出视口。
  断言：widget 钳在安全区边距（5% 内缩）处，不出屏。
  验证：同上。
- **TC-W1.4 背后隐藏** ✅
  操作：相机转过身，锚点落在相机背后。
  断言：widget 不可见（projectToUi null → 整树 `CanvasUIComponent.active=false` 或等效隐藏）。
  验证：同上。
- **TC-W1.5 输入兼容** ⏭
  操作：点击跟随 widget 上的按钮。
  断言：UI 层平行射线命中（现状链路），点击被消费不下发世界层。
  说明：需浏览器/e2e 实测（jsdom 无真实 hit-test 管线），随编辑器 e2e 阶段补。
- **TC-W1.6 伤害数字 showAtWorld** ✅
  操作：`DamageNumberFx.showAtWorld(world, worldPos, 42)` 连发 20 个。
  断言：数字从世界锚点上浮淡出；池化复用（spawn 计数不超池容量）；同屏超上限时聚合/淘汰。
  验证：`tests/uiWorldSpace.test.ts`（连发 8 个断言 spawn 上限 + 入队/补放）。
- **TC-W1.7 生命周期** ✅
  操作：`release()` 句柄 / target 单位被销毁。
  断言：widget 销毁或进入预期淘汰策略；`destroyAll`（切场景）后无悬挂 Actor。
  验证：`tests/uiWorldSpace.test.ts`（target 销毁 → 两帧 tick 内联动销毁）。

## P2 world 面板

- **TC-W2.1 场景分流** ✅
  操作：spawn `mode='world'` 的全息面板 widget。
  断言：Actor 由 UIManager 管理生命周期、mesh 挂主场景（在 `world.scene` 而非 `world.ui.scene`）；透视/近大远小正确。
  验证：`tests/uiWorldSpace.test.ts`。
- **TC-W2.2 尺寸换算** ✅
  操作：根画布 960×540、`pxPerMeter=200`。
  断言：面板世界尺寸 4.8×2.7m；`pixelDensity=2` 时 canvas 纹理实际 1920×1080、世界尺寸不变、近景文字/圆角不糊。
  验证：`tests/uiWorldSpace.test.ts`（含 resizeCanvas 纹理分辨率断言）。
- **TC-W2.3 深度遮挡** ⏭
  操作：面板与相机之间放一个立方体。
  断言：面板被立方体遮挡（与 uiScene 永浮顶形成对照）。
  说明：主场景渲染天然行为，需真实渲染管线（浏览器/e2e）确认，随 e2e 阶段补。
- **TC-W2.4 billboard** ✅
  操作：`faceCamera=true`，环绕相机。
  断言：面板始终正对相机；子元素布局不随朝向畸变；`faceCamera=false` 时朝向固定可绕到背后。
  验证：`tests/uiWorldSpace.test.ts`（quaternion 对齐相机）。
- **TC-W2.5 world 点击与竞争** ⏭
  操作：点击面板上的 UIButton；面板与一个 3D 物体重叠时分别置前/置后再点。
  断言：clickable 已切 `layer='world'`，主相机射线命中按钮回调；距离最近者胜（面板在前则点中面板，在后则点中物体）；纯展示面板不拦截身后点击。
  验证：切层逻辑引擎单测已覆盖（switchClickablesToWorld）；射线竞争需 e2e 实测。
- **TC-W2.6 树内 zOrder** ✅
  断言：面板内部 zOrder 语义与 uiScene 一致（文字盖同层图片，+0.0002 规则不变）。
  验证：CanvasUIComponent zOrder 规则未改动，回归由既有单测覆盖。

## P3 打磨与编辑器

- **TC-W3.1 occlusion fade** ⏭
  操作：`occlusion='fade'`，墙体挡住锚点。
  断言：~150ms 内 opacity→0.35，移开恢复；raycast 节流（帧耗时无尖峰）。
  说明：阶段未到（plan P3 可选项），暂 skip。
- **TC-W3.2 off-screen indicator** ⏭
  操作：`clamping='indicator'`，目标出屏。
  断言：屏幕边缘出现指示（含方向箭头），出屏目标可回溯。
  说明：阶段未到，暂 skip。
- **TC-W3.3 距离 LOD / 同屏上限** ⏭
  操作：`maxDistance` 外/超上限的锚定 widget。
  断言：按距离与优先级隐藏/淘汰，无渲染残留。
  说明：阶段未到，暂 skip。
- **TC-W3.4 场景编辑器选中** ⏭
  操作：场景视口点选 world 模式 widget。
  断言：进大纲树、SelectionBoundsGizmo 正确包裹；拖动 gizmo 改世界位姿不破坏 pxPerMeter 比例。
  说明：编辑器侧集成，阶段未到，暂 skip。
- **TC-W3.5 assetLint** ✅
  断言：world 模式根带 `anchor` → warn；screen 模式根非 `anchor:null` → warn；正常资产零 lint 错误。
  验证：`ui:world-anchor-conflict` 规则（uiDesignChecker.ts）+ `comp:UIWorldAnchorComponent` schema（componentChecker.ts）；base_hologram.widget.json 经 ui_compile 零 error 零 warn（2026-09-04 实测）。
