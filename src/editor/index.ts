/**
 * editor — 编辑器逻辑模块
 *
 * 包含编辑器核心的非 UI 逻辑，从各 tsx 组件中剥离而来。
 * 此模块代表整个编辑器的逻辑层，UI 组件（tsx）仅负责渲染与交互委托。
 *
 * 子模块：
 * - Editor           编辑器核心逻辑类（协调所有子系统）
 * - SceneDefaults    场景默认内容与天空盒配置
 * - ConsoleCommands  控制台命令系统
 * - KeyboardShortcuts 全局键盘快捷键
 * - ProjectValidator 工程名称验证
 * - EditorInitializer 编辑器初始化（注册表、事件监听）
 * - FpsTracker       FPS 计数与状态上报
 * - SceneSetup       Viewport 3D 场景初始化编排
 * - SceneViewport    Scene 视口初始化与输入
 * - GameViewport     Game 视口初始化与输入
 * - InputRouter      Viewport 输入路由（委托给 SceneViewport / GameViewport）
 * - LogPoller        日志文件轮询器
 * - AssetLintEngine  可扩展 JSON 资产格式检查器（插件式 schema 校验 + 定时扫描）
 */

export { BlueprintPreviewManager } from './BlueprintPreviewManager'
export { UIPreviewManager } from './UIPreviewManager'
export { ScenePreviewManager } from './ScenePreviewManager'
export { AssetPreviewManager } from './AssetPreviewManager'

export { Editor } from './Editor'
export type { EditorCallbacks } from './Editor'

export {
  addDefaultContent,
  applySkybox,
  _ptrWorld,
} from './SceneDefaults'
export type { SkyboxConfig } from '../engine'

export {
  executeCommand,
  registerCommand,
} from './ConsoleCommands'
export type { ConsoleCommandContext } from './ConsoleCommands'

export {
  handleKeyboardShortcut,
  registerShortcuts,
} from './KeyboardShortcuts'
export type { ShortcutBinding } from './KeyboardShortcuts'
export { DEFAULT_SHORTCUTS } from './KeyboardShortcuts'

export {
  validateProjectName,
} from './ProjectValidator'
export type { ProjectValidationResult } from './ProjectValidator'

export {
  registerAllProjects,
  registerGlobalEventListeners,
  installEventBridge,
} from './EditorInitializer'
export type { InitLogger } from './EditorInitializer'

export { initProjectConfigs } from '../projects/registry'

export { FpsTracker } from './FpsTracker'
export type { FpsCallback } from './FpsTracker'

export { setupScene } from './SceneSetup'
export type { SceneSetupResult, SceneSetupCallbacks } from './SceneSetup'

export { createSceneViewport, handleSceneKeyDown, handleSceneKeyUp } from './SceneViewport'
export {
  createGameViewport,
  handleGameKeyDown,
  handleGameKeyUp,
  handleGameMouseMove,
  handleGameMouseDown,
  handleGameMouseUp,
  handleGameWheel,
  clientToWorld,
} from './GameViewport'

export {
  handleKeyDown,
  handleKeyUp,
  handleMouseMove,
  handleMouseDown,
  handleMouseUp,
  handleWheel,
} from './InputRouter'
export type { InputRouterContext } from './InputRouter'

export { LogPoller } from './LogPoller'
export type { LogContentCallback } from './LogPoller'

export { assetLintEngine } from './assetLint/AssetLintEngine'

export { getSelectedActor, selectActor, getSelectionKey, onSelectionChange, notifySelectionChange, setSharedScene, setSceneMgr, getSelected, select, getSceneTree, focusOn, getTransformGizmo } from './SelectionManager'
export { TransformGizmo } from './TransformGizmo'
export { editorBus } from './EditorEvents'
export { EditorEvent } from './EditorEventNames'
export { injectMockElectronAPI, clearMockSaves } from './MockElectronAPI'
