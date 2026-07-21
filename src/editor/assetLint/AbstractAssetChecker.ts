/**
 * assetLint/AbstractAssetChecker — 检查器基类
 *
 * 声明式 schema 驱动：子类只需声明 schema: FieldSpec[]，run() 自动跑 schema 校验；
 * 复杂关系校验（如 opacity<1 需配 transparent）可覆写 validate() 追加 issue。
 *
 * 新增检查器类型：extends 本类 + 在模块末尾 registerAssetChecker(kind, Cls)。
 */
import type { FieldSpec, LintIssue, CheckerContext } from './types'
import { validateBySchema } from './schemaEngine'

export abstract class AbstractAssetChecker {
  /** 派发键（与注册时的 kind 一致，仅用于诊断）。 */
  abstract readonly kind: string

  /** 声明式字段规则；默认空，子类覆写。 */
  schema: FieldSpec[] = []

  /** 主入口：schema 校验 + 子类关系校验，合并返回。 */
  run(node: unknown, ctx: CheckerContext): LintIssue[] {
    const schemaIssues = validateBySchema(node, this.schema, ctx)
    const customIssues = this.validate ? this.validate(node, ctx) : []
    return [...schemaIssues, ...customIssues]
  }

  /** 可选钩子：关系型 / 跨字段 / 跨资产校验。 */
  validate?(node: unknown, ctx: CheckerContext): LintIssue[]
}
