import { create } from 'zustand'
import { registerProjectAssets, clearProjectAssets } from '../projects/registry'

export interface Project {
  name: string
  description: string
  version: string
  tags: string[]
  folder: string
  /** 渲染模式：'2d'=正交相机 2D，'3d'=透视 3D（默认） */
  renderMode?: '2d' | '3d'
  /** 默认场景资产路径（相对于项目根），点击项目时加载此场景并读取其 mode */
  defaultScene?: string
}

export interface GameState {
  running: boolean
  score: number
  gameOver: boolean
}

export type PanelId = 'scene' | 'game' | 'inspector' | 'console' | 'project'

/** 视口页签定义（持久标签 + 动态标签：蓝图 / 场景预览 / 配置表） */
export interface ViewportTabDef {
  id: string
  type: 'scene' | 'game' | 'uiScene' | 'blueprint' | 'scenePreview' | 'config'
  label: string
  permanent: boolean
  assetPath?: string
}

/** 蓝图编辑器选择（点击组件/子 Actor 时设置，供 Inspector 面板展示信息） */
export interface BlueprintSelection {
  assetPath: string
  type: 'component' | 'child' | 'defaults'
  index: number
  label: string
  /** 组件 baseClass（仅 type='component' 时） */
  compType?: string
  /** 组件完整数据 */
  compData?: { id?: number; name?: string; baseClass: string; properties?: Record<string, unknown>; _remove?: boolean }
  /** 子 Actor 引用（仅 type='child' 时） */
  childRef?: string
  /** 子 Actor 完整数据 */
  childData?: { ref?: string; baseClass?: string; name?: string; id?: number; overrides?: Record<string, unknown>; components?: Array<{ id?: number; name?: string; baseClass: string; properties?: Record<string, unknown>; _remove?: boolean }>; position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number]; _remove?: boolean }
}

/** 资产浏览器选中的资产文件信息（AssetBrowser 点击文件时设置，供 Inspector 展示） */
export interface AssetSelection {
  /** 资产类型（scene/blueprint/widget/config/image） */
  kind: string
  /** 类型图标 */
  icon: string
  /** 文件完整相对路径（src/projects/...） */
  path: string
  /** 文件名 */
  name: string
  /** 文件大小（字节） */
  size: number
}

export interface EditorState {
  // ─── 工程 ───
  projects: Project[]
  currentProject: Project | null
  showProjectSelector: boolean
  showNewProjectDialog: boolean

  // ─── 游戏 ───
  gameState: GameState
  /** 启动计数器，每次 launchGame 递增，用于触发 Viewport 重新创建游戏实例 */
  launchCount: number

  // ─── 视口页签 ───
  /** 动态页签（蓝图编辑器 / 场景预览，scene/game 为内置持久标签） */
  dynamicTabs: ViewportTabDef[]
  /** 当前活跃的视口页签 id */
  activeTabId: string

  // ─── 左侧面板页签（大纲/资产/日志）───
  leftPanelTab: 'outline' | 'assets' | 'ui'
  setLeftPanelTab: (tab: 'outline' | 'assets' | 'ui') => void

  // ─── Agent 状态（AgentUI 已迁移至独立窗口，内嵌面板已移除）───
  agentConnected: boolean
  agentConnecting: boolean
  showPluginCenter: boolean
  setAgentConnected: (connected: boolean) => void
  setAgentConnecting: (connecting: boolean) => void
  setShowPluginCenter: (show: boolean) => void

  // ─── 蓝图编辑器选择 ───
  blueprintSelection: BlueprintSelection | null

  /**
   * 蓝图编辑刷新信号：每次外部/内部编辑蓝图资产时 bump。
   * BlueprintEditor 订阅它，变化时重新读盘 + 刷新预览。
   * lastEditedBlueprintPath 记录最近被编辑的资产路径，供定向刷新。
   */
  blueprintEditNonce: number
  lastEditedBlueprintPath: string | null

  // ─── 控制台 ───
  consoleOutput: string[]
  /** 控制台报错/警告快照（从磁盘日志文件 readLogFile 读取的 ERROR/WARN 行；
   *  状态栏徽标计数 + 报错面板展示，与 consoleOutput 独立） */
  consoleErrors: string[]
  /** 报错悬浮面板展开状态（状态栏报错徽标 ↔ ErrorStatusPanel 共享） */
  consoleErrPanelOpen: boolean

  // ─── Actions ───
  setProjects: (projects: Project[]) => void
  setCurrentProject: (project: Project | null) => void
  setShowProjectSelector: (show: boolean) => void
  setShowNewProjectDialog: (show: boolean) => void

  setGameRunning: (running: boolean) => void
  setGameScore: (score: number) => void
  setGameOver: (gameOver: boolean) => void

  addConsoleOutput: (text: string) => void
  clearConsole: () => void
  /** 从磁盘日志文件读取 ERROR/WARN 行，刷新报错快照（面板打开/徽标点击时调用） */
  refreshConsoleErrors: () => void
  /** 清空报错记录（仅清 consoleErrors 快照，不动 consoleOutput 与磁盘日志） */
  clearConsoleErrors: () => void
  /** 切换报错面板展开/收起 */
  setConsoleErrPanelOpen: (open: boolean) => void

  launchGame: () => void
  stopGame: () => void

  /** 打开蓝图编辑器页签（如果已打开则激活） */
  openBlueprintEditor: (assetPath: string, label: string) => void
  /** 打开场景预览页签（如果已打开则激活） */
  openScenePreview: (assetPath: string, label: string) => void
  /** 打开配置资产表格编辑器页签（如果已打开则激活） */
  openConfigEditor: (assetPath: string, label: string) => void
  /** 关闭动态页签 */
  closeDynamicTab: (tabId: string) => void
  /** 切换活跃页签 */
  setActiveTabId: (tabId: string) => void

  /** 蓝图编辑器选择状态（组件或子 Actor） */
  setBlueprintSelection: (sel: BlueprintSelection | null) => void

  /** bump 蓝图编辑刷新信号（编辑资产后调用，触发打开的编辑器重新读盘） */
  bumpBlueprintEdit: (assetPath: string) => void

  /** Gizmo 拖拽/选择变化刷新信号（notifySelectionChange 时 bump，供 Inspector 实时刷新 Transform） */
  selectionNonce: number
  bumpSelectionNonce: () => void

  /**
   * 未保存修改的蓝图路径集合。
   * Gizmo 拖拽位置等预览态修改不自动落盘，页签标题显示 * 提示。
   * key = assetPath, value = true。
   */
  dirtyBlueprints: Record<string, boolean>
  markBlueprintDirty: (path: string) => void
  markBlueprintClean: (path: string) => void

  // ─── 资产浏览器选择 ───
  /** 资产浏览器选中的资产文件（点击文件条目时设置，Inspector 展示信息） */
  assetSelection: AssetSelection | null
  setAssetSelection: (sel: AssetSelection | null) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  // ─── 初始状态 ───
  projects: [],
  currentProject: null,
  showProjectSelector: false,
  showNewProjectDialog: false,

  launchCount: 0,

  dynamicTabs: [],
  activeTabId: 'scene',
  leftPanelTab: 'outline',
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),

  // ─── 右侧面板 ───

  // ─── Agent 状态（AgentUI 已迁移至独立窗口）───
  agentConnected: false,
  agentConnecting: false,
  showPluginCenter: false,
  setAgentConnected: (connected) => set({ agentConnected: connected, agentConnecting: false }),
  setAgentConnecting: (connecting) => set({ agentConnecting: connecting }),
  setShowPluginCenter: (show) => set({ showPluginCenter: show }),

  blueprintSelection: null,
  assetSelection: null,
  blueprintEditNonce: 0,
  lastEditedBlueprintPath: null,
  selectionNonce: 0,
  dirtyBlueprints: {},

  gameState: {
    running: false,
    score: 0,
    gameOver: false,
  },

  consoleOutput: ['DemoStudio Editor v0.1.0 已启动', '输入 help 查看命令列表'],
  consoleErrors: [],
  consoleErrPanelOpen: false,

  // ─── Actions ───
  setProjects: (projects) => set({ projects }),
  // 切项目时清空动态页签 + 资产，避免残留旧项目数据
  setCurrentProject: (project) => {
    if (project) {
      registerProjectAssets(project.name)
    } else {
      clearProjectAssets()
    }
    set({ currentProject: project, dynamicTabs: [], activeTabId: 'scene', assetSelection: null })
  },
  setShowProjectSelector: (show) => set({ showProjectSelector: show }),
  setShowNewProjectDialog: (show) => set({ showNewProjectDialog: show }),

  setGameRunning: (running) =>
    set((state) => ({ gameState: { ...state.gameState, running } })),
  setGameScore: (score) =>
    set((state) => ({ gameState: { ...state.gameState, score } })),
  setGameOver: (gameOver) =>
    set((state) => ({ gameState: { ...state.gameState, gameOver } })),

  launchGame: () =>
    set((state) => {
      const name = state.currentProject?.name ?? 'Game'
      const tips = name === 'Snake'
        ? ['  方向键/WASD控制方向', '  Ctrl+Enter 停止游戏']
        : name === 'EatFish'
        ? ['  WASD/方向键控制游动', '  吃小鱼长大 · 避开大鱼', '  Ctrl+Enter 停止游戏']
        : name === 'Racing'
        ? ['  ↑/W 油门, ↓/S 刹车, ←/A 左转, →/D 右转', '  空格手刹 · 完成3圈获胜', '  Ctrl+Enter 停止游戏']
        : ['  Ctrl+Enter 停止游戏']
      return {
        launchCount: state.launchCount + 1,
        gameState: { running: true, score: 0, gameOver: false },
        consoleOutput: [...state.consoleOutput.slice(-199), `🎮 启动${name}游戏...`, '', ...tips],
      }
    }),
  stopGame: () =>
    set((state) => ({
      gameState: { running: false, score: 0, gameOver: false },
      consoleOutput: [...state.consoleOutput.slice(-199), '🛑 游戏已停止'],
    })),

  addConsoleOutput: (text) =>
    set((state) => ({
      consoleOutput: [...state.consoleOutput.slice(-199), text],
    })),

  clearConsole: () => set({ consoleOutput: [] }),

  refreshConsoleErrors: () => {
    // 直接读取磁盘日志文件（console_*.log），过滤 ERROR/WARN 行作为报错快照
    if (typeof window !== 'undefined' && typeof window.electronAPI?.readLogFile === 'function') {
      window.electronAPI.readLogFile({ tail: 1000 }).then((content) => {
        if (typeof content !== 'string') return
        const errors = content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && /\]\[(?:ERROR|WARN|CONSOLE:(?:ERROR|WARNING))\]/.test(l))
          .slice(-200)
        set({ consoleErrors: errors })
      }).catch(() => {})
    }
  },

  clearConsoleErrors: () => set({ consoleErrors: [] }),

  setConsoleErrPanelOpen: (consoleErrPanelOpen) => set({ consoleErrPanelOpen }),

  openBlueprintEditor: (assetPath, label) =>
    set((state) => {
      const existing = state.dynamicTabs.find((t) => t.assetPath === assetPath)
      if (existing) {
        return { activeTabId: existing.id, leftPanelTab: 'outline' }
      }
      const newTab: ViewportTabDef = {
        id: `bp:${assetPath}`,
        type: 'blueprint',
        label,
        permanent: false,
        assetPath,
      }
      return {
        dynamicTabs: [...state.dynamicTabs, newTab],
        activeTabId: newTab.id,
        // 打开蓝图后自动切到左侧大纲，方便直接看到 Actor 树
        leftPanelTab: 'outline',
      }
    }),
  openScenePreview: (assetPath, label) =>
    set((state) => {
      const existing = state.dynamicTabs.find((t) => t.assetPath === assetPath)
      if (existing) {
        return { activeTabId: existing.id, leftPanelTab: 'outline' }
      }
      const newTab: ViewportTabDef = {
        id: `sp:${assetPath}`,
        type: 'scenePreview',
        label,
        permanent: false,
        assetPath,
      }
      return {
        dynamicTabs: [...state.dynamicTabs, newTab],
        activeTabId: newTab.id,
        // 打开场景预览后自动切到左侧大纲，方便直接看到场景 Actor 树
        leftPanelTab: 'outline',
      }
    }),
  openConfigEditor: (assetPath, label) =>
    set((state) => {
      const existing = state.dynamicTabs.find((t) => t.assetPath === assetPath)
      if (existing) return { activeTabId: existing.id }
      const newTab: ViewportTabDef = {
        id: `cfg:${assetPath}`,
        type: 'config',
        label,
        permanent: false,
        assetPath,
      }
      return { dynamicTabs: [...state.dynamicTabs, newTab], activeTabId: newTab.id }
    }),
  closeDynamicTab: (tabId) =>
    set((state) => {
      const idx = state.dynamicTabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return {}
      const next = [...state.dynamicTabs]
      next.splice(idx, 1)
      let nextActive = state.activeTabId
      if (state.activeTabId === tabId) {
        if (next.length > 0) {
          const fallback = next[Math.min(idx, next.length - 1)]
          nextActive = fallback.id
        } else {
          nextActive = 'scene'
        }
      }
      return {
        dynamicTabs: next,
        activeTabId: nextActive,
        blueprintSelection: state.activeTabId === tabId ? null : state.blueprintSelection,
      }
    }),
  setActiveTabId: (tabId) => set({ activeTabId: tabId }),
  setBlueprintSelection: (sel) => set({ blueprintSelection: sel }),
  setAssetSelection: (sel) => set({ assetSelection: sel }),
  bumpBlueprintEdit: (assetPath) =>
    set((state) => ({
      blueprintEditNonce: state.blueprintEditNonce + 1,
      lastEditedBlueprintPath: assetPath,
    })),
  bumpSelectionNonce: () =>
    set((state) => ({
      selectionNonce: state.selectionNonce + 1,
    })),
  markBlueprintDirty: (path) =>
    set((state) => ({
      dirtyBlueprints: { ...state.dirtyBlueprints, [path]: true },
    })),
  markBlueprintClean: (path) =>
    set((state) => {
      const next = { ...state.dirtyBlueprints }
      delete next[path]
      return { dirtyBlueprints: next }
    }),
}))
