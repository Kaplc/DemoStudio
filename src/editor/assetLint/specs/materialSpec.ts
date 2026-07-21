/**
 * assetLint/specs/materialSpec — material 子结构的共享规则
 *
 * materialFieldSpecs：各节点 checker 在自己 schema 里展开 ...materialFieldSpecs 复用，
 *   opacity/kind/color 等规则单点维护，避免每个 checker 重抄。
 * validateMaterialRelations：material 的关系型校验（opacity<1 需配 transparent），
 *   由带 material 的节点 checker 在 validate() 钩子里调用。
 */
import type { FieldSpec, LintIssue, CheckerContext } from '../types'

/** material 字段规则（dot 路径均以 'material.' 开头）。 */
export const materialFieldSpecs: FieldSpec[] = [
  { field: 'material.color', type: 'color', label: '颜色' },
  { field: 'material.kind', type: 'string', enum: ['standard', 'basic'], label: '材质类型' },
  { field: 'material.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
  { field: 'material.roughness', type: 'number', min: 0, max: 1, label: '粗糙度' },
  { field: 'material.metalness', type: 'number', min: 0, max: 1, label: '金属度' },
  { field: 'material.transparent', type: 'boolean', label: '透明' },
  { field: 'material.texture', type: 'string', label: '纹理路径' },
  { field: 'material.castShadow', type: 'boolean', label: '投射阴影' },
  { field: 'material.receiveShadow', type: 'boolean', label: '接收阴影' },
]

/**
 * material 关系校验：opacity<1 时应配 transparent:true，否则渲染不透明。
 * @param node 含 material 的节点
 */
export function validateMaterialRelations(node: unknown, ctx: CheckerContext): LintIssue[] {
  const issues: LintIssue[] = []
  if (!node || typeof node !== 'object') return issues
  const m = (node as Record<string, unknown>).material
  if (m && typeof m === 'object') {
    const opacity = (m as Record<string, unknown>).opacity
    const transparent = (m as Record<string, unknown>).transparent
    if (typeof opacity === 'number' && opacity < 1 && !transparent) {
      issues.push(
        ctx.issue(
          'material.opacity',
          'opacity-needs-transparent',
          `opacity=${opacity} < 1 但未设 transparent:true，渲染将不透明`,
          'warn',
          opacity,
        ),
      )
    }
  }
  return issues
}
