---
name: engine_manual_component_not_registered
description: 引擎坑：手动 new Component(owner) 不进 Actor 组件表——getComponent 看不见、BeginPlay/Tick 永不驱动，惰性解析字段恒 null 致功能静默失效（CameraRig 右键平移实例）
type: project
prefix: [src/engine/rendering/CameraRigComponent.ts, src/engine/entity/AObjectComponent.ts]
scope: private
---

**Problem:** warm/hoi4/fish 云台右键拖拽平移 + 边缘平移在"玩家从未滚过滚轮"时**静默失效**（2026-09-13 e2e 实测：拖拽链路日志全通但相机零位移）；`ai.getComponent` 也查不到 CameraRigComponent。

**Cause:** `AObjectComponent` 基类构造只存 owner 引用、**不自动注册**进 Actor 组件表；`new CameraRigComponent(owner, name)` 这种手动挂载因此 `getComponent/getAllComponents` 不可见，World 的组件生命周期（BeginPlay/Tick 驱动）也永不触达它——`CameraRigComponent.BeginPlay` 里的 `resolveCamera()`（惰性解析同 Actor 相机）从不执行，`_camera` 恒 null。右键平移/边缘平移读裸字段 `this._camera?.camera` 直接空返回；唯独 `zoom()` 走了 `resolveCamera()`，所以滚过一次滚轮后所有功能"自愈"——静默依赖隐蔽初始化的典型。

**Solution:** 使用点惰性解析：`this._camera?.camera` 一律改为 `this.resolveCamera()?.camera`（2026-09-13 已修 CameraRigComponent 的 Tick 与 onRightPanMove 两处）。新增手动挂载组件时，凡 BeginPlay 依赖的初始化，要么 `actor.addComponent()` 正式注册，要么所有消费点走惰性解析，不要赌 BeginPlay 会跑。

**Applicable:** 引擎/项目所有"手动 new 组件"场景（CameraRig 三项目同款结构；任何 Component 子类）；排障特征：功能链路日志全通但效果为零 + getComponent 查不到该组件 → 先查组件是否注册、BeginPlay 是否真的执行过。
