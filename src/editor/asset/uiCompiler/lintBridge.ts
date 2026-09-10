/**
 * lintBridge — uiCompiler → assetLint 真实桥接（编辑器环境内生效）
 *
 * 把 assetLint 对单个 widget 文档的校验逻辑（walk + checker 派发）包装成同步函数。
 * 仅在编辑器渲染进程（assetLint 模块已加载）可用；Node CLI 下动态 import 失败，
 * 由 lintAdapter 降级跳过。
 */
import { walkDocument, shouldRunUiDesignCheck } from '../assetLint/AssetWalker'
import { getChecker, resolveChecker } from '../assetLint/AssetCheckerRegistry'
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
    // 三态解析（与 AssetLintEngine.validateDoc 共用唯一策略）：
    // checker 命中 → 校验；工厂合法但无 lint schema → warn；完全未知 → error（拦截落盘）
    const res = resolveChecker(t.kind)
    if (res.type === 'schemaless') {
      issues.push({
        filePath, nodePath: t.nodePath, field: '-', ruleId: 'comp-no-lint-schema', severity: 'warn',
        message: `组件 "${res.baseClass}" 合法（工厂已注册）但无 assetLint schema——properties 不做校验；建议补 comp:${res.baseClass} 检查器`,
      })
      continue
    }
    if (res.type === 'unknown') {
      issues.push({
        filePath, nodePath: t.nodePath, field: '-', ruleId: 'unknown-kind', severity: 'error',
        message: `未注册的检查器 '${t.kind}'（既无 lint 检查器也无组件工厂注册——旧格式或未知类型）`,
      })
      continue
    }
    const ctx = {
      filePath,
      nodePath: t.nodePath,
      issue: (field: string, ruleId: string, message: string, severity: 'error' | 'warn' = 'warn', value?: unknown) =>
        ({ filePath, nodePath: t.nodePath, field, ruleId, severity, message, value }),
    }
    issues.push(...res.checker.run(t.node, ctx))
  }

  // UI 资产（widget 产物 / 含 CanvasUIComponent 的 UI 蓝图）：额外跑 UI 设计级检查
  // （触发条件与 AssetLintEngine.validateDoc 一致；issue 定位由检查器内部按节点名链覆写）
  if (shouldRunUiDesignCheck(filePath, rootKind, doc)) {
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
