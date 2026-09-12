---
name: blueprint_save_dumps_runtime_components
description: 踩坑：蓝图编辑器保存会把运行时挂载组件随 persistentProps 全量写回资产，与运行时再挂载撞成重复实例（prefix: src/editor || projects/warm-current）
type: project
prefix: [projects/warm-current/asset/blueprints/stars/earth.blueprint.json, src/editor/Editor.ts]
---

**Problem:** 用户在蓝图预览编辑任意属性并保存后，运行时才挂载的组件（如 setupCloseup 里 addComponent 的大气）被整块写进资产 JSON；下次生成时蓝图实例 + 运行时再挂载各一份 → 重复实例、表现叠光、AObject 同名组件告警。

**Cause:** 蓝图通道提交是全量的：Inspector commit 会把同 actor 全部兄弟组件的 `getPersistentProps()`（默认遍历全部可编辑属性）一起 applyBatch；Ctrl+S 的 `collectSaveData()` 也遍历运行时全量组件表。两条路都无法区分"资产声明的组件"和"运行时挂载的组件"。

**Solution:** 定位"某组件为何在资产里/为何双份"时，先查它是否由运行时代码挂载（如 warm 星图的 setupCloseup）；处理方式二选一——把组件声明移入资产并删运行时挂载（大气即此解，见 warm_atmosphere_asset_mounted），或组件标记 runtimeAttached 并在 collectSaveData/applyBatch 过滤（引擎尚无此机制，2026-09-10 状态）。预防：e2e 对易撞车组件断言实例数恰好为 1。

**Applicable:** warm 星图天体（StarActor.setupCloseup）、fish 等任何"蓝图 + BeginPlay 运行时装配"混用的项目；动 `BlueprintEditorService.applyBatch` 兄弟组件全量提交、`collectSaveData` 保存链路前先想起这条。

