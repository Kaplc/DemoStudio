/**
 * assetLint/checkers/componentChecker — 蓝图 Component 检查器
 *
 * comp:<Component.type>：校验 BlueprintComponentDef.props 的构造/可配置参数。
 * props 字段以 'props.' 前缀（dot 路径）校验。
 * 与 ComponentRegistry key 同源；未覆盖的 component type 由 engine 记一条 warn。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { FieldSpec } from '../types'

/** comp:sprite — width/height 必填 > 0；opacity ∈ [0,1]。 */
class SpriteComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:sprite'
  schema: FieldSpec[] = [
    { field: 'props.width', type: 'number', required: true, min: 0, minExclusive: true, label: '宽度' },
    { field: 'props.height', type: 'number', required: true, min: 0, minExclusive: true, label: '高度' },
    { field: 'props.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'props.color', type: 'color', label: '颜色' },
  ]
}
registerAssetChecker('comp:sprite', SpriteComponentChecker)

/** comp:camera — mode 枚举；fov/near/far > 0。 */
class CameraComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:camera'
  schema: FieldSpec[] = [
    { field: 'props.mode', type: 'string', enum: ['perspective', 'orthographic'], label: '投影模式' },
    { field: 'props.fov', type: 'number', min: 1, max: 170, label: 'FOV' },
    { field: 'props.orthoSize', type: 'number', min: 0, minExclusive: true, label: '正交尺寸' },
    { field: 'props.near', type: 'number', min: 0, minExclusive: true, label: '近裁剪' },
    { field: 'props.far', type: 'number', min: 0, minExclusive: true, label: '远裁剪' },
    { field: 'props.priority', type: 'integer', label: '优先级' },
  ]
}
registerAssetChecker('comp:camera', CameraComponentChecker)

/** comp:clickable — clickCooldown ≥ 0。 */
class ClickableComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:clickable'
  schema: FieldSpec[] = [{ field: 'props.clickCooldown', type: 'number', min: 0, label: '点击冷却' }]
}
registerAssetChecker('comp:clickable', ClickableComponentChecker)
