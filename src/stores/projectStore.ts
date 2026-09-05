import { create } from 'zustand'
import type { Project } from './editorStore'
import { mergeProjects } from './projectMerge'

interface ProjectStore {
  projects: Project[]
  loading: boolean

  discoverProjects: () => Promise<void>
  setProjects: (projects: Project[]) => void
}

// 预设示例工程
const DEFAULT_PROJECTS: Project[] = [
  {
    name: 'Demo2D',
    description: '2D 正交相机 + Sprite 演示（移动收集金币）',
    version: '1.0.0',
    tags: ['game', '2d', 'sprite'],
    folder: 'demo2d',
    source: 'builtin',
    renderMode: '2d',
    defaultScene: 'src/projects/demo2d/demo2d.scene.json',
  },
  {
    name: 'ClashMaster',
    description: '部落冲突 — 村庄建设、兵种训练、攻城战斗、关卡挑战',
    version: '1.0.0',
    tags: ['game', 'clash', '2d'],
    folder: 'fish',
    source: 'builtin',
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
          // 双轨合并：内置在前（根序），外部同名覆盖内置（mergeProjects 语义，tests/externalRoots.test.ts 锁定）。
          // source 缺省（旧 IPC）视为内置，向后兼容。
          const external = scanned.filter(p => p.source === 'external')
          const builtin = scanned.filter(p => p.source !== 'external')
          set({ projects: mergeProjects(builtin, external), loading: false })
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
