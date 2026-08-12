# 编辑器核心系统（Editor Core）

> 编辑器逻辑中枢：Editor 主类、初始化装配、事件总线、快捷键、输入路由、控制台命令。
> 代码位置：`src/editor/`
> 相关文档：[系统总览](../system_overview.md)

## 1. 概述

编辑器核心是 UI 层（React）与底层能力之间的逻辑中枢：

- `Editor`：代表整个编辑器的逻辑中枢，封装初始化、生命周期、系统协调。`App.tsx` 通过此类的 API 驱动编辑器行为，保持 UI 层纯净
- `EditorInitializer`：初始化装配（项目扫描注册、事件桥接、蓝图窗口 API、AI 编辑器处理器）
- 事件总线：底层模块只 emit 事件，桥接层翻译为 Zustand store 状态更新供 React 订阅

## 2. 核心类

| 类 | 说明 |
|---|---|
| `Editor` | 编辑器主类：`init(callbacks)` 启动初始化（注册项目 → 扫描工程 → 全局事件监听 → FPS/日志轮询）；`EditorCallbacks` 定义 UI 回调（addConsoleOutput / launchGame / stopGame / setAppInfo / setLoading 等） |
| `EditorInitializer` | 初始化装配：`registerAllProjectModules`（委托 projects/registry.ts 自动扫描注册）、`installBlueprintWindowApi`、`installEventBridge`、`registerEditorAIHandlers` |
| `EditorEvents` | 事件总线实例 `editorBus`（类型安全的事件通道） |
| `EditorEventNames` | 事件名常量（`SELECTION_CHANGED` / `BLUEPRINT_TRANSFORM_DIRTY` / `BLUEPRINT_SAVED` 等） |
| `KeyboardShortcuts` | 快捷键系统（Ctrl+S 保存、撤销/重做等） |
| `InputRouter` | 编辑器输入路由 |
| `ConsoleCommands` | 控制台命令注册（开发调试） |
| `ProjectValidator` | 项目结构校验 |
| `MockElectronAPI` | 浏览器调试模式的 electronAPI 模拟（`electronAPI` 在浏览器中不可用） |
| `FpsTracker` | FPS 统计（状态栏显示） |
| `LogPoller` | 运行日志轮询（对接 `logs/` 目录，控制台面板展示） |

## 3. 初始化流程（Editor.init）

```
1. registerAllProjects(addConsoleOutput)      // 注册所有项目（游戏工厂/配置表/资产）
2. discoverProjects()                          // 扫描工程（启动不自动恢复，用户全屏选择器选取）
3. registerGlobalEventListeners(...)           // 快捷键 / Electron 菜单 / MCP
4. FpsTracker / LogPoller 启动
```

`EditorInitializer` 补充装配：

```
registerAllProjectModules（projects/registry.ts）
installBlueprintWindowApi（window.blueprintEditor 供脚本/AI 调用）
installEventBridge（editorBus 事件 → Zustand store）
registerEditorAIHandlers（ai.selectActor / ai.dragActor 编辑能力）
```

## 4. 事件桥接模式（installEventBridge）

```
底层模块（SelectionManager / BlueprintEditorService 等）
  → editorBus.emit(EditorEvent.XXX, payload)
  → installEventBridge 监听并翻译
  → useEditorStore.getState().xxx()
  → React 组件订阅重渲染
```

示例：
- `SELECTION_CHANGED` → `bumpSelectionNonce()`
- `BLUEPRINT_TRANSFORM_DIRTY` → `markBlueprintDirty(path)`
- `BLUEPRINT_SAVED` → `markBlueprintClean(path)`

## 5. 跨进程能力

| 能力 | 说明 |
|---|---|
| 文件读写 | `electronAPI.readJsonFile / writeJsonFile`（浏览器调试时用 MockElectronAPI） |
| 蓝图编辑窗口 API | `window.blueprintEditor`（脚本/AI 经此调用 BlueprintEditorService） |
| MCP 服务器 | `editor/mcp-server.mjs`：AI 经 HTTP 控制蓝图编辑与游戏 |
| 日志 | `LogPoller` 轮询 `logs/console_*.log` 展示到 Console 面板 |

## 6. 依赖关系

```
Editor → stores（editorStore/projectStore/editorPrefsStore/saveStore）
Editor → FpsTracker / LogPoller / assetLintEngine
EditorInitializer → projects/registry / blueprintEdit / SelectionManager / AIModule
installEventBridge → editorBus ↔ Zustand stores
```
