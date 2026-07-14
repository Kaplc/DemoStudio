import { create } from 'zustand'

export interface Project {
  name: string
  description: string
  version: string
  tags: string[]
  folder: string
}

export interface GameState {
  running: boolean
  score: number
  gameOver: boolean
}

export type PanelId = 'scene' | 'game' | 'inspector' | 'console' | 'project'

export interface EditorState {
  // ─── 工程 ───
  projects: Project[]
  currentProject: Project | null
  showProjectSelector: boolean

  // ─── 游戏 ───
  gameState: GameState

  // ─── 面板 ───
  panels: Record<PanelId, { visible: boolean }>
  consoleVisible: boolean
  consoleOutput: string[]

  // ─── Actions ───
  setProjects: (projects: Project[]) => void
  setCurrentProject: (project: Project | null) => void
  setShowProjectSelector: (show: boolean) => void

  setGameRunning: (running: boolean) => void
  setGameScore: (score: number) => void
  setGameOver: (gameOver: boolean) => void

  togglePanel: (panel: PanelId) => void
  toggleConsole: () => void
  addConsoleOutput: (text: string) => void
  clearConsole: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  // ─── 初始状态 ───
  projects: [],
  currentProject: null,
  showProjectSelector: false,

  gameState: {
    running: false,
    score: 0,
    gameOver: false,
  },

  panels: {
    scene: { visible: true },
    game: { visible: true },
    inspector: { visible: true },
    console: { visible: true },
    project: { visible: true },
  },
  consoleVisible: false,
  consoleOutput: ['DemoStudio Editor v4.0.0 已启动', '输入 help 查看命令列表'],

  // ─── Actions ───
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),
  setShowProjectSelector: (show) => set({ showProjectSelector: show }),

  setGameRunning: (running) =>
    set((state) => ({ gameState: { ...state.gameState, running } })),
  setGameScore: (score) =>
    set((state) => ({ gameState: { ...state.gameState, score } })),
  setGameOver: (gameOver) =>
    set((state) => ({ gameState: { ...state.gameState, gameOver } })),

  togglePanel: (panel) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panel]: { visible: !state.panels[panel].visible },
      },
    })),

  toggleConsole: () =>
    set((state) => ({ consoleVisible: !state.consoleVisible })),

  addConsoleOutput: (text) =>
    set((state) => ({
      consoleOutput: [...state.consoleOutput.slice(-199), text],
    })),

  clearConsole: () => set({ consoleOutput: [] }),
}))
