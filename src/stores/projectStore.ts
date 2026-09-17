import { create } from 'zustand'
import type { Project } from './editorStore'
import { mergeProjects } from './projectMerge'

interface ProjectStore {
  projects: Project[]
  loading: boolean

  discoverProjects: () => Promise<void>
  setProjects: (projects: Project[]) => void
}

// 预设示例工程（IPC 不可用时的兜底列表；路径为仓库根相对，工程单根 projects/ 前缀）
const DEFAULT_PROJECTS: Project[] = [
  {
    name: 'Demo2D',
    description: '2D 正交相机 + Sprite 演示（移动收集金币）',
    version: '1.0.0',
    tags: ['game', '2d', 'sprite'],
    folder: 'demo2d',
    renderMode: '2d',
    defaultScene: 'projects/demo2d/demo2d.scene.json',
  },
  {
    name: 'ClashMaster',
    description: '部落冲突 — 村庄建设、兵种训练、攻城战斗、关卡挑战',
    version: '1.0.0',
    tags: ['game', 'clash', '2d'],
    folder: 'fish',
    renderMode: '2d',
    defaultScene: 'projects/fish/asset/fish_menu.scene.json',
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
          // 单根发现：按 folder 去重后即全量工程列表（mergeProjects 语义，tests/mockProjectBridge.test.ts 锁定）
          set({ projects: mergeProjects(scanned), loading: false })
          return
        }
      }
    } catch {
      // IPC 失败则回退到预设列表
    }
    // 回退：确保预设工程始终在列表中
    const existing = useProjectStore.getState().projects
    const missing = DEFAULT_PROJECTS.filter(p => !existing.some(e => e.folder === p.folder))
    set({ projects: [...existing, ...missing], loading: false })
  },

  setProjects: (projects) => set({ projects }),
}))
