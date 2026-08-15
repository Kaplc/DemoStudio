import { create } from 'zustand'
import type { Project } from './editorStore'

interface ProjectStore {
  projects: Project[]
  loading: boolean

  discoverProjects: () => Promise<void>
  setProjects: (projects: Project[]) => void
}

// 预设示例工程
const DEFAULT_PROJECTS: Project[] = [
  {
    name: 'Snake',
    description: '经典 2.5D 贪吃蛇游戏',
    version: '1.0.0',
    tags: ['game', 'snake', '2.5d'],
    folder: 'snake',
    defaultScene: 'src/projects/snake/snake.scene.json',
  },
  {
    name: 'EatFish',
    description: '大鱼吃小鱼 3D 水下生存游戏',
    version: '1.0.0',
    tags: ['game', 'eatfish', '3d', 'underwater'],
    folder: 'eatfish',
  },
  {
    name: 'Demo2D',
    description: '2D 正交相机 + Sprite 演示（移动收集金币）',
    version: '1.0.0',
    tags: ['game', '2d', 'sprite'],
    folder: 'demo2d',
    renderMode: '2d',
    defaultScene: 'src/projects/demo2d/demo2d.scene.json',
  },
  {
    name: 'Racing',
    description: '3D 环形赛道赛车游戏（加速/刹车/圈数计时）',
    version: '1.0.0',
    tags: ['game', 'racing', '3d', 'car'],
    folder: 'racing',
  },
  {
    name: 'ClashMaster',
    description: '部落冲突 — 村庄建设、兵种训练、攻城战斗、关卡挑战',
    version: '1.0.0',
    tags: ['game', 'clash', '2d'],
    folder: 'fish',
    renderMode: '2d',
    defaultScene: 'src/projects/fish/asset/fish_menu.scene.json',
  },
]

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: DEFAULT_PROJECTS,
  loading: false,

  discoverProjects: async () => {
    set({ loading: true })
    try {
      // 优先通过 Electron IPC 扫描文件系统
      if (window.electronAPI?.discoverProjectsScan) {
        const scanned = await window.electronAPI.discoverProjectsScan()
        if (scanned.length > 0) {
          set({ projects: scanned, loading: false })
          return
        }
      }
    } catch {
      // IPC 失败则回退到预设列表
    }
    // 回退：确保 Snake 始终在列表中
    const existing = useProjectStore.getState().projects
    if (!existing.some(p => p.folder === 'snake')) {
      set({ projects: [...existing, ...DEFAULT_PROJECTS.filter(p => !existing.some(e => e.folder === p.folder))], loading: false })
    } else {
      set({ loading: false })
    }
  },

  setProjects: (projects) => set({ projects }),
}))
