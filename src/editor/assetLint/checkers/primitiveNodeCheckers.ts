/**
 * assetLint/checkers/primitiveNodeCheckers — 原子几何节点检查器
 *
 * box / plane / sphere / sprite：校验必填几何参数与值域，复用 material 共享规则
 * （含 opacity<1 需配 transparent 的关系校验）。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import { materialFieldSpecs, validateMaterialRelations } from '../specs/materialSpec'
import type { FieldSpec, LintIssue, CheckerContext } from '../types'

/** node:box — size 必填 vec3 且各分量 > 0。 */
class BoxChecker extends AbstractAssetChecker {
  readonly kind = 'node:box'
  schema: FieldSpec[] = [
    { field: 'size', type: 'vec3', required: true, min: 0, minExclusive: true, label: '尺寸' },
    { field: 'pos', type: 'vec3', label: '位置' },
    { field: 'rot', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
    ...materialFieldSpecs,
  ]
  validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return validateMaterialRelations(node, ctx)
  }
}
registerAssetChecker('node:box', BoxChecker)

/** node:plane — size 必填 vec3（loader 仅用前两位）。 */
class PlaneChecker extends AbstractAssetChecker {
  readonly kind = 'node:plane'
  schema: FieldSpec[] = [
    { field: 'size', type: 'vec3', required: true, label: '尺寸' },
    { field: 'pos', type: 'vec3', label: '位置' },
    { field: 'rot', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
    ...materialFieldSpecs,
  ]
  validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return validateMaterialRelations(node, ctx)
  }
}
registerAssetChecker('node:plane', PlaneChecker)

/** node:sphere — radius 必填 > 0；segments ≥ 3。 */
class SphereChecker extends AbstractAssetChecker {
  readonly kind = 'node:sphere'
  schema: FieldSpec[] = [
    { field: 'radius', type: 'number', required: true, min: 0, minExclusive: true, label: '半径' },
    { field: 'segments', type: 'integer', min: 3, label: '分段' },
    { field: 'pos', type: 'vec3', label: '位置' },
    { field: 'rot', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
    ...materialFieldSpecs,
  ]
  validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return validateMaterialRelations(node, ctx)
  }
}
registerAssetChecker('node:sphere', SphereChecker)

/** node:sprite — size 必填 vec2（宽高）且各分量 > 0。 */
class SpriteChecker extends AbstractAssetChecker {
  readonly kind = 'node:sprite'
  schema: FieldSpec[] = [
    { field: 'size', type: 'vec2', required: true, min: 0, minExclusive: true, label: '宽高' },
    { field: 'pos', type: 'vec3', label: '位置' },
    { field: 'rot', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
    { field: 'texture', type: 'string', label: '纹理' },
    ...materialFieldSpecs,
  ]
  validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return validateMaterialRelations(node, ctx)
  }
}
registerAssetChecker('node:sprite', SpriteChecker)
