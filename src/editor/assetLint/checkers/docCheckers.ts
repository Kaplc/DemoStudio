/**
 * assetLint/checkers/docCheckers — 文档根检查器
 *
 * 校验场景 / 蓝图资产的根结构完整性。
 * 蓝图的 doc:blueprint 校验根及递归校验所有 children/components。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import { validateBySchema } from '../schemaEngine'
import type { CheckerContext, FieldSpec, LintIssue } from '../types'

/** doc:scene — 场景资产根：name 必填、objects 必填非空。 */
class SceneDocChecker extends AbstractAssetChecker {
  readonly kind = 'doc:scene'
  schema: FieldSpec[] = [
    { field: 'name', type: 'string', required: true, label: '场景名' },
    { field: 'mode', type: 'string', label: '模式' },
    { field: 'objects', type: 'array', required: true, itemsType: 'object', label: '对象列表' },
  ]
}
registerAssetChecker('doc:scene', SceneDocChecker)

// ─── 蓝图 child / component 校验规格 ───

/** BlueprintChildDef 字段规格 */
const CHILD_SCHEMA: FieldSpec[] = [
  { field: 'name', type: 'string', label: '子节点名' },
  { field: 'baseClass', type: 'string', label: '子节点基类' },
  { field: 'blueprint', type: 'number', label: '引用蓝图 id' },
  { field: 'id', type: 'number', label: '子节点 id' },
  { field: 'position', type: 'vec3', label: '位置' },
  { field: 'rotation', type: 'vec3', label: '旋转' },
  { field: 'scale', type: 'vec3', label: '缩放' },
  { field: 'components', type: 'array', label: '组件列表' },
  { field: 'children', type: 'array', label: '子 Actor 列表' },
  { field: 'overrides', type: 'object', label: '实例覆盖' },
  { field: '_remove', type: 'boolean', label: '继承移除标记' },
]

/** BlueprintComponentDef 字段规格 */
const COMP_SCHEMA: FieldSpec[] = [
  { field: 'baseClass', type: 'string', required: true, label: '组件类型' },
  { field: 'id', type: 'number', label: '组件 id' },
  { field: 'name', type: 'string', label: '组件名' },
  { field: 'properties', type: 'object', label: '组件属性' },
  { field: '_remove', type: 'boolean', label: '继承移除标记' },
]

/**
 * 递归校验 children 树。
 * @returns 收集到的所有 id（用于根节点做全局重复检测）
 */
function validateChildren(
  children: unknown[],
  ctx: CheckerContext,
  basePath: string,
  seenIds: Set<unknown>,
  issues: LintIssue[],
): void {
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (!c || typeof c !== 'object') {
      issues.push(makeIssue(ctx.filePath, `${basePath}[${i}]`, '', 'child-type', 'error', '子节点必须为对象'))
      continue
    }
    const childPath = `${basePath}[${i}]`
    const child = c as Record<string, unknown>

    // 结构校验
    const childCtx: CheckerContext = {
      filePath: ctx.filePath,
      nodePath: childPath,
      issue: (field, ruleId, message, severity, value) =>
        makeIssue(ctx.filePath, childPath, field, ruleId, severity ?? 'warn', message, value),
    }
    issues.push(...validateBySchema(c, CHILD_SCHEMA, childCtx))

    // baseClass 与 blueprint 互斥
    if (child.baseClass && child.blueprint) {
      issues.push(makeIssue(ctx.filePath, childPath, 'baseClass', 'child-bp-baseclass-conflict', 'error', 'baseClass 与 blueprint 互斥，只能指定一个'))
    }
    // 至少有一个 baseClass 或 blueprint
    if (!child.baseClass && !child.blueprint) {
      issues.push(makeIssue(ctx.filePath, childPath, 'baseClass', 'child-missing-type', 'error', '子节点必须指定 baseClass 或 blueprint'))
    }

    // id 唯一性
    if (child.id !== undefined) {
      if (seenIds.has(child.id)) {
        issues.push(makeIssue(ctx.filePath, childPath, 'id', 'duplicate-child-id', 'error', `id ${child.id} 与同文件其他节点重复`, child.id))
      } else {
        seenIds.add(child.id)
      }
    }

    // 递归校验 components
    if (Array.isArray(child.components)) {
      validateComponents(child.components, ctx, `${childPath}.components`, issues)
    }

    // 递归校验嵌套 children
    if (Array.isArray(child.children)) {
      validateChildren(child.children, ctx, `${childPath}.children`, seenIds, issues)
    }
  }
}

/** 校验 components 数组 */
function validateComponents(
  comps: unknown[],
  ctx: CheckerContext,
  basePath: string,
  issues: LintIssue[],
): void {
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i]
    if (!c || typeof c !== 'object') {
      issues.push(makeIssue(ctx.filePath, `${basePath}[${i}]`, '', 'comp-type', 'error', '组件必须为对象'))
      continue
    }
    const compPath = `${basePath}[${i}]`
    const compCtx: CheckerContext = {
      filePath: ctx.filePath,
      nodePath: compPath,
      issue: (field, ruleId, message, severity, value) =>
        makeIssue(ctx.filePath, compPath, field, ruleId, severity ?? 'warn', message, value),
    }
    issues.push(...validateBySchema(c, COMP_SCHEMA, compCtx))
  }
}

/** 构造 LintIssue（避免 ctx.issue 闭包锁死原 nodePath） */
function makeIssue(
  filePath: string,
  nodePath: string,
  field: string,
  ruleId: string,
  severity: 'error' | 'warn',
  message: string,
  value?: unknown,
): LintIssue {
  return { filePath, nodePath, field, ruleId, severity, message, value }
}

/** doc:blueprint — 蓝图资产根校验。递归检查 children/components 完整性。 */
class BlueprintDocChecker extends AbstractAssetChecker {
  readonly kind = 'doc:blueprint'
  schema: FieldSpec[] = [
    { field: 'id', type: 'number', required: true, label: '蓝图 id' },
    { field: 'baseClass', type: 'string', required: true, label: '基类' },
    { field: 'parent', type: 'number', label: '父蓝图 id' },
    { field: 'position', type: 'vec3', label: '位置' },
    { field: 'rotation', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
    { field: 'components', type: 'array', label: '组件列表' },
    { field: 'children', type: 'array', label: '子 Actor 列表' },
  ]

  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    const issues: LintIssue[] = []
    if (!node || typeof node !== 'object') return issues
    const root = node as Record<string, unknown>
    const seenIds = new Set<unknown>()
    if (root.id !== undefined) seenIds.add(root.id)

    // 校验根级 components
    if (Array.isArray(root.components)) {
      validateComponents(root.components, ctx, 'components', issues)
    }

    // 递归校验 children（含 id 唯一性 + 子级 components）
    if (Array.isArray(root.children)) {
      validateChildren(root.children, ctx, 'children', seenIds, issues)
    }

    return issues
  }
}
registerAssetChecker('doc:blueprint', BlueprintDocChecker)
