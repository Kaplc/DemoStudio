/**
 * editorPrefsStore — 编辑器偏好（持久化）
 *
 * 与 editorStore 分离：后者持有瞬时运行时态（gameState/consoleOutput/launchCount），
 * 不应落盘；本 store 全部字段持久化到 localStorage（zustand persist 默认同步 rehydrate）。
 * 布局宽高从 App.tsx 迁入、viewport 偏好从 Viewport.tsx 迁入、面板可见性从 editorStore 迁入。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PanelId } from './editorStore'

export type ViewportTab = 'scene' | 'game'

interface EditorPrefs {
  // ─── 面板与布局 ───
  panels: Record<PanelId, { visible: boolean }>
  consoleVisible: boolean
  layout: { left: number; right: number; console: number }
  viewport: { activeTab: ViewportTab; aspectRatio: string; gizmos: boolean }

  // ─── 项目记忆 ───
  lastProjectFolder: string | null
  recentProjects: string[]

  // ─── Actions ───
  togglePanel: (p: PanelId) => void
  toggleConsole: () => void
  setLayout: (k: keyof EditorPrefs['layout'], v: number) => void
  setViewport: (patch: Partial<EditorPrefs['viewport']>) => void
  setLastProject: (folder: string) => void
  pushRecent: (folder: string) => void
}

export const useEditorPrefsStore = create<EditorPrefs>()(
  persist(
    (set) => ({
      panels: {
        scene: { visible: true },
        game: { visible: true },
        inspector: { visible: true },
        console: { visible: true },
        project: { visible: true },
      },
      consoleVisible: false,
      layout: { left: 220, right: 280, console: 180 },
      viewport: { activeTab: 'scene', aspectRatio: '16/9', gizmos: true },
      lastProjectFolder: null,
      recentProjects: [],

      togglePanel: (p) =>
        set((s) => ({ panels: { ...s.panels, [p]: { visible: !s.panels[p].visible } } })),
      toggleConsole: () => set((s) => ({ consoleVisible: !s.consoleVisible })),
      setLayout: (k, v) => set((s) => ({ layout: { ...s.layout, [k]: v } })),
      setViewport: (patch) => set((s) => ({ viewport: { ...s.viewport, ...patch } })),
      setLastProject: (folder) => set({ lastProjectFolder: folder }),
      pushRecent: (folder) =>
        set((s) => ({
          recentProjects: [folder, ...s.recentProjects.filter((f) => f !== folder)].slice(0, 10),
        })),
    }),
    { name: 'demostudio-editor-prefs' },
  ),
)
