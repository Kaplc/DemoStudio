# DemoStudio 文档目录

> 引擎与编辑器系统设计文档索引。AI 在处理相关任务时应先查阅对应文档。

## 总览

| 文件 | 说明 |
|------|------|
| [`system_overview.md`](./system_overview.md) | **系统总览**：引擎/编辑器/项目/资产类型全量统计与架构索引（改动前先查此文档定位子系统） |

## 引擎系统（`engine/` — src/engine/）

| 文件 | 说明 |
|------|------|
| [`engine/entity_system.md`](./engine/entity_system.md) | 实体体系：OObject → AObject → BObject → Actor 层级 + 组件系统 |
| [`engine/gameflow_system.md`](./engine/gameflow_system.md) | 游戏流程：Game / GameInstance / GameMode / GameState / World |
| [`engine/rendering_system.md`](./engine/rendering_system.md) | 渲染系统：相机族 / 渲染组件 / Compositor2D / 纹理 |
| [`engine/ui_system.md`](./engine/ui_system.md) | 世界 UI：UIManager / HUD / UI 控件组件 |
| [`engine/ui_canvas_component.md`](./engine/ui_canvas_component.md) | CanvasUIComponent 组件：画布渲染 + hitTest 命中测试 |
| [`engine/muzzle_flash_component.md`](./engine/muzzle_flash_component.md) | MuzzleFlashComponent 组件（fish 项目）：炮口闪光特效 |
| [`engine/input_physics_script_system.md`](./engine/input_physics_script_system.md) | 输入 / 物理 / 脚本：InputSys / PhySys / ScriptRegistry |
| [`engine/asset_tools_system.md`](./engine/asset_tools_system.md) | 资产与工具：AssetRegistry / BlueprintRegistry / 配置表 / 存档 |
| [`engine/ai_system.md`](./engine/ai_system.md) | AI 事件系统：AIModule 事件总线（MCP 控制游戏） |
| [`engine/gm_system.md`](./engine/gm_system.md) | GM 命令系统：\*.gm.ts 自动注册 + 游戏内控制台 |
| [`engine/navigation_system.md`](./engine/navigation_system.md) | 导航系统 |
| [`engine/ursina_reference.md`](./engine/ursina_reference.md) | Ursina 参考文档（涉及 API 兼容性设计时参考） |

## 编辑器系统（`editor/` — src/editor/ + src/components/）

| 文件 | 说明 |
|------|------|
| [`editor/core_system.md`](./editor/core_system.md) | 编辑器核心：Editor / EditorInitializer / 事件总线 / 快捷键 |
| [`editor/viewport_system.md`](./editor/viewport_system.md) | 视口与场景：Scene 视口 / Game 视口 / 场景初始化 |
| [`editor/selection_transform_system.md`](./editor/selection_transform_system.md) | 选择与变换：SelectionManager / TransformGizmo / AnchorGizmo |
| [`editor/blueprint_edit_system.md`](./editor/blueprint_edit_system.md) | 蓝图编辑：BlueprintEditorService / blueprintOps / UndoManager |
| [`editor/undo_redo_system.md`](./editor/undo_redo_system.md) | 蓝图编辑器撤销/重做系统设计 |
| [`editor/property_edit_system.md`](./editor/property_edit_system.md) | 属性修改：Inspector 双通道编辑 |
| [`editor/asset_preview_lint_system.md`](./editor/asset_preview_lint_system.md) | 资产预览与检查：PreviewManagers / assetLint |
| [`editor/code_lint_system.md`](./editor/code_lint_system.md) | 代码扫描检查：CodeLintEngine / TS 源码规则检查器 |
| [`editor/ui_components_system.md`](./editor/ui_components_system.md) | React 面板组件与状态管理（stores/） |
| [`editor/ui_enhancement_system.md`](./editor/ui_enhancement_system.md) | UI 增强系统：Tween 补间 / Toast / Tooltip / 色盲模式 / 进度条 |
| [`editor/ui_anchor_system.md`](./editor/ui_anchor_system.md) | UI 锚点系统：九宫格锚点布局算法 + AnchorGizmo 可视化编辑 |
| [`editor/mcp_integration.md`](./editor/mcp_integration.md) | MCP 集成与调试桥：三客户端配置 / 9 个工具清单 / 多实例端口 |
| [`editor/agent_panel_system.md`](./editor/agent_panel_system.md) | Agent 面板与事件流：连接状态机 / 双通道事件 / 会话恢复 |

## 项目文档（`projects/` — src/projects/）

| 文件 | 说明 |
|------|------|
| [`projects/clash_master.md`](./projects/clash_master.md) | ClashMaster 项目（部落冲突风，原名 fish）：三阶段路由 / 表现层定制 / GM 命令 |
| [`projects/level_system.md`](./projects/level_system.md) | 关卡系统：HUD 双按钮 → 地图面板 → 关卡切换 → 返回基地 |
| [`projects/battle_system.md`](./projects/battle_system.md) | 攻打战斗系统：敌方基地 / 放兵 / 兵 AI / 防御塔 / 胜负结算 |
| [`projects/gameplay_code_standard.md`](./projects/gameplay_code_standard.md) | gameplay 代码规范：七角色职责边界与越界红线 |

## Harness（`harness/` — DSH 内核集成）

| 文件 | 说明 |
|------|------|
| [`harness/harness_system.md`](./harness/harness_system.md) | **Harness 工程**：VS Code 扩展 + DSH 内核集成 + 引擎 agent 插件包 |
| [`harness/dsh_engine_integration.md`](./harness/dsh_engine_integration.md) | **DSH 与引擎集成架构**：agent 常驻化 / watchdog / 崩溃自愈 / 会话恢复 |
| [`harness/dsh_vscode_demostudio_prd.md`](./harness/dsh_vscode_demostudio_prd.md) | DSH VS Code DemoStudio PRD |
| [`harness/preset-sync-mechanism.md`](./harness/preset-sync-mechanism.md) | Preset 同步机制 |
| [`harness/slash_command_system.md`](./harness/slash_command_system.md) | 斜杠命令系统：触发检测 / 命令注册 / DSH 集成 |

## 测试（`testing/` — Playwright 调试与测试）

| 文件 | 说明 |
|------|------|
| [`testing/playwright_testing.md`](./testing/playwright_testing.md) | Playwright 浏览器测试流程：环境限制、通用操作与踩坑记录 |
| [`testing/playwright_commands.md`](./testing/playwright_commands.md) | Playwright 命令速查 + 踩坑（VS Code 内置浏览器） |
| [`testing/playwright_mcp_commands.md`](./testing/playwright_mcp_commands.md) | Playwright MCP 调试（本地 Chrome，CDP :9222） |

