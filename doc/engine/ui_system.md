# 世界 UI 系统（Engine UI）

> 世界内 UI：UIManager 统一管理 UI Actor 生成与 HUD 生命周期，独立于 3D Actor。
> 代码位置：`src/engine/ui/`
> 相关文档：[系统总览](../system_overview.md) / [渲染系统](./rendering_system.md)

## 1. 概述

UI 系统模仿 UE 的 HUD 机制：

- `UIManager`：世界 UI 统一管理器（由 World 持有），负责 UI Actor 生成、HUD 创建/销毁、UI 场景（uiScene）持有
- `HUD`：纯容器 Actor，承载 UI 树，不参与生成逻辑
- UI 控件组件：文本/图片/按钮/布局/脚本
- UI 生命周期独立于 3D Actor（不受 `World.allActors` 管控）

## 2. 核心类

| 类 | 说明 |
|---|---|
| `UIManager` | UI 统一管理器：`spawnUIActor(blueprintPath)` 从蓝图实例化 UI Actor；`createHUD(HUDClass)` / `destroyAll()`；独立管理 UI Actor 生命周期；持有 UI 独立场景 `uiScene` |
| `HUD` | 纯容器 Actor，承载 UI 树（对应 UE `GameMode.HUDClass`） |
| `UITransformComponent` | UI 布局变换：anchors / pivot / offset 屏幕空间布局 |
| `UITextComponent` | UI 文本控件 |
| `UIImageComponent` | UI 图片控件 |
| `UIButtonComponent` | UI 按钮控件 |
| `UILayoutComponent` | UI 布局组件 |
| `UIScriptComponent` | UI 挂载脚本组件（BeginPlay 时按资产 `script` id 实例化 BehaviourScript） |

## 3. 职责划分

```
UIManager：UI 对象的"生成/挂载/清空"（完整蓝图解析与实例化）+ uiScene 持有与 Actor 归类
HUD：纯容器（Actor），承载 UI 树，不参与生成逻辑
World：3D Actor 生命周期管理，UI Actor 委托给 UIManager
```

## 4. 关键流程

### 4.1 场景切换时 HUD 重建（World 内部）

```
SwitchScene:
  ui.destroyAll()
  if (newMode.HUDClass) ui.createHUD(newMode.HUDClass)
```

### 4.2 动态生成 UI（挂到当前 HUD）

```ts
const panel = world.ui.spawnUIActor('asset/blueprints/ui/some_panel.blueprint.json')
```

- 生成逻辑自持，不依赖 `World.SpawnActorFromBlueprint`
- UI Actor 归类到 `uiScene`，与 3D 场景分离

### 4.3 UI 点击分流

- `ClickableComponent.layer === 'ui'` 时注册到 PhySys 的 UI 层注册表，使用 UI 相机平行射线检测
- UI 按钮点击在 `InputSys.handlePointerDown` 中被消费后不再下发到 Controller（避免同一击既触发按钮又触发放置逻辑）

## 5. 依赖关系

```
UIManager → BlueprintRegistry（蓝图解析）/ ActorRegistry / ComponentRegistry
UIManager → CanvasUIComponent（世界内 Canvas 渲染）/ UITransformComponent（布局）
UIScriptComponent → ScriptRegistry（脚本实例化）
```

## 6. 编辑器联动

- UI widget 资产（`.widget.json`）由 `UIPreviewManager` 预览（内置 World + UIManager 实例化）
- 游戏运行时 UI 节点选中/拖动使用 `AnchorGizmo`（锚点）与 `SelectionBoundsGizmo`（范围框）
- 详见 [资产预览系统](../editor/asset_preview_system.md)、[选择与变换系统](../editor/selection_transform_system.md) 与 [UI 锚点系统](../ui_anchor_system.md)
