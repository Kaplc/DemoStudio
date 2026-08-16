/**
 * useCodeLintStore — 代码/资产扫描检查器 UI 状态（独立 store）
 *
 * 与 editorStore 分离：本 store 只持代码检查（CodeLint）与资产检查（AssetLint）的
 * 瞬时运行时态。两类检查共用右下角状态栏入口与悬浮 tips 面板：
 * - issues：代码违规（CodeLintEngine 扫描 src/ 产出，整体覆盖）
 * - assetIssues：资产违规（AssetLintEngine 扫描 asset/ 产出，整体覆盖）
 * - panelOpen 控制悬浮 tips 面板展开；engine 首扫有 issue 时自动置 true，
 *   用户手动 X 收起 / 状态栏入口切换
 */
import { create } from 'zustand'
import type { CodeIssue } from '../editor/codeLint/types'

/** 资产检查问题视图（AssetLint LintIssue → 面板展示用扁平结构） */
export interface AssetIssueView {
  /** 资产文件相对路径（如 asset/blueprints/ui/xxx.widget.json） */
  file: string
  /** 节点定位（nodePath，如 <根> / CardList / comp:UITextComponent） */
  nodePath: string
  /** 违规字段 */
  field: string
  /** 规则 id（checker kind 或 schema ruleId） */
  rule: string
  /** 严重级别 */
  severity: 'error' | 'warn'
  /** 人类可读的违规描述 */
  message: string
}

interface CodeLintState {
  /** 最近一次代码扫描的全部违规（全量渲染）。 */
  issues: CodeIssue[]
  /** 最近一次资产扫描的全部违规（全量渲染）。 */
  assetIssues: AssetIssueView[]
  /** tips 悬浮面板展开状态。 */
  panelOpen: boolean
  /** 整体覆盖代码 issues（CodeLintEngine 扫描完成时调用）。 */
  setIssues: (issues: CodeIssue[]) => void
  /** 整体覆盖资产 issues（AssetLintEngine 扫描完成时调用）。 */
  setAssetIssues: (issues: AssetIssueView[]) => void
  /** 手动切换面板展开/收起。 */
  setPanelOpen: (open: boolean) => void
  /** 重置（切换工程时清空旧工程数据）。 */
  reset: () => void
}

export const useCodeLintStore = create<CodeLintState>()((set) => ({
  issues: [],
  assetIssues: [],
  panelOpen: false,
  setIssues: (issues) => set({ issues }),
  setAssetIssues: (assetIssues) => set({ assetIssues }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  reset: () => set({ issues: [], assetIssues: [], panelOpen: false }),
}))
