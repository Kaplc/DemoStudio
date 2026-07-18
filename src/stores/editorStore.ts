import { create } from 'zustand'

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

  // ─── 控制台 ───
  consoleOutput: string[]

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

  launchGame: () => void
  stopGame: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  // ─── 初始状态 ───
  projects: [],
  currentProject: null,
  showProjectSelector: false,
  showNewProjectDialog: false,

  launchCount: 0,

  gameState: {
    running: false,
    score: 0,
    gameOver: false,
  },

  consoleOutput: ['DemoStudio Editor v4.0.0 已启动', '输入 help 查看命令列表'],

  // ─── Actions ───
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),
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
}))
