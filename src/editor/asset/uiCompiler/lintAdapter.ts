/**
 * assetLint 接口适配层（uiCompiler 专用）
 *
 * uiCompiler 依赖编辑器侧 assetLint 做"产物零错误"门槛（方案 §6），
 * 但编译器也要能在 Node CLI 跑（无编辑器环境）。本文件隔离 import 方向：
 *  - 环境可用（编辑器渲染进程已加载 assetLint）→ 走真正的 lint
 *  - 环境不可用（Node CLI）→ 返回空结果（lint 门槛由编辑器侧 ui_compile
 *    命令/MCP run_asset_lint 兜底），编译本身不受影响
 */
import type { LintIssue } from './lintTypes'

/** 单资产 lint 结果（结构对齐 assetLint 的 LintIssue） */
export interface WidgetLintResult {
  ok: boolean
  issues: LintIssue[]
}

/**
 * 对单个 widget 文档执行 assetLint（递归校验树 + 组件 schema）。
 * 动态 import 走相对路径：Vite 下编辑器侧打包成功；Node CLI 下解析失败
 * 返回 skip（不阻断编译，门槛由编辑器侧兜底）。
 */
export async function lintWidgetDoc(doc: unknown, filePath: string): Promise<WidgetLintResult> {
  try {
    // 相对引入 assetLint 引擎（编辑器进程内可用）；CLI 环境解析失败 → 降级跳过
    const mod = (await import('./lintBridge').catch(() => null)) as
      | { validateWidgetDoc?: (d: unknown, p: string) => LintIssue[] }
      | null
    if (mod?.validateWidgetDoc) {
      const issues = mod.validateWidgetDoc(doc, filePath)
      return { ok: !issues.some((i) => i.severity === 'error'), issues }
    }
  } catch {
    // CLI 环境：跳过（由编辑器侧兜底）
  }
  return { ok: true, issues: [] }
}
