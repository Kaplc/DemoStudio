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
| [`engine/ui_canvas_component.md`](./engine/ui_canvas_component.md) | CanvasUIComponent 组件：画布渲染 + hitTest 命中测试（visible/block/hitTestInvisible，拦截点击时查） |
| [`engine/muzzle_flash_component.md`](./engine/muzzle_flash_component.md) | MuzzleFlashComponent 组件（fish 项目）：炮口闪光特效（放大+淡出，组件内聚渲染，修改开炮特效时查） |
| [`engine/input_physics_script_system.md`](./engine/input_physics_script_system.md) | 输入 / 物理 / 脚本：InputSys / PhySys / ScriptRegistry |
| [`engine/asset_tools_system.md`](./engine/asset_tools_system.md) | 资产与工具：AssetRegistry / BlueprintRegistry / 配置表 / 存档 |
| [`engine/ai_system.md`](./engine/ai_system.md) | AI 事件系统：AIModule 事件总线（MCP 控制游戏） |
| [`engine/gm_system.md`](./engine/gm_system.md) | GM 命令系统：\*.gm.ts 自动注册 + 游戏内控制台 + AI 桥接（加调试命令时查） |

## 编辑器系统（src/editor/ + src/components/）

| 文件 | 说明 |
|------|------|
| [`editor/core_system.md`](./editor/core_system.md) | 编辑器核心：Editor / EditorInitializer / 事件总线 / 快捷键 |
| [`editor/viewport_system.md`](./editor/viewport_system.md) | 视口与场景：Scene 视口 / Game 视口 / 场景初始化 |
| [`editor/selection_transform_system.md`](./editor/selection_transform_system.md) | 选择与变换：SelectionManager / TransformGizmo / AnchorGizmo |
| [`editor/blueprint_edit_system.md`](./editor/blueprint_edit_system.md) | 蓝图编辑：BlueprintEditorService / blueprintOps / UndoManager |
| [`editor/property_edit_system.md`](./editor/property_edit_system.md) | 属性修改：Inspector 双通道编辑（EditableProperty / 蓝图资产 vs 运行时） |
| [`editor/asset_preview_lint_system.md`](./editor/asset_preview_lint_system.md) | 资产预览与检查：PreviewManagers / assetLint |
| [`editor/code_lint_system.md`](./editor/code_lint_system.md) | 代码扫描检查：CodeLintEngine / TS 源码规则检查器；右下角面板为代码+资产共用入口（加源码违规规则/查面板分节渲染时查） |
| [`editor/ui_components_system.md`](./editor/ui_components_system.md) | React 面板组件与状态管理（stores/） |

## 项目文档（src/projects/）

| 文件 | 说明 |
|------|------|
| [`projects/clash_master.md`](./projects/clash_master.md) | ClashMaster 项目（部落冲突风，原名 fish）：三阶段路由/表现层定制/GM 命令/调试桥（涉及 fish 项目文件时必读） |

## 专题文档

| 文件 | 说明 |
|------|------|
| [`playwright_testing.md`](./playwright_testing.md) | Playwright 浏览器测试流程：环境限制、通用操作（打开工程/启动/AI 事件驱动）与踩坑记录（涉及浏览器端测试时必读） |
| [`playwright_commands.md`](./playwright_commands.md) | Playwright 命令速查 + 踩坑（编辑器通用）：内置工具表 / 常用代码片段 / 调试桥 / 踩坑速查（浏览器调试时**必查**，遇新坑**必更新**） |
| [`level_system.md`](./level_system.md) | 关卡系统：HUD 双按钮 → 地图面板（关卡选择）→ 关卡切换 → 返回基地（涉及 fish 关卡/地图 UI 时必读） |
| [`battle_system.md`](./battle_system.md) | 攻打战斗系统：关卡战斗玩法（敌方基地/放兵/兵 AI/防御塔/血条/胜负结算/掠夺入账/调试桥）（涉及 fish 战斗玩法时必读） |
| [`ui_enhancement_system.md`](./ui_enhancement_system.md) | UI 增强系统：Tween 补间 / Toast 通知 / Tooltip / 色盲模式 / 输入提示 / 进度条 / 滚动列表 / 设计级 lint（涉及 UI 动效/通知/可读性/无障碍时必读） |
| [`undo_redo_system.md`](./undo_redo_system.md) | 蓝图编辑器撤销/重做系统设计（涉及蓝图编辑/UndoManager 时必读） |
| [`ui_anchor_system.md`](./ui_anchor_system.md) | UI 锚点系统：九宫格锚点布局算法 + AnchorGizmo 可视化编辑（涉及 UI 布局/锚点/拖拽时必读） |
| [`gameplay_code_standard.md`](./gameplay_code_standard.md) | **gameplay 代码规范**：GameMode / Controller / Pawn / GameState / 组件 / GameInstance / World 七类角色职责边界与越界红线（新增 gameplay 功能时必读，先归类再动手） |
| [`ursina_reference.md`](./ursina_reference.md) | Ursina 参考文档（涉及 API 兼容性设计时参考） |
| [`harness_system.md`](./harness_system.md) | **Harness 工程**：VS Code 扩展 + DSH 内核集成 + 引擎特化 agent 插件包（`harness/` 三分区，M0-M4 实施蓝图 + KernelAdapter/EngineBridge/SSE 设计；涉及 harness 任何模块时必读） |

