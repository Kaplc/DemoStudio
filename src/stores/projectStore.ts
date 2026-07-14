import { create } from 'zustand'
import type { Project } from './editorStore'

interface ProjectStore {
  projects: Project[]
  loading: boolean

  discoverProjects: () => Promise<void>
}

// 预设示例工程
const DEFAULT_PROJECTS: Project[] = [
  {
    name: 'Snake',
    description: '经典 2.5D 贪吃蛇游戏',
    version: '1.0.0',
    tags: ['game', 'snake', '2.5d'],
    folder: 'snake',
  },
]

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: DEFAULT_PROJECTS,
  loading: false,

  discoverProjects: async () => {
    set({ loading: true })
    // 模拟异步发现工程
    // 实际实现中可以从文件系统扫描 projects/ 目录
    await new Promise((r) => setTimeout(r, 300))
    set({ projects: DEFAULT_PROJECTS, loading: false })
  },
}))
