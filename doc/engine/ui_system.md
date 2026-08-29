# 世界 UI 系统（Engine UI）

> 世界内 UI：UIManager 统一管理 UI Actor 生成与 HUD 生命周期，独立于 3D Actor。
> 代码位置：`src/engine/ui/`
> 相关文档：[系统总览](../system_overview.md) / [渲染系统](./rendering_system.md) / [UI 锚点系统](../editor/ui_anchor_system.md)

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
| `CanvasUIComponent` | UI 画布根组件：Canvas 渲染 + 显隐控制 + 命中测试模式（详见 [组件文档](./ui_canvas_component.md)） |

## 3. 使用方法

### 3.1 入口 API

| 方法 | 签名 | 说明 |
|---|---|---|
| 动态生成 UI | `UIManager.spawnUIActor(path, parent?): Actor \| null` | 从蓝图实例化 UI Actor，挂到当前 HUD；生成逻辑自持，不依赖 `World.SpawnActorFromBlueprint` |
| 创建 HUD | `UIManager.createHUD(hudClass: string): HUD \| null` | 按 GameMode.HUDClass 创建容器 |
| 清空 | `UIManager.destroyAll()` | 销毁全部 UI Actor |
| 枚举 | `getAllUIActors(): Actor[]` | UI Actor 列表（UI 层归 uiScene，与 3D 分离） |

### 3.2 使用示例

```ts
// 动态生成 UI（挂到当前 HUD）
const panel = world.ui.spawnUIActor('asset/blueprints/ui/some_panel.blueprint.json')

// 场景切换时 HUD 重建（World 内部）
// SwitchScene: ui.destroyAll() → if (newMode.HUDClass) ui.createHUD(newMode.HUDClass)
```

### 3.3 触发时机与使用前提

- `spawnUIActor` 前需确保对应 widget/blueprint 资产已注册（BlueprintRegistry）
- UI 点击分流：`ClickableComponent.layer === 'ui'` 注册到 PhySys UI 层（UI 相机平行射线），UI 点击被消费后不再下发 Controller

## 4. 工作流程

### 4.1 职责划分

```
UIManager：UI 对象的"生成/挂载/清空"（完整蓝图解析与实例化）+ uiScene 持有与 Actor 归类
HUD：纯容器（Actor），承载 UI 树，不参与生成逻辑
World：3D Actor 生命周期管理，UI Actor 委托给 UIManager
```

### 4.2 场景切换时 HUD 重建

```
SwitchScene:
  ui.destroyAll()
  if (newMode.HUDClass) ui.createHUD(newMode.HUDClass)
```

### 4.3 UI 点击分流

- `ClickableComponent.layer === 'ui'` 时注册到 PhySys 的 UI 层注册表，使用 UI 相机平行射线检测
- UI 按钮点击在 `InputSys.handlePointerDown` 中被消费后不再下发到 Controller（避免同一击既触发按钮又触发放置逻辑）
- **点击拦截**：`CanvasUIComponent` 的 `hitTest:'block'` 画布（如模态遮罩/GM 控制台）命中射线即消费点击，挡住更低层级 UI/世界——遮挡竞争细节见 [CanvasUIComponent 组件文档](./ui_canvas_component.md)

### 4.4 UI Actor 锚点自动补挂

- `ensureTransformForActor(actor)`：有 CanvasUIComponent 的 Actor 自动挂 `UITransformComponent`（含锚点能力）；旧数据只有普通 TransformComponent 时自动替换，保证每个 UI Actor 都有锚点能力（详见 [UI 锚点系统](../editor/ui_anchor_system.md)）

## 5. 边界条件

| 条件 | 行为/后果 | 处理方式 |
|---|---|---|
| `spawnUIActor` 蓝图未注册 | 返回 null | 检查 BlueprintRegistry |
| UI 层点击 | 永远优先于 3D（`PhySys` UI 层先检测，命中即消费） | 引擎内置分流 |
| UI Actor 生命周期 | 独立于 `World.allActors`，由 UIManager 管理 | 勿直接 DestroyAllActors 清 UI |
| 场景切换 | `destroyAll` 先清空再重建 HUD | 引擎内置 |
| 无 HUDClass 的 GameMode | 切场景不创建 HUD | 按需在 GameMode 配置 |

## 6. 依赖关系

```
UIManager → BlueprintRegistry（蓝图解析）/ ActorRegistry / ComponentRegistry
UIManager → CanvasUIComponent（世界内 Canvas 渲染）/ UITransformComponent（布局）
UIScriptComponent → ScriptRegistry（脚本实例化）
```

## 7. 编辑器联动

- UI widget 资产（`.widget.json`）由 `UIPreviewManager` 预览（内置 World + UIManager 实例化）
- 游戏运行时 UI 节点选中/拖动使用 `AnchorGizmo`（锚点）与 `SelectionBoundsGizmo`（范围框）
- 详见 [资产预览系统](../editor/asset_preview_lint_system.md)、[选择与变换系统](../editor/selection_transform_system.md) 与 [UI 锚点系统](../editor/ui_anchor_system.md)
