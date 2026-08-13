# 选择与变换系统（Editor Selection & Transform）

> 场景对象选择管理 + 三套 Gizmo 交互工具。
> 代码位置：`src/editor/SelectionManager.ts` `TransformGizmo.ts` `AnchorGizmo.ts` `SelectionBoundsGizmo.ts`
> 相关文档：[系统总览](../system_overview.md) / [视口与场景](./viewport_system.md)

## 1. 概述

选择与变换系统负责编辑器交互核心：

- **选择管理**：模块级引用 + 递增 key 驱动 React 重渲染；Outline 选中 → Inspector 展示
- **TransformGizmo**：3D 场景三轴移动工具（对标 Unity Position Gizmo）
- **AnchorGizmo**：游戏运行时 UI 节点锚点工具（父容器范围 + 锚点图标）
- **SelectionBoundsGizmo**：游戏运行时 UI 节点范围框（青色框 + 把手 + 尺寸标签）

## 2. 核心模块

### SelectionManager

| 能力 | 说明 |
|---|---|
| `select(actor)` | 选中对象（emit `SELECTION_CHANGED` 事件） |
| `getSceneTree()` | 遍历场景对象生成大纲树（`SceneTreeNode`） |
| `notifySelectionChange()` | 通知选择变化（桥接到 editorStore.nonce） |
| 单例 Gizmo 访问器 | `getTransformGizmo()` / `getAnchorGizmo()` / `getSelectionBoundsGizmo()` |

### TransformGizmo（3D 场景）

- 选中对象中心显示三轴箭头（X=红 `0xff4444` / Y=绿 `0x44ff44` / Z=蓝 `0x4488ff`）
- 交互流程：
  ```
  1. 鼠标按下 → Raycaster 检测命中箭头
  2. 命中 → 开始拖拽，临时冻结 Scene 摄像机输入
  3. 鼠标移动 → 运动投影到拖拽轴，更新目标位置
  4. 鼠标释放 → 结束拖拽，恢复摄像机输入
  ```
- 支持 hover 高亮（记录 baseColor 恢复 emissive）

### AnchorGizmo（运行时 UI 节点）

- 显示父容器范围 + 锚点图标（单点锚风车形聚合 / stretch 四角分布）
- 用于游戏运行时 UI 节点的锚点调整
- 布局算法、拖动回写与 Inspector 编辑详见 [UI 锚点系统](../ui_anchor_system.md)

### SelectionBoundsGizmo（运行时 UI 节点）

- 青色范围框 + 8 个把手（0-3 角 TL/TR/BL/BR，4-7 边 T/R/B/L）
- 把手悬停光标切换（`nwse-resize` / `ns-resize` / `ew-resize` 等）
- 尺寸标签显示

## 3. 事件与桥接

```
select(actor) / gizmo 拖拽
  → editorBus.emit(EditorEvent.SELECTION_CHANGED / BLUEPRINT_TRANSFORM_DIRTY)
  → installEventBridge → editorStore（bumpSelectionNonce / markBlueprintDirty）
  → React 组件（Inspector / Outline / UiOutline）重渲染
```

- 蓝图编辑中 gizmo 拖拽会标记蓝图 dirty（`BLUEPRINT_TRANSFORM_DIRTY`），保存后 `BLUEPRINT_SAVED` 清 dirty
- AI 处理器 `ai.selectActor` / `ai.dragActor` 复用此系统（见 [AI 事件系统](../engine/ai_system.md)）

## 4. 依赖关系

```
SelectionManager → TransformGizmo / AnchorGizmo / SelectionBoundsGizmo
SelectionManager → gizmos（引擎辅助对象）/ editorBus
Gizmo 场景 → overlayScene（编辑器覆盖层，渲染顺序最顶层）
BlueprintEditorService → 拖拽结果以 op 写入蓝图（apply）
```
