/**
 * assetLint/checkers/docCheckers — 文档根检查器
 *
 * 校验场景 / 蓝图资产的根结构完整性。
 * 蓝图的 doc:blueprint 校验根及递归校验所有 children/components。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker, getChecker } from '../AssetCheckerRegistry'
import { validateBySchema, validateUnknownProperties } from '../schemaEngine'
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
  { field: 'id', type: 'number', required: true, label: '子节点 id' },
  { field: 'position', type: 'vec3', label: '位置' },
  { field: 'rotation', type: 'vec3', label: '旋转' },
  { field: 'scale', type: 'vec3', label: '缩放' },
  { field: 'components', type: 'array', label: '组件列表' },
  { field: 'children', type: 'array', label: '子 Actor 列表' },
  { field: 'blueprint', type: 'number', label: '引用蓝图 id' },
  { field: 'ref', type: 'string', label: '引用资产文件' },
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

/** 判断组件是否为 mesh 组件（MeshComponent / CapsuleMeshComponent 及子类） */
export function isMeshBaseClass(baseClass: string): boolean {
  return baseClass === 'MeshComponent' || baseClass.endsWith('MeshComponent')
}

/**
 * 统计组件数组中 mesh 组件的数量（一个 Actor 只能挂一个 mesh，组合用子 Actor）。
 * 返回 >1 时调用方应报 error（node:actor / doc:blueprint 均调用）。
 */
export function countMeshComponents(comps: unknown[] | undefined): number {
  if (!Array.isArray(comps)) return 0
  return comps.filter((c) => {
    if (!c || typeof c !== 'object') return false
    const bc = (c as Record<string, unknown>).baseClass
    return typeof bc === 'string' && isMeshBaseClass(bc)
  }).length
}

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

    // ref / baseClass 两者互斥
    const hasRef = !!child.ref
    const hasBase = !!child.baseClass
    if (hasRef && hasBase) {
      issues.push(makeIssue(ctx.filePath, childPath, 'baseClass', 'child-bp-ref-conflict', 'error', 'ref / baseClass 互斥，只能指定一个'))
    }
    if (!hasRef && !hasBase) {
      issues.push(makeIssue(ctx.filePath, childPath, 'baseClass', 'child-missing-type', 'error', '子节点必须指定 ref / baseClass 之一'))
    }

    // ref 路径合理性检查：需指向已有的资产文件（格式 asset/.../*.blueprint.json，可带 project 前缀）
    if (hasRef) {
      const refPath = child.ref as string
      if (!/^(?:[^/]+\/)?asset\/.+\.blueprint\.json$/.test(refPath)) {
        issues.push(makeIssue(ctx.filePath, childPath, 'ref', 'ref-invalid-path', 'error', 'ref 路径格式应为 asset/.../*.blueprint.json'))
      }
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
      // 顶层 transform 与 TransformComponent/UITransformComponent 组件一致性：以组件为权威，不一致 → error，一致 → warn
      checkTopTransformMismatch(child, childPath, ctx, issues)
    } else {
      // 无组件节点：位置必须由 TransformComponent/UITransformComponent 组件承载，顶层 position/rotation/scale 是废弃格式
      checkMissingTransformComponent(child, childPath, ctx, issues)
    }

    // 递归校验嵌套 children
    if (Array.isArray(child.children)) {
      validateChildren(child.children, ctx, `${childPath}.children`, seenIds, issues)
    }
  }
}

/**
 * 组件优先约定：节点必须用 TransformComponent/UITransformComponent 组件承载位置。
 * 无变换组件却声明了顶层 position/rotation/scale → error（旧格式兜底已废弃）。
 */
function checkMissingTransformComponent(
  child: Record<string, unknown>,
  childPath: string,
  ctx: CheckerContext,
  issues: LintIssue[],
): void {
  const topFields = (['position', 'rotation', 'scale'] as const).filter((k) => child[k] !== undefined)
  if (topFields.length === 0) return // 纯容器节点，合法
  issues.push(makeIssue(
    ctx.filePath, childPath, topFields[0], 'missing-transform-component', 'error',
    `节点缺少 TransformComponent/UITransformComponent 组件，但声明了顶层 ${topFields.join('/')}：位置必须写在组件（组件优先约定，旧格式已废弃）`,
    child[topFields[0]],
  ))
}

/** 向量逐分量容差比较（一致 → true）。 */
/**
 * 顶层 transform 禁止检查（组件优先约定，旧格式已废弃）。
 * 节点含 TransformComponent/UITransformComponent 组件时，位置以组件 properties 为权威；
 * 顶层 position/rotation/scale 字段无论值如何一律禁止 → error。
 * 无变换组件时由 checkMissingTransformComponent 单独处理。
 */
function checkTopTransformMismatch(
  child: Record<string, unknown>,
  childPath: string,
  ctx: CheckerContext,
  issues: LintIssue[],
): void {
  const comps = child.components
  if (!Array.isArray(comps)) return
  const hasTsf = (comps as Array<Record<string, unknown>>).some(
    (c) => c && (c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent'),
  )
  if (!hasTsf) return
  for (const k of ['position', 'rotation', 'scale'] as const) {
    const top = child[k]
    if (top === undefined) continue // 新格式：顶层缺失，正常
    issues.push(makeIssue(
      ctx.filePath, childPath, k, 'top-transform-forbidden', 'error',
      `顶层 ${k} ${JSON.stringify(top)} 已废弃：位置必须写在 TransformComponent/UITransformComponent 组件（组件优先约定），请删除顶层 ${k} 字段`,
      top,
    ))
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

    const comp = c as Record<string, unknown>
    const baseClass = typeof comp.baseClass === 'string' ? comp.baseClass : ''
    const props = comp.properties

    // 位置/旋转/缩放只允许出现在 TransformComponent/UITransformComponent（tsf）组件，其他组件一律禁止
    if (props && typeof props === 'object' && !Array.isArray(props)) {
      const isTransformComp = baseClass === 'TransformComponent' || baseClass === 'UITransformComponent'
      if (!isTransformComp) {
        for (const k of ['position', 'rotation', 'scale']) {
          if (k in (props as Record<string, unknown>)) {
            issues.push(makeIssue(
              ctx.filePath, compPath, `properties.${k}`, 'comp-forbidden-transform', 'error',
              `属性 "properties.${k}" 只允许出现在 TransformComponent/UITransformComponent 组件，不允许出现在 ${baseClass} 组件`,
              (props as Record<string, unknown>)[k],
            ))
          }
        }
      }
      // 未知属性检查：按该组件类型注册的 schema 校验 properties 里没有的字段
      const checker = getChecker(`comp:${baseClass}` as never)
      const compSchema = checker?.schema ?? []
      issues.push(...validateUnknownProperties(props, compSchema, compCtx))
    }
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

/**
 * 递归检查 children 树：每个子节点的组件中 mesh 组件（MeshComponent/CapsuleMeshComponent）
 * 数量 > 1 → error（一个 Actor 只能挂一个 mesh，组合网格请拆子 Actor）。
 */
function checkChildrenMeshCount(
  nodes: unknown[],
  ctx: CheckerContext,
  basePath: string,
  issues: LintIssue[],
): void {
  for (let i = 0; i < nodes.length; i++) {
    const c = nodes[i]
    if (!c || typeof c !== 'object') continue
    const childPath = `${basePath}[${i}]`
    const child = c as Record<string, unknown>
    const count = countMeshComponents(child.components as unknown[])
    if (count > 1) {
      issues.push(makeIssue(ctx.filePath, childPath, 'components', 'multi-mesh-component', 'error',
        `子节点 "${(child.name as string) ?? i}" 声明了 ${count} 个 mesh 组件（一个 Actor 只能挂载一个 MeshComponent，组合网格请拆成子 Actor）`))
    }
    if (Array.isArray(child.children)) {
      checkChildrenMeshCount(child.children, ctx, `${childPath}.children`, issues)
    }
  }
}

/**
 * 递归校验 name 唯一性（同一资产内 name 必须唯一）。
 * AI 按 name 定位控件（ai.clickActor / ai.dragActor / ai.selectActor），重复名会导致定位歧义。
 */
function validateNameUniqueness(
  nodes: unknown[],
  ctx: CheckerContext,
  basePath: string,
  seenNames: Map<string, string>,
  issues: LintIssue[],
): void {
  for (let i = 0; i < nodes.length; i++) {
    const c = nodes[i]
    if (!c || typeof c !== 'object') continue
    const childPath = `${basePath}[${i}]`
    const child = c as Record<string, unknown>
    if (typeof child.name === 'string' && child.name) {
      const prev = seenNames.get(child.name)
      if (prev !== undefined) {
        issues.push(makeIssue(
          ctx.filePath, childPath, 'name', 'duplicate-name', 'error',
          `name "${child.name}" 与 ${prev} 重复：同一资产内 name 必须唯一（AI 按 name 定位控件）`,
          child.name,
        ))
      } else {
        seenNames.set(child.name, childPath)
      }
    }
    if (Array.isArray(child.children)) {
      validateNameUniqueness(child.children, ctx, `${childPath}.children`, seenNames, issues)
    }
  }
}

/** doc:blueprint — 蓝图资产根校验。递归检查 children/components 完整性。 */
class BlueprintDocChecker extends AbstractAssetChecker {
  readonly kind = 'doc:blueprint'
  schema: FieldSpec[] = [
    { field: 'name', type: 'string', required: true, label: '蓝图名' },
    { field: 'baseClass', type: 'string', required: true, label: '基类' },
    { field: 'components', type: 'array', required: true, label: '组件列表' },
    { field: 'children', type: 'array', required: true, label: '子 Actor 列表' },
    // 新格式（组件优先）：顶层 position/rotation/scale 已废弃，不再声明（存在由 validate 报错）
  ]

  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    const issues: LintIssue[] = []
    if (!node || typeof node !== 'object') return issues
    const root = node as Record<string, unknown>
    const seenIds = new Set<unknown>()
    if (root.id !== undefined) seenIds.add(root.id)
    if (Array.isArray(root.components)) {
      validateComponents(root.components, ctx, 'components', issues)
      // 根级顶层 transform 与 tsf 组件一致性
      checkTopTransformMismatch(root, '<根>', ctx, issues)
    } else {
      // 根节点无组件但带顶层 position/rotation/scale → error
      checkMissingTransformComponent(root, '<根>', ctx, issues)
    }

    // 一个 Actor 只能挂一个 mesh（组合网格拆子 Actor）：
    // 根节点组件多 mesh → error
    const rootMeshCount = countMeshComponents(root.components as unknown[])
    if (rootMeshCount > 1) {
      issues.push(makeIssue(ctx.filePath, '<根>', 'components', 'multi-mesh-component', 'error',
        `根节点声明了 ${rootMeshCount} 个 mesh 组件（一个 Actor 只能挂载一个 MeshComponent，组合网格请拆成子 Actor）`))
    }
    // 递归 children：每个子节点的组件多 mesh → error
    if (Array.isArray(root.children)) {
      checkChildrenMeshCount(root.children, ctx, 'children', issues)
    }

    // 递归校验 children（含 id 唯一性 + 子级 components）
    if (Array.isArray(root.children)) {
      validateChildren(root.children, ctx, 'children', seenIds, issues)
    }

    // name 唯一性：同一资产内 name 必须唯一（AI 按 name 定位控件）
    const seenNames = new Map<string, string>()
    if (typeof root.name === 'string' && root.name) seenNames.set(root.name, '<根>')
    if (Array.isArray(root.children)) {
      validateNameUniqueness(root.children, ctx, 'children', seenNames, issues)
    }

    return issues
  }
}
registerAssetChecker('doc:blueprint', BlueprintDocChecker)
