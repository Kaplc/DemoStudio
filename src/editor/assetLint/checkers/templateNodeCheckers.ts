/**
 * assetLint/checkers/templateNodeCheckers — 模板节点检查器
 *
 * checkerFloor / gridLines / pillar / wallRing：loader 内展开为多几何体的模板；
 * blueprint：场景中引用蓝图的节点（与 doc:blueprint 不冲突，命名空间不同）。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import { materialFieldSpecs, validateMaterialRelations } from '../specs/materialSpec'
import type { FieldSpec, LintIssue, CheckerContext } from '../types'

/** node:checkerFloor — gridSize 必填正整数。 */
class CheckerFloorChecker extends AbstractAssetChecker {
  readonly kind = 'node:checkerFloor'
  schema: FieldSpec[] = [
    { field: 'gridSize', type: 'integer', required: true, min: 0, minExclusive: true, label: '网格大小' },
    { field: 'tileSize', type: 'number', min: 0, minExclusive: true, label: '格大小' },
    { field: 'y', type: 'number', label: '离地高度' },
    ...materialFieldSpecs,
  ]
  validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return validateMaterialRelations(node, ctx)
  }
}
registerAssetChecker('node:checkerFloor', CheckerFloorChecker)

/** node:gridLines — gridSize 必填正整数；opacity ∈ [0,1]。 */
class GridLinesChecker extends AbstractAssetChecker {
  readonly kind = 'node:gridLines'
  schema: FieldSpec[] = [
    { field: 'gridSize', type: 'integer', required: true, min: 0, minExclusive: true, label: '网格大小' },
    { field: 'thickness', type: 'number', min: 0, minExclusive: true, label: '线宽' },
    { field: 'opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'color', type: 'color', label: '颜色' },
    { field: 'y', type: 'number', label: '高度' },
  ]
}
registerAssetChecker('node:gridLines', GridLinesChecker)

/** node:pillar — pos 必填 vec2（地面坐标）。 */
class PillarChecker extends AbstractAssetChecker {
  readonly kind = 'node:pillar'
  schema: FieldSpec[] = [{ field: 'pos', type: 'vec2', required: true, label: '地面坐标' }]
}
registerAssetChecker('node:pillar', PillarChecker)

/** node:wallRing — gridSize 必填正整数；height/thickness > 0。 */
class WallRingChecker extends AbstractAssetChecker {
  readonly kind = 'node:wallRing'
  schema: FieldSpec[] = [
    { field: 'gridSize', type: 'integer', required: true, min: 0, minExclusive: true, label: '网格大小' },
    { field: 'height', type: 'number', min: 0, minExclusive: true, label: '墙高' },
    { field: 'thickness', type: 'number', min: 0, minExclusive: true, label: '墙厚' },
  ]
}
registerAssetChecker('node:wallRing', WallRingChecker)

/** node:blueprint — 场景中引用蓝图的节点：blueprint 引用 id 必填。 */
class BlueprintNodeChecker extends AbstractAssetChecker {
  readonly kind = 'node:blueprint'
  schema: FieldSpec[] = [
    { field: 'blueprint', type: 'number', required: true, label: '蓝图引用' },
    { field: 'pos', type: 'vec3', label: '位置' },
    { field: 'rot', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
  ]
}
registerAssetChecker('node:blueprint', BlueprintNodeChecker)
