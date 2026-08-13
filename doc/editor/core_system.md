# 编辑器核心系统（Editor Core）

> 编辑器逻辑中枢：Editor 主类、初始化装配、事件总线、快捷键、输入路由、控制台命令。
> 代码位置：`src/editor/`
> 相关文档：[系统总览](../system_overview.md) / [React 面板组件](./ui_components_system.md)

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

## 3. 使用方法

### 3.1 入口 API

| 方法 | 签名 | 说明 |
|---|---|---|
| 初始化 | `Editor.init(callbacks: EditorCallbacks): void` | 编辑器启动入口；**不可重复调用**（无幂等保护，App.tsx 用 useEffect [] 保证一次） |
| 视口就绪 | `Editor.onViewportReady()` | 通知 Electron 关闭加载窗口 |
| 销毁 | `Editor.destroy()` | 停 FPS、销毁 LogPoller、执行全部 cleanupFns；重复 destroy 安全 |
| 快捷键注册 | `registerShortcuts(bindings?)` | 返回清理函数 |
| 命令执行 | `ConsoleCommands.executeCommand(input, ctx)` | 控制台命令分发 |

```ts
// App.tsx
const editor = new Editor()
editor.init({
  addConsoleOutput,
  setShowProjectSelector,
  launchGame: () => { /* gameState 判断启动/停止 */ },
  stopGame,
  setAppInfo,
  setLoading,
})
```

### 3.2 触发时机与使用前提

- `init` 内顺序：`registerAllProjects` → `discoverProjects`（启动不自动恢复）→ `registerGlobalEventListeners` → `installEventBridge` → FPS/LogPoller 启动 → `assetLintEngine.start()` → 订阅 currentProject 变化
- 所有 electronAPI 调用均为可选链（`window.electronAPI?.xxx`），浏览器模式静默跳过

## 4. 工作流程

### 4.1 初始化流程（Editor.init）

```
1. registerAllProjects(addConsoleOutput)      // 注册所有项目（游戏工厂/配置表/资产）
2. discoverProjects()                          // 扫描工程（启动不自动恢复，用户全屏选择器选取）
3. registerGlobalEventListeners(...)           // 快捷键 / Electron 菜单 / MCP
4. FpsTracker / LogPoller 启动 + assetLintEngine.start()
```

`EditorInitializer` 补充装配：

```
registerAllProjectModules（projects/registry.ts）
installBlueprintWindowApi（window.blueprintEditor 供脚本/AI 调用）
installEventBridge（editorBus 事件 → Zustand store）
registerEditorAIHandlers（ai.selectActor / ai.dragActor 编辑能力）
```

### 4.2 事件桥接模式（installEventBridge）

```mermaid
flowchart LR
    A[底层模块<br/>SelectionManager / BlueprintEditorService] -->|editorBus.emit| B[installEventBridge]
    B -->|翻译| C[useEditorStore.getState().xxx]
    C -->|订阅| D[React 组件重渲染]
```

示例：
- `SELECTION_CHANGED` → `bumpSelectionNonce()`
- `BLUEPRINT_TRANSFORM_DIRTY` → `markBlueprintDirty(path)`
- `BLUEPRINT_SAVED` → `markBlueprintClean(path)`

## 5. 边界条件

| 条件 | 行为/后果 | 处理方式 |
|---|---|---|
| `init` 重复调用 | 无幂等保护，可能重复注册监听 | App.tsx 用 useEffect [] 保证单次 |
| 浏览器模式（无 electronAPI） | 全链路可选链静默跳过；LogPoller 直接回调"仅支持 Electron 环境"；F12/MCP/菜单无操作 | 引擎内置降级（MockElectronAPI 模拟部分能力） |
| MCP `start_game` 无项目 | 自动选第一个；都失败输出 `[MCP] start_game: 无可用项目` | 先创建项目 |
| MCP `ai_event` 缺 event | `{ status: 'error', message: '缺少 event 参数' }` | 补齐参数 |
| 快捷键输入框聚焦 | `INPUT/TEXTAREA` 直接 return 不拦截 | 引擎内置防护 |
| F12 | `window.electronAPI?.toggleDevTools?.()`，浏览器无操作 | 引擎内置 |
| 未知控制台命令 | `'未知命令: X。输入 help 查看可用命令。'` 不抛异常 | 引擎内置 |
| `start_game` 已运行 / `stop_game` 未运行 | 提示 `'⚠ 游戏已在运行中'` / `'⚠ 游戏未在运行'` | 引擎内置 |

## 6. 跨进程能力

| 能力 | 说明 |
|---|---|
| 文件读写 | `electronAPI.readJsonFile / writeJsonFile`（浏览器调试时用 MockElectronAPI） |
| 蓝图编辑窗口 API | `window.blueprintEditor`（脚本/AI 经此调用 BlueprintEditorService） |
| MCP 服务器 | `editor/mcp-server.mjs`：AI 经 HTTP 控制蓝图编辑与游戏 |
| 日志 | `LogPoller` 轮询 `logs/console_*.log` 展示到 Console 面板 |

## 7. 依赖关系

```
Editor → stores（editorStore/projectStore/editorPrefsStore/saveStore）
Editor → FpsTracker / LogPoller / assetLintEngine
EditorInitializer → projects/registry / blueprintEdit / SelectionManager / AIModule
installEventBridge → editorBus ↔ Zustand stores
```
