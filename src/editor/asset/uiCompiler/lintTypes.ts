/**
 * lintTypes — uiCompiler 与 assetLint 之间的最小公共类型
 *
 * 独立声明（结构兼容 assetLint/types.ts 的 LintIssue），避免编译器直接 import
 * 编辑器 lint 模块（CLI 场景下不可用）。lintBridge 做真实桥接。
 */
export interface LintIssue {
  filePath: string
  nodePath: string
  field: string
  ruleId: string
  severity: 'error' | 'warn'
  message: string
  value?: unknown
}
