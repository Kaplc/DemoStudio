/**
 * lintBridge — uiCompiler → assetLint 真实桥接（编辑器环境内生效）
 *
 * 把 assetLint 对单个 widget 文档的校验逻辑（walk + checker 派发）包装成同步函数。
 * 仅在编辑器渲染进程（assetLint 模块已加载）可用；Node CLI 下动态 import 失败，
 * 由 lintAdapter 降级跳过。
 */
import { walkDocument } from '../assetLint/AssetWalker'
import { getChecker } from '../assetLint/AssetCheckerRegistry'
import type { LintIssue } from '../assetLint/types'
import type { LintIssue as CompilerLintIssue } from './lintTypes'

/** 对单个 widget 文档执行 assetLint（doc:blueprint + comp:* + doc:ui-design）。 */
export function validateWidgetDoc(doc: unknown, filePath: string): CompilerLintIssue[] {
  const issues: LintIssue[] = []
  const { rootKind, tasks } = walkDocument(doc)

  if (!rootKind) {
    issues.push({
      filePath, nodePath: '<根>', field: '-', ruleId: 'unknown-doc', severity: 'warn',
      message: '无法识别文档根（既非 scene 也非 blueprint）',
    })
    return issues
  }

  for (const t of tasks) {
    const checker = getChecker(t.kind)
    if (!checker) continue
    const ctx = {
      filePath,
      nodePath: t.nodePath,
      issue: (field: string, ruleId: string, message: string, severity: 'error' | 'warn' = 'warn', value?: unknown) =>
        ({ filePath, nodePath: t.nodePath, field, ruleId, severity, message, value }),
    }
    issues.push(...checker.run(t.node, ctx))
  }

  // widget 资产：额外跑 UI 设计级检查（与 AssetLintEngine.validateDoc 一致）
  if (filePath.endsWith('.widget.json')) {
    const designChecker = getChecker('doc:ui-design')
    if (designChecker) {
      issues.push(...designChecker.run(doc, {
        filePath,
        nodePath: '<widget 根>',
        issue: (field: string, ruleId: string, message: string, severity: 'error' | 'warn' = 'warn', value?: unknown) =>
          ({ filePath, nodePath: '<widget 根>', field, ruleId, severity, message, value }),
      }))
    }
  }

  return issues as CompilerLintIssue[]
}
