/**
 * assetLint/checkers/docCheckers — 文档根检查器
 *
 * 校验场景 / 蓝图资产的根结构完整性。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { FieldSpec } from '../types'

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

/** doc:blueprint — 蓝图资产根：id / baseClass 必填。 */
class BlueprintDocChecker extends AbstractAssetChecker {
  readonly kind = 'doc:blueprint'
  schema: FieldSpec[] = [
    { field: 'id', type: 'string', required: true, label: '蓝图 id' },
    { field: 'baseClass', type: 'string', required: true, label: '基类' },
    { field: 'parent', type: 'string', label: '父蓝图' },
  ]
}
registerAssetChecker('doc:blueprint', BlueprintDocChecker)
