/**
 * Editor — 编辑器核心逻辑类
 *
 * 代表整个编辑器的逻辑中枢，封装初始化、生命周期、系统协调。
 * App.tsx 通过此类的 API 驱动编辑器行为，保持 UI 层纯净。
 */
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { useEditorPrefsStore } from '../stores/editorPrefsStore'
import { useSaveStore } from '../stores/saveStore'
import { registerAllProjects, registerGlobalEventListeners } from './index'
import { FpsTracker } from './FpsTracker'
import { LogPoller } from './LogPoller'

export interface EditorCallbacks {
  addConsoleOutput: (text: string) => void
  setShowProjectSelector: (show: boolean) => void
  launchGame: () => void
  stopGame: () => void
  setAppInfo: (info: { fps: number; project: string }) => void
  setLoading: (loading: boolean) => void
}

export class Editor {
  private fpsTracker: FpsTracker
  private logPoller: LogPoller
  private cleanupFns: (() => void)[] = []

  constructor() {
    this.fpsTracker = new FpsTracker()
    this.logPoller = new LogPoller()
  }

  /** 编辑器启动初始化 */
  init(callbacks: EditorCallbacks): void {
    const {
      addConsoleOutput,
      setShowProjectSelector,
      launchGame,
      stopGame,
      setAppInfo,
    } = callbacks

    addConsoleOutput('DemoStudio Editor v4.0.0 已启动')

    // 1. 注册所有项目（世界构建器、游戏工厂、配置表）
    registerAllProjects(addConsoleOutput)

    // 2. 扫描工程并恢复上次打开的项目
    const { discoverProjects } = useProjectStore.getState()
    void discoverProjects().then(() => {
      const lastFolder = useEditorPrefsStore.getState().lastProjectFolder
      if (lastFolder && !useEditorStore.getState().currentProject) {
        const match = useProjectStore.getState().projects.find((p) => p.folder === lastFolder)
        if (match) useEditorStore.getState().setCurrentProject(match)
      }
    })

    // 3. 注册全局事件监听（快捷键、Electron 菜单、MCP）
    const cleanupEvents = registerGlobalEventListeners({
      toggleConsole: () => useEditorPrefsStore.getState().toggleConsole(),
      setShowProjectSelector,
      addConsoleOutput,
      saveGame: (slot) => { void useSaveStore.getState().saveGame(slot) },
      loadGame: (slot) => { void useSaveStore.getState().loadGame(slot) },
      launchGame,
      stopGame,
      setCurrentProject: (project) => { if (project) useEditorStore.getState().setCurrentProject(project) },
    })
    this.cleanupFns.push(cleanupEvents)

    // 4. 启动 FPS 跟踪与游戏状态上报
    this.fpsTracker.start((fps, project) => {
      setAppInfo({ fps, project })

      // 同步状态到 Electron main
      const gs = useEditorStore.getState().gameState
      if (window.electronAPI?.reportGameState) {
        window.electronAPI.reportGameState({
          running: gs.running,
          score: gs.score,
        })
      }
    })

    addConsoleOutput('基于 Three.js + Electron + React')
    addConsoleOutput('')

    // 5. 记忆当前项目（配置表由各 GameMode 自身在构造时加载）
    const unsubProject = useEditorStore.subscribe((state, prev) => {
      if (state.currentProject !== prev.currentProject && state.currentProject) {
        useEditorPrefsStore.getState().setLastProject(state.currentProject.folder)
        useEditorPrefsStore.getState().pushRecent(state.currentProject.folder)
        // 配置表由各项目的 GameMode 自身在构造时加载，无需在此触发
      }
    })
    this.cleanupFns.push(unsubProject)

    // 6. Viewport 就绪后通知 Electron 关闭加载窗口
    const unsubLoading = useEditorStore.subscribe(() => {
      // 由 App.tsx 通过 callbacks 控制 loading
    })
    this.cleanupFns.push(unsubLoading)
  }

  /** Viewport 就绪回调 */
  onViewportReady(): void {
    if (window.electronAPI?.sendAppReady) {
      window.electronAPI.sendAppReady()
    }
  }

  /** 获取日志轮询器 */
  getLogPoller(): LogPoller {
    return this.logPoller
  }

  /** 销毁编辑器，清理所有资源 */
  destroy(): void {
    this.fpsTracker.stop()
    this.logPoller.destroy()
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
  }
}
