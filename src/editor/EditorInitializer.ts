/**
 * EditorInitializer — 编辑器初始化逻辑
 *
 * 委托 projects/registry.ts 自动扫描注册所有项目。
 * 不再直接感知具体项目类，新增项目只需在 projects/registry.ts 注册即可。
 */
import { registerAllProjectModules } from '../projects/registry'
import { installBlueprintWindowApi } from './blueprintEdit/windowApi'
import { BlueprintEditorService } from './blueprintEdit/BlueprintEditorService'
import { editorBus } from './EditorEvents'
import { EditorEvent } from './EditorEventNames'
import { useEditorStore } from '../stores/editorStore'

export type InitLogger = (message: string) => void

/**
 * 注册编辑器事件到 Zustand store 的桥接。
 * 底层模块（SelectionManager、BlueprintEditor 等）只负责 emit 事件，
 * 此函数将事件翻译为 store 状态更新，供 React 组件订阅。
 *
 * 调用一次即可，返回清理函数。
 */
export function installEventBridge(): () => void {
  const unsubs: Array<() => void> = []

  unsubs.push(
    editorBus.on(EditorEvent.SELECTION_CHANGED, () => {
      useEditorStore.getState().bumpSelectionNonce()
    }),
  )

  unsubs.push(
    editorBus.on(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, (path: string) => {
      useEditorStore.getState().markBlueprintDirty(path)
    }),
  )

  unsubs.push(
    editorBus.on(EditorEvent.BLUEPRINT_SAVED, (path: string) => {
      useEditorStore.getState().markBlueprintClean(path)
    }),
  )

  return () => unsubs.forEach((u) => u())
}

/**
 * 注册所有内置项目到编辑器的各个注册表中
 * 委托 registerAllProjectModules 自动完成 GameFactoryRegistry / ConfigRegistry 注册
 * @param log 日志输出回调
 */
export function registerAllProjects(log: InitLogger = console.log): void {
  registerAllProjectModules(log)
}

/**
 * 注册快捷键与 Electron 菜单的全局事件监听
 * @param callbacks 事件回调
 * @returns 清理函数
 */
export function registerGlobalEventListeners(callbacks: {
  toggleConsole: () => void
  setShowProjectSelector: (show: boolean) => void
  addConsoleOutput: (text: string) => void
  saveGame: (slot: string) => void
  loadGame: (slot: string) => void
  launchGame: () => void
  stopGame: () => void
  setCurrentProject: (project: any) => void
}): () => void {
  const {
    toggleConsole,
    setShowProjectSelector,
    addConsoleOutput,
    saveGame,
    loadGame,
    launchGame,
    stopGame,
    setCurrentProject,
  } = callbacks

  const onToggleConsole = () => toggleConsole()
  const onOpenProject = () => setShowProjectSelector(true)
  const onNewProject = () => addConsoleOutput('[菜单] New Project')
  const onSave = () => saveGame('quick')
  const onSaveAs = () => saveGame('auto')
  const onQuickLoad = () => loadGame('quick')
  const onLaunchGame = () => {
    // 逻辑由调用方useEditorStore的状态决定，这里简单委托
    launchGame()
  }
  const onStopGame = () => stopGame()

  window.addEventListener('shortcut-toggle-console', onToggleConsole)
  window.addEventListener('shortcut-open-project', onOpenProject)
  window.addEventListener('shortcut-new-project', onNewProject)
  window.addEventListener('shortcut-save', onSave)
  window.addEventListener('shortcut-save-as', onSaveAs)
  window.addEventListener('shortcut-quick-save', onSave)
  window.addEventListener('shortcut-quick-load', onQuickLoad)
  window.addEventListener('shortcut-launch-game', onLaunchGame)
  window.addEventListener('shortcut-stop-game', onStopGame)

  // Electron 菜单事件
  let electronCleanup: (() => void) | undefined
  let mcpCleanup: (() => void) | undefined
  let blueprintMcpCleanup: (() => void) | undefined

  // 暴露 window.blueprintEditor（页面内 / 控制台调用）
  installBlueprintWindowApi()

  if (window.electronAPI) {
    electronCleanup = window.electronAPI.onMenuAction((action) => {
      switch (action) {
        case 'launch-game':
          onLaunchGame()
          break
        case 'stop-game':
          onStopGame()
          break
        default:
          addConsoleOutput(`[菜单] ${action}`)
      }
    })

    if (window.electronAPI.onMCPCommand) {
      mcpCleanup = window.electronAPI.onMCPCommand((command, params) => {
        addConsoleOutput(`[MCP] 收到命令: ${command}`)
        switch (command) {
          case 'launchGame':
          case 'start_game':
            setCurrentProject(null) // 触发自动选中
            onLaunchGame()
            break
          case 'stopGame':
          case 'stop_game':
            onStopGame()
            break
          case 'toggle_game':
            onLaunchGame()
            break
          case 'addConsoleOutput':
            if (params?.text) addConsoleOutput(params.text)
            break
          case 'send_input':
            if (params?.key) {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: params.key, bubbles: true }))
              addConsoleOutput(`[MCP] 发送按键: ${params.key}`)
            }
            break
          default:
            addConsoleOutput(`[MCP] 未知命令: ${command}`)
        }
      })
    }

    // 蓝图编辑 MCP 往返：外部 AI（经 MCP 服务器 + HTTP /api/blueprint）→ 主进程 → 此处处理
    if (window.electronAPI.onBlueprintRequest) {
      blueprintMcpCleanup = window.electronAPI.onBlueprintRequest(async (requestId, op, params) => {
        let result
        try {
          result = await BlueprintEditorService.dispatch(op, params ?? {})
        } catch (err) {
          result = { ok: false, error: String(err) }
        }
        window.electronAPI?.sendBlueprintResponse(requestId, result)
      })
    }
  }

  return () => {
    window.removeEventListener('shortcut-toggle-console', onToggleConsole)
    window.removeEventListener('shortcut-open-project', onOpenProject)
    window.removeEventListener('shortcut-new-project', onNewProject)
    window.removeEventListener('shortcut-save', onSave)
    window.removeEventListener('shortcut-save-as', onSaveAs)
    window.removeEventListener('shortcut-quick-save', onSave)
    window.removeEventListener('shortcut-quick-load', onQuickLoad)
    window.removeEventListener('shortcut-launch-game', onLaunchGame)
    window.removeEventListener('shortcut-stop-game', onStopGame)
    electronCleanup?.()
    mcpCleanup?.()
    blueprintMcpCleanup?.()
  }
}
