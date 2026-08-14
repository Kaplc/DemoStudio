# DemoStudio 文档目录

> 引擎与编辑器系统设计文档索引。AI 在处理相关任务时应先查阅对应文档。

## 总览

| 文件 | 说明 |
|------|------|
| [`system_overview.md`](./system_overview.md) | **系统总览**：引擎/编辑器/项目/资产类型全量统计与架构索引（改动前先查此文档定位子系统） |

## 引擎系统（src/engine/）

| 文件 | 说明 |
|------|------|
| [`engine/entity_system.md`](./engine/entity_system.md) | 实体体系：OObject → AObject → BObject → Actor 层级 + 组件系统 |
| [`engine/gameflow_system.md`](./engine/gameflow_system.md) | 游戏流程：Game / GameInstance / GameMode / GameState / World |
| [`engine/rendering_system.md`](./engine/rendering_system.md) | 渲染系统：相机族 / 渲染组件 / Compositor2D / 纹理 |
| [`engine/ui_system.md`](./engine/ui_system.md) | 世界 UI：UIManager / HUD / UI 控件组件 |
| [`engine/input_physics_script_system.md`](./engine/input_physics_script_system.md) | 输入 / 物理 / 脚本：InputSys / PhySys / ScriptRegistry |
| [`engine/asset_tools_system.md`](./engine/asset_tools_system.md) | 资产与工具：AssetRegistry / BlueprintRegistry / 配置表 / 存档 |
| [`engine/ai_system.md`](./engine/ai_system.md) | AI 事件系统：AIModule 事件总线（MCP 控制游戏） |

## 编辑器系统（src/editor/ + src/components/）

| 文件 | 说明 |
|------|------|
| [`editor/core_system.md`](./editor/core_system.md) | 编辑器核心：Editor / EditorInitializer / 事件总线 / 快捷键 |
| [`editor/viewport_system.md`](./editor/viewport_system.md) | 视口与场景：Scene 视口 / Game 视口 / 场景初始化 |
| [`editor/selection_transform_system.md`](./editor/selection_transform_system.md) | 选择与变换：SelectionManager / TransformGizmo / AnchorGizmo |
| [`editor/blueprint_edit_system.md`](./editor/blueprint_edit_system.md) | 蓝图编辑：BlueprintEditorService / blueprintOps / UndoManager |
| [`editor/property_edit_system.md`](./editor/property_edit_system.md) | 属性修改：Inspector 双通道编辑（EditableProperty / 蓝图资产 vs 运行时） |
| [`editor/asset_preview_lint_system.md`](./editor/asset_preview_lint_system.md) | 资产预览与检查：PreviewManagers / assetLint |
| [`editor/ui_components_system.md`](./editor/ui_components_system.md) | React 面板组件与状态管理（stores/） |

## 专题文档

| 文件 | 说明 |
|------|------|
| [`playwright_testing.md`](./playwright_testing.md) | Playwright 浏览器测试流程：环境限制、通用操作（打开工程/启动/AI 事件驱动）与踩坑记录（涉及浏览器端测试时必读） |
| [`level_system.md`](./level_system.md) | 关卡系统：HUD 双按钮 → 地图面板（关卡选择）→ 空壳关卡 → Esc 暂停菜单 → 返回基地（涉及 fish 关卡/地图 UI 时必读） |
| [`ui_enhancement_system.md`](./ui_enhancement_system.md) | UI 增强系统：Tween 补间 / Toast 通知 / Tooltip / 安全区 / 色盲模式 / 输入提示 / 进度条 / 滚动列表 / 设计级 lint（涉及 UI 动效/通知/可读性/无障碍时必读） |
| [`undo_redo_system.md`](./undo_redo_system.md) | 蓝图编辑器撤销/重做系统设计（涉及蓝图编辑/UndoManager 时必读） |
| [`ui_anchor_system.md`](./ui_anchor_system.md) | UI 锚点系统：九宫格锚点布局算法 + AnchorGizmo 可视化编辑（涉及 UI 布局/锚点/拖拽时必读） |
| [`ursina_reference.md`](./ursina_reference.md) | Ursina 参考文档（涉及 API 兼容性设计时参考） |

