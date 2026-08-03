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

/** comp:SpriteComponent — width/height 必填 > 0；opacity ∈ [0,1]。 */
class SpriteComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:SpriteComponent'
  schema: FieldSpec[] = [
    { field: 'properties.width', type: 'number', required: true, min: 0, minExclusive: true, label: '宽度' },
    { field: 'properties.height', type: 'number', required: true, min: 0, minExclusive: true, label: '高度' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:SpriteComponent', SpriteComponentChecker)

/** comp:TransformComponent — 变换组件：位置/旋转/缩放均为 vec3（唯一允许 position/rotation/scale 的组件之一）。 */
class TransformComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:TransformComponent'
  schema: FieldSpec[] = [
    { field: 'properties.position', type: 'vec3', label: '位置' },
    { field: 'properties.rotation', type: 'vec3', label: '旋转' },
    { field: 'properties.scale', type: 'vec3', label: '缩放' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:TransformComponent', TransformComponentChecker)

/** comp:UITransformComponent — UI 专用变换组件：变换 + 尺寸 + 九宫格锚点（Unity RectTransform 风格）。 */
class UITransformComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UITransformComponent'
  schema: FieldSpec[] = [
    { field: 'properties.position', type: 'vec3', label: '位置' },
    { field: 'properties.rotation', type: 'vec3', label: '旋转' },
    { field: 'properties.scale', type: 'vec3', label: '缩放' },
    { field: 'properties.worldWidth', type: 'number', min: 0, minExclusive: true, label: '世界宽' },
    { field: 'properties.worldHeight', type: 'number', min: 0, minExclusive: true, label: '世界高' },
    {
      field: 'properties.anchor',
      type: 'string',
      enum: [
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-center', 'center', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
        'stretch',
      ],
      label: '锚点',
    },
    { field: 'properties.anchorOffset', type: 'vec2', label: '锚点偏移' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UITransformComponent', UITransformComponentChecker)

/** comp:CameraComponent — mode 枚举；fov/near/far > 0。 */
class CameraComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:CameraComponent'
  schema: FieldSpec[] = [
    { field: 'properties.mode', type: 'string', enum: ['perspective', 'orthographic'], label: '投影模式' },
    { field: 'properties.fov', type: 'number', min: 1, max: 170, label: 'FOV' },
    { field: 'properties.orthoSize', type: 'number', min: 0, minExclusive: true, label: '正交尺寸' },
    { field: 'properties.near', type: 'number', min: 0, minExclusive: true, label: '近裁剪' },
    { field: 'properties.far', type: 'number', min: 0, minExclusive: true, label: '远裁剪' },
    { field: 'properties.priority', type: 'integer', label: '优先级' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:CameraComponent', CameraComponentChecker)

/** comp:ClickableComponent — clickCooldown ≥ 0。 */
class ClickableComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:ClickableComponent'
  schema: FieldSpec[] = [
    { field: 'properties.clickCooldown', type: 'number', min: 0, label: '点击冷却' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:ClickableComponent', ClickableComponentChecker)

/** comp:MeshComponent — geometry 枚举；size 数组；color；opacity [0,1]。 */
class MeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:MeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.geometry', type: 'string', enum: ['box', 'sphere', 'plane'], label: '几何类型' },
    { field: 'properties.size', type: 'array', minItems: 1, maxItems: 3, label: '尺寸' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
}
registerAssetChecker('comp:MeshComponent', MeshComponentChecker)

/** comp:TroikaTextComponent — 3D 文本：text/字号/颜色/对齐/描边。 */
class TroikaTextComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:TroikaTextComponent'
  schema: FieldSpec[] = [
    { field: 'properties.text', type: 'string', label: '文本内容' },
    { field: 'properties.fontSize', type: 'number', min: 0, minExclusive: true, label: '字号' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.maxWidth', type: 'number', min: 0, minExclusive: true, label: '最大宽度' },
    { field: 'properties.textAlign', type: 'string', enum: ['left', 'center', 'right'], label: '对齐' },
    { field: 'properties.outlineWidth', type: 'number', min: 0, label: '描边宽度' },
    { field: 'properties.outlineColor', type: 'color', label: '描边颜色' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:TroikaTextComponent', TroikaTextComponentChecker)

/** comp:UITextComponent — 文本属性 + 字体参数 + UI 定位 */
class UITextComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UITextComponent'
  schema: FieldSpec[] = [
    { field: 'properties.text', type: 'string', label: '文本内容' },
    { field: 'properties.fontSize', type: 'number', min: 1, label: '字号' },
    { field: 'properties.fontFamily', type: 'string', label: '字体' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.bold', type: 'boolean', label: '加粗' },
    { field: 'properties.italic', type: 'boolean', label: '斜体' },
    { field: 'properties.align', type: 'string', enum: ['left', 'center', 'right'], label: '对齐' },
    { field: 'properties.lineHeight', type: 'number', min: 0, minExclusive: true, label: '行高' },
    { field: 'properties.letterSpacing', type: 'number', min: 0, label: '字间距' },
    { field: 'properties.shadowColor', type: 'color', label: '阴影色' },
    { field: 'properties.shadowBlur', type: 'number', min: 0, label: '阴影模糊' },
    { field: 'properties.shadowOffsetX', type: 'number', label: '阴影 X 偏移' },
    { field: 'properties.shadowOffsetY', type: 'number', label: '阴影 Y 偏移' },
    { field: 'properties.width', type: 'number', min: 1, label: 'Canvas 像素宽' },
    { field: 'properties.height', type: 'number', min: 1, label: 'Canvas 像素高' },
    { field: 'properties.zOrder', type: 'number', label: 'UI 层级' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UITextComponent', UITextComponentChecker)

/** comp:UIImageComponent — 颜色/圆角/不透明度/图片源 + UI 定位 */
class UIImageComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIImageComponent'
  schema: FieldSpec[] = [
    { field: 'properties.color', type: 'color', label: '填充色' },
    { field: 'properties.radius', type: 'number', min: 0, label: '圆角' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.src', type: 'string', label: '图片源' },
    { field: 'properties.width', type: 'number', min: 1, label: 'Canvas 像素宽' },
    { field: 'properties.height', type: 'number', min: 1, label: 'Canvas 像素高' },
    { field: 'properties.zOrder', type: 'number', label: 'UI 层级' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIImageComponent', UIImageComponentChecker)

/** comp:UIButtonComponent — 按钮纯交互组件（状态色映射 colors；背景渲染由同 Actor 的 uiimage 提供） */
class UIButtonComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIButtonComponent'
  schema: FieldSpec[] = [
    { field: 'properties.colors', type: 'object', label: '状态色映射' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIButtonComponent', UIButtonComponentChecker)

/** comp:CanvasUIComponent — UI 画布根组件（像素画布 + 世界尺寸 + UI 层级 + 标记模式） */
class CanvasUIComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:CanvasUIComponent'
  schema: FieldSpec[] = [
    { field: 'properties.width', type: 'number', min: 1, label: 'Canvas 像素宽' },
    { field: 'properties.height', type: 'number', min: 1, label: 'Canvas 像素高' },
    { field: 'properties.doubleSided', type: 'boolean', label: '双面可见' },
    { field: 'properties.zOrder', type: 'number', label: 'UI 层级' },
    { field: 'properties.markerOnly', type: 'boolean', label: '仅标记模式（不渲染）' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:CanvasUIComponent', CanvasUIComponentChecker)
