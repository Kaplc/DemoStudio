/**
 * assetLint/checkers/nodeCheckers — 新格式场景节点检查器
 *
 * 旧格式几何节点（box/plane/sphere/sprite/checkerFloor/gridLines/pillar/wallRing）
 * 及其检查器已完全移除——旧格式节点现在会触发 "未注册的检查器" warn，
 * 提醒迁移到新格式（type: actor + baseClass + components）。
 *
 * 保留的新格式节点：
 *   - node:ref    — 引用蓝图资产（ref + position/rotation/scale）
 *   - node:actor  — 内联 Actor（baseClass + components/children 递归）
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { FieldSpec, LintIssue, CheckerContext } from '../types'

/** node:ref — 新格式引用节点：ref 路径必填。position/rotation/scale 代替旧 pos/rot。 */
class RefNodeChecker extends AbstractAssetChecker {
  readonly kind = 'node:ref'
  schema: FieldSpec[] = [
    { field: 'ref', type: 'string', required: true, label: '引用路径' },
    { field: 'position', type: 'vec3', label: '位置' },
    { field: 'rotation', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
    { field: 'name', type: 'string', label: '节点名' },
  ]
  validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    const issues: LintIssue[] = []
    if (!node || typeof node !== 'object') return issues
    const n = node as Record<string, unknown>
    const ref = n.ref as string
    if (ref && !/^(?:[^/]+\/)?asset\/.+\.blueprint\.json$/.test(ref)) {
      issues.push(ctx.issue('ref', 'ref-invalid-path', 'ref 路径格式应为 asset/.../*.blueprint.json', 'error'))
    }
    return issues
  }
}
registerAssetChecker('node:ref', RefNodeChecker)

/** node:actor — 新格式内联 Actor 节点：baseClass 必填，components/children 递归。 */
class ActorNodeChecker extends AbstractAssetChecker {
  readonly kind = 'node:actor'
  schema: FieldSpec[] = [
    { field: 'baseClass', type: 'string', required: true, label: '基类' },
    { field: 'name', type: 'string', label: '节点名' },
    { field: 'position', type: 'vec3', label: '位置' },
    { field: 'rotation', type: 'vec3', label: '旋转' },
    { field: 'scale', type: 'vec3', label: '缩放' },
    { field: 'components', type: 'array', itemsType: 'object', label: '组件列表' },
    { field: 'children', type: 'array', itemsType: 'object', label: '子节点列表' },
  ]
}
registerAssetChecker('node:actor', ActorNodeChecker)
