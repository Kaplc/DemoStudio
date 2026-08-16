/**
 * useCodeLintStore — 代码扫描检查器 UI 状态（独立 store）
 *
 * 与 editorStore 分离：本 store 只持 codeLint 的瞬时运行时态。
 * - engine 每次扫描完成后整体覆盖 issues（面板订阅渲染全量）
 * - panelOpen 控制悬浮 tips 面板展开；engine 首扫有 issue 时自动置 true，
 *   用户手动 X 收起 / 状态栏入口切换
 */
import { create } from 'zustand'
import type { CodeIssue } from '../editor/codeLint/types'

interface CodeLintState {
  /** 最近一次扫描的全部违规（全量渲染）。 */
  issues: CodeIssue[]
  /** tips 悬浮面板展开状态。 */
  panelOpen: boolean
  /** 整体覆盖 issues（engine 扫描完成时调用）。 */
  setIssues: (issues: CodeIssue[]) => void
  /** 手动切换面板展开/收起。 */
  setPanelOpen: (open: boolean) => void
  /** 重置（切换工程时清空旧工程数据）。 */
  reset: () => void
}

export const useCodeLintStore = create<CodeLintState>()((set) => ({
  issues: [],
  panelOpen: false,
  setIssues: (issues) => set({ issues }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  reset: () => set({ issues: [], panelOpen: false }),
}))
