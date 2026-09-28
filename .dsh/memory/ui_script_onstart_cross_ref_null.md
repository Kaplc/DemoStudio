---
name: ui_script_onstart_cross_ref_null
description: UI 脚本跨 widget 引用不能在 onStart 互传：spawn 只入队、BeginPlay 下一帧才实例化脚本，instance 必为 null；消费方运行时惰性自查兄弟 widget
type: project
prefix: [src/engine/ui/UIManager.ts, src/engine/ui/UIScriptComponent.ts, projects/warm-current/gameplay/ui/HudScript.script.ts]
---

**Problem:** warm 编辑台 HUD（EditHudScript）要开合建造面板（BuildPanelScript）。首版在 HudScript.onStart 里 spawn edit_hud 后立刻 `getComponent(UIScriptComponent)?.instance` 做 instanceof 接线 `bindBuildPanel()`，运行时点「建造选型」无任何效果（e2e 断言面板收不起来），且 warn 分支静默吞掉。

**Cause:** `UIManager.spawnUIActor` 只把 actor 入队 `_pendingSpawn`；`BeginPlay` 要到下一帧 `tickUI → commitSpawn` 才派发。而 `UIScriptComponent.BeginPlay` 才创建脚本实例（`instance` 字段）并跑 onStart。所以在任何脚本的 onStart 时点，同帧 spawn 的兄弟 widget 的 `instance` 必为 null——instanceof 检查失败，注入从未发生。

**Solution:** UI 脚本跨 widget 引用**不在 onStart 互传**；消费方运行时惰性自查——EditHudScript.panelScript() 沿 `this.actor.parent`（HUD Actor）遍历兄弟 widget 找 `instanceof BuildPanelScript`（点击回调/8Hz tick 时实例必已就绪），零时序假设，还省掉 HudScript 侧接线代码。若确需推送注入，用 getter 闭包（`() => this.buildPanel`）推迟到消费时求值。

**Applicable:** 一切"widget A 脚本要操控 widget B 脚本"的场景（warm/hoi4/fish 共用同一 UIManager/UIScriptComponent 机制）；症状易误判为"按钮没绑上/onClick 丢失"，先查 spawn→BeginPlay 时序再查绑定。
