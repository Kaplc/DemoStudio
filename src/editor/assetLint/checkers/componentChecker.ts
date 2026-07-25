/**
 * assetLint/checkers/componentChecker — 蓝图 Component 检查器
 *
 * comp:<Component.baseClass>：校验 BlueprintComponentDef.properties 的构造/可配置参数。
 * properties 字段以 'properties.' 前缀（dot 路径）校验。
 * 与 ComponentRegistry key 同源；未覆盖的 component type 由 engine 记一条 warn。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { FieldSpec } from '../types'

/** comp:sprite — width/height 必填 > 0；opacity ∈ [0,1]。 */
class SpriteComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:sprite'
  schema: FieldSpec[] = [
    { field: 'properties.width', type: 'number', required: true, min: 0, minExclusive: true, label: '宽度' },
    { field: 'properties.height', type: 'number', required: true, min: 0, minExclusive: true, label: '高度' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.color', type: 'color', label: '颜色' },
  ]
}
registerAssetChecker('comp:sprite', SpriteComponentChecker)

/** comp:camera — mode 枚举；fov/near/far > 0。 */
class CameraComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:camera'
  schema: FieldSpec[] = [
    { field: 'properties.mode', type: 'string', enum: ['perspective', 'orthographic'], label: '投影模式' },
    { field: 'properties.fov', type: 'number', min: 1, max: 170, label: 'FOV' },
    { field: 'properties.orthoSize', type: 'number', min: 0, minExclusive: true, label: '正交尺寸' },
    { field: 'properties.near', type: 'number', min: 0, minExclusive: true, label: '近裁剪' },
    { field: 'properties.far', type: 'number', min: 0, minExclusive: true, label: '远裁剪' },
    { field: 'properties.priority', type: 'integer', label: '优先级' },
  ]
}
registerAssetChecker('comp:camera', CameraComponentChecker)

/** comp:clickable — clickCooldown ≥ 0。 */
class ClickableComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:clickable'
  schema: FieldSpec[] = [{ field: 'properties.clickCooldown', type: 'number', min: 0, label: '点击冷却' }]
}
registerAssetChecker('comp:clickable', ClickableComponentChecker)

/** comp:mesh — geometry 枚举；size 数组；color；opacity [0,1]。 */
class MeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:mesh'
  schema: FieldSpec[] = [
    { field: 'properties.geometry', type: 'string', enum: ['box', 'sphere', 'plane'], label: '几何类型' },
    { field: 'properties.size', type: 'array', minItems: 1, maxItems: 3, label: '尺寸' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
}
registerAssetChecker('comp:mesh', MeshComponentChecker)
