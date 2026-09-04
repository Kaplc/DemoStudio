# DemoStudio 文档目录

> 引擎与编辑器系统设计文档索引，**按模块划分**：每个模块一节，模块内列出该模块的功能文档。
> 改动前先查 [`system_overview.md`](./system_overview.md) 定位子系统，再进入对应模块文档。

## 高频入口

| 场景 | 文档 |
|---|---|
| 改引擎/编辑器前定位子系统 | [`system_overview.md`](./system_overview.md) |
| 蓝图编辑 / 撤销重做 | [`editor/blueprint/undo_redo_system.md`](./editor/blueprint/undo_redo_system.md) |
| API 兼容性设计 | [`engine/ursina_reference.md`](./engine/ursina_reference.md) |
| gameplay 代码规范（七角色红线） | [`projects/gameplay_code_standard.md`](./projects/gameplay_code_standard.md) |
| 浏览器调试 / Playwright 命令 | [`testing/playwright_commands.md`](./testing/playwright_commands.md) |
| **维护文档体系**（同步/巡检/范式升级） | [`doc_maintenance.md`](./doc_maintenance.md) |

---

## 1. 总览（1 篇）

| 文件 | 说明 |
|---|---|
| [`system_overview.md`](./system_overview.md) | **系统总览**：引擎 13 域 / 编辑器 4 二级目录 + 4 store / 项目 5 个 / 资产 5 类的架构索引 |

## 2. 引擎模块（src/engine/，13 篇）

| 文件 | 说明 |
|---|---|
| [`engine/entity_system.md`](./engine/entity_system.md) | 实体体系：OObject → AObject → BObject → Actor 层级 + 组件系统 |
| [`engine/gameflow_system.md`](./engine/gameflow_system.md) | 游戏流程：Game / GameInstance / GameMode / GameState / World |
| [`engine/rendering_system.md`](./engine/rendering_system.md) | 渲染系统：ThreeObjectFactory 造对象 / SceneRendererComponent 每帧合成 / 相机族与 UICamera 双层 |
| [`engine/ui_system.md`](./engine/ui_system.md) | 世界 UI：UIManager / HUD / UI 控件组件 |
| [`engine/ui_canvas_component.md`](./engine/ui_canvas_component.md) | CanvasUIComponent 组件：画布渲染 + hitTest 命中测试 |
| [`engine/input_system.md`](./engine/input_system.md) | 输入系统：InputSys / InputComponent / PlayerController 输入路由 |
| [`engine/physics_system.md`](./engine/physics_system.md) | 物理与点击：PhySys / ClickableComponent / ColliderComponent 射线与碰撞 |
| [`engine/script_system.md`](./engine/script_system.md) | 脚本系统：ScriptRegistry / BehaviourScript / UIScriptComponent |
| [`engine/asset_tools_system.md`](./engine/asset_tools_system.md) | 资产与工具：AssetRegistry / BlueprintRegistry / 配置表 / 存档 |
| [`engine/ai_system.md`](./engine/ai_system.md) | AI 事件系统：AIModule 事件总线（MCP 控制游戏） |
| [`engine/gm_system.md`](./engine/gm_system.md) | GM 命令系统：*.gm.ts 自动注册 + 游戏内控制台 |
| [`engine/navigation_system.md`](./engine/navigation_system.md) | 导航系统：NavGrid 栅格阻挡表 + A\* 寻路（只算路不走路） |
| [`engine/ursina_reference.md`](./engine/ursina_reference.md) | Ursina 参考文档（涉及 API 兼容性设计时参考） |

## 3. 编辑器模块（src/editor/ + src/components/，15 篇）

> **15 篇全部为新范式**：开篇三问 → 真实源码逐段讲解 → 关键方法速查（带行号）→ 流程影响（带文档链接）→ 踩坑清单。范本见 [core/core_system.md](./editor/core/core_system.md)，规范见 `.github/skills/skl-write-doc/SKILL.md` §3.1。

### 3.1 core（核心与视口，4 篇）

| 文件 | 说明 |
|---|---|
| [`core/core_system.md`](./editor/core/core_system.md) | 编辑器核心：Editor / EditorInitializer / 事件总线 / 快捷键 |
| [`core/viewport_system.md`](./editor/core/viewport_system.md) | 视口与场景：Scene 视口 / Game 视口 / 场景初始化 |
| [`core/selection_transform_system.md`](./editor/core/selection_transform_system.md) | 选择与变换：SelectionManager / TransformGizmo / AnchorGizmo |
| [`core/property_edit_system.md`](./editor/core/property_edit_system.md) | 属性修改：Inspector 双通道编辑 |

### 3.2 blueprint（蓝图与撤销，2 篇）

| 文件 | 说明 |
|---|---|
| [`blueprint/blueprint_edit_system.md`](./editor/blueprint/blueprint_edit_system.md) | 蓝图编辑：BlueprintEditorService / blueprintOps / UndoManager |
| [`blueprint/undo_redo_system.md`](./editor/blueprint/undo_redo_system.md) | 蓝图编辑器撤销/重做系统设计 |

### 3.3 asset（预览与检查，2 篇）

| 文件 | 说明 |
|---|---|
| [`asset/asset_preview_lint_system.md`](./editor/asset/asset_preview_lint_system.md) | 资产预览与检查：PreviewManagers / assetLint |
| [`asset/code_lint_system.md`](./editor/asset/code_lint_system.md) | 代码扫描检查：CodeLintEngine / TS 源码规则检查器 |

### 3.4 ui（面板与 UI 增强，6 篇）

| 文件 | 说明 |
|---|---|
| [`ui/ui_components_system.md`](./editor/ui/ui_components_system.md) | React 面板组件与状态管理（stores/） |
| [`ui/dashboard_panel_system.md`](./editor/ui/dashboard_panel_system.md) | 页面状态 Live Dashboard：HUD/Scene 树实时面板（AI 操作前确认目标） |
| [`ui/ui_enhancement_system.md`](./editor/ui/ui_enhancement_system.md) | UI 增强系统：Tween 补间 / Toast / Tooltip / 色盲模式 / 进度条 |
| [`ui/ui_anchor_system.md`](./editor/ui/ui_anchor_system.md) | UI 锚点系统：九宫格锚点布局算法 + AnchorGizmo 可视化编辑 |
| [`ui/ui_source_format_system.md`](./editor/ui/ui_source_format_system.md) | UI HTML 源格式：.widget.html 编译/反编译 + 双向同步 + MCP ui_compile |
| [`ui/ui_widget_html_manual.md`](./editor/ui/ui_widget_html_manual.md) | UI Widget HTML 编写手册（作者版）：只写 HTML+CSS 前端，编译器自动映射；标签/CSS 白名单、布局配方、禁区清单 |

### 3.5 integration（外部集成，2 篇）

| 文件 | 说明 |
|---|---|
| [`integration/mcp_integration.md`](./editor/integration/mcp_integration.md) | MCP 集成与调试桥：三客户端配置 / 9 个工具清单 / 多实例端口 |
| [`integration/agent_panel_system.md`](./editor/integration/agent_panel_system.md) | Agent 面板与事件流：连接状态机 / 双通道事件 / 会话恢复 |

---

## 4. 项目模块（src/projects/，5 篇）

| 文件 | 说明 |
|---|---|
| [`projects/clash_master.md`](./projects/clash_master.md) | ClashMaster 项目（目录仍为 fish）：register.ts 注册 + 三阶段路由 + 资产 glob 自动注册 |
| [`projects/level_system.md`](./projects/level_system.md) | 关卡系统：HUD 双按钮 → 地图面板 → 关卡切换 → 返回基地 |
| [`projects/battle_system.md`](./projects/battle_system.md) | 攻打战斗系统：敌方基地 / 放兵 / 兵 AI / 防御塔 / 胜负结算 |
| [`projects/gameplay_code_standard.md`](./projects/gameplay_code_standard.md) | gameplay 代码规范：七角色职责边界与越界红线 |
| [`projects/muzzle_flash_component.md`](./projects/muzzle_flash_component.md) | MuzzleFlashComponent 组件（fish 项目）：炮口闪光特效 |

## 5. Harness 模块（DSH 内核集成，9 篇）

| 文件 | 说明 |
|---|---|
| [`harness/harness_system.md`](./harness/harness_system.md) | **Harness 工程**：VS Code 扩展 + DSH 内核集成 + 引擎 agent 插件包 |
| [`harness/dsh_engine_integration.md`](./harness/dsh_engine_integration.md) | **DSH 与引擎集成架构**：agent 常驻化 / watchdog / 崩溃自愈 / 会话恢复 |
| [`harness/dsh_vscode_demostudio_prd.md`](./harness/dsh_vscode_demostudio_prd.md) | DSH VS Code DemoStudio PRD |
| [`harness/dsh_instructions_prd_revised.md`](./harness/dsh_instructions_prd_revised.md) | ds-instructions 插件 PRD（修订版）：路径前缀 → 目录指令映射 |
| [`harness/dsh_plugin_install.md`](./harness/dsh_plugin_install.md) | DSH 插件安装与加载：junction / patch 行 / 启动加载流程（含 ds-memory、ds-sync） |
| [`harness/preset-sync-mechanism.md`](./harness/preset-sync-mechanism.md) | Preset 同步机制 |
| [`harness/slash_command_system.md`](./harness/slash_command_system.md) | 斜杠命令系统：触发检测 / 命令注册 / DSH 集成 |
| [`harness/dsh_data_flywheel_plan.md`](./harness/dsh_data_flywheel_plan.md) | 数据飞轮实施计划：知识（ds-memory）/ 反馈（ds-feedback）/ 行为（ds-experience）三层 |
| [`harness/dsh_data_flywheel_test_cases.md`](./harness/dsh_data_flywheel_test_cases.md) | 数据飞轮测试用例集：KM / RL / SQ / EXP / SP / M 编号体系与手动用例 |

## 6. 测试模块（3 篇）

| 文件 | 说明 |
|---|---|
| [`testing/playwright_testing.md`](./testing/playwright_testing.md) | Playwright 浏览器测试流程：环境限制、通用操作与踩坑记录 |
| [`testing/playwright_commands.md`](./testing/playwright_commands.md) | Playwright 命令速查 + 踩坑（VS Code 内置浏览器） |
| [`testing/playwright_mcp_commands.md`](./testing/playwright_mcp_commands.md) | Playwright MCP 调试（本地 Chrome，CDP :9222） |

---

## 7. 元文档（1 篇）

| 文件 | 说明 |
|---|---|
| [`doc_maintenance.md`](./doc_maintenance.md) | **文档维护作业规范**：体系归属 / 四类维护作业 / 断链巡检脚本 / 维护踩坑清单（智能体与人共用） |

## 8. 开发方案（doc/dev/，1 篇）

> 落盘待实施的设计方案，实施完成后内容应随代码现状更新或归档。

| 文件 | 说明 |
|---|---|
| [`dev/external_project_roots.md`](./dev/external_project_roots.md) | 外部根目录工程支持方案：内置案例 + `projects/` 外部根双轨注册与发现 |

---

## 统计

7 个模块共 **48 篇功能文档 + 1 篇元文档 + 1 篇开发方案**：总览 1 / 引擎 13 / 编辑器 16（core 4 / blueprint 2 / asset 2 / ui 6 / integration 2）/ 项目 5 / Harness 9 / 测试 3 / 元文档 1 / 开发方案 1。

> **范式状态**（2026-09-03 全量改造完成）：**47 篇功能文档已全部为新范式**（dashboard_panel_system.md 新建时即按新范式编写，累计 48 篇）——五要素（开篇三问 / 先记住这几个文件 / 关键方法速查 / 流程影响 / 踩坑清单）47/47 达标，全库断链 0、孤儿文档 0。
>
> 本次改造相对旧体系的三处结构性变更：
>
> 1. **拆分**：`engine/input_physics_script_system.md`（一篇塞输入/物理/脚本三个系统）拆为 `input_system.md` / `physics_system.md` / `script_system.md` 三篇独立文档。
> 2. **归位**：`engine/muzzle_flash_component.md` 描述的组件实际位于 `src/projects/fish/`，按「文档落点由源码目录决定」的归属铁律移入 `projects/`。
> 3. **升级**：其余 29 篇旧范式文档（概述 → 核心类表格 → 使用方法 …）全部按新范式整体重写，重写过程逐篇重读源码核对，纠正了一批沿袭多年的事实错误（详见 [`doc_maintenance.md`](./doc_maintenance.md) §5）。
