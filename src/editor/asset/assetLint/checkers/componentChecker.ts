/**
 * assetLint/checkers/componentChecker — 蓝图 Component 检查器
 *
 * comp:<Component.baseClass>：校验 BlueprintComponentDef.properties 的构造/可配置参数。
 * properties 字段以 'properties.' 前缀（dot 路径）校验。
 * 与 ComponentRegistry key 同源；未覆盖的 component type 由 engine 记一条 warn。
 */
import { AbstractAssetChecker } from '../AbstractAssetChecker'
import { registerAssetChecker } from '../AssetCheckerRegistry'
import type { FieldSpec, LintIssue, CheckerContext } from '../types'
import { UILAYOUT_JUSTIFY_OPTIONS, UILAYOUT_ALIGN_OPTIONS } from '../../../../engine/ui/UILayoutComponent'

/**
 * TC-S10（scene-shadow 方案 D4）：basic 材质不接收阴影。
 * kind:"basic"（unlit）+ receiveShadow:true → "设了字段没效果"，warn 提示（不 block）。
 * 四个 mesh 组件 checker 共用。
 */
function checkBasicReceiveShadow(node: unknown, ctx: CheckerContext): LintIssue[] {
  const issues: LintIssue[] = []
  if (!node || typeof node !== 'object') return issues
  const props = (node as Record<string, unknown>).properties as Record<string, unknown> | undefined
  if (!props) return issues
  if (props.kind === 'basic' && props.receiveShadow === true) {
    issues.push(ctx.issue('properties.receiveShadow', 'basic-material-no-receive-shadow',
      'basic 材质不接收阴影（unlit）：receiveShadow:true 无效果——需要接收阴影请改 kind:"standard" 或去掉该字段', 'warn', true))
  }
  return issues
}

/** comp:SpriteComponent — width/height 必填 > 0；opacity ∈ [0,1]；kind 材质两态；阴影标记。 */
class SpriteComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:SpriteComponent'
  schema: FieldSpec[] = [
    { field: 'properties.width', type: 'number', required: true, min: 0, minExclusive: true, label: '宽度' },
    { field: 'properties.height', type: 'number', required: true, min: 0, minExclusive: true, label: '高度' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.kind', type: 'string', enum: ['standard', 'basic'], label: '材质类型' },
    { field: 'properties.castShadow', type: 'boolean', label: '投射阴影' },
    { field: 'properties.receiveShadow', type: 'boolean', label: '接收阴影' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return checkBasicReceiveShadow(node, ctx)
  }
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

/**
 * comp:MeshComponent — MeshComponent 是抽象基类，资产不得直接声明。
 * 资产声明网格组件必须用具体派生类：BoxMeshComponent / SphereMeshComponent /
 * PlaneMeshComponent / CapsuleMeshComponent。本检查器对任何声明直接报 error。
 */
class MeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:MeshComponent'
  schema: FieldSpec[] = []
  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return [
      ctx.issue(
        'baseClass',
        'mesh-base-class-forbidden',
        'MeshComponent 是抽象基类，不能直接挂载——请用派生类 BoxMeshComponent / SphereMeshComponent / PlaneMeshComponent / CapsuleMeshComponent',
        'error',
        node,
      ),
    ]
  }
}
registerAssetChecker('comp:MeshComponent', MeshComponentChecker)

/** comp:BoxMeshComponent — 轴对齐盒：size: [w, h, d]；color；opacity [0,1]；kind 材质两态；阴影标记。 */
class BoxMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:BoxMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.size', type: 'array', minItems: 3, maxItems: 3, label: '盒尺寸 [w, h, d]' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.kind', type: 'string', enum: ['standard', 'basic'], label: '材质类型' },
    { field: 'properties.castShadow', type: 'boolean', label: '投射阴影' },
    { field: 'properties.receiveShadow', type: 'boolean', label: '接收阴影' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return checkBasicReceiveShadow(node, ctx)
  }
}
registerAssetChecker('comp:BoxMeshComponent', BoxMeshComponentChecker)

/** comp:SphereMeshComponent — 球体：radius；color；opacity [0,1]；kind 材质两态；阴影标记。 */
class SphereMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:SphereMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, minExclusive: true, label: '半径' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.kind', type: 'string', enum: ['standard', 'basic'], label: '材质类型' },
    { field: 'properties.castShadow', type: 'boolean', label: '投射阴影' },
    { field: 'properties.receiveShadow', type: 'boolean', label: '接收阴影' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return checkBasicReceiveShadow(node, ctx)
  }
}
registerAssetChecker('comp:SphereMeshComponent', SphereMeshComponentChecker)

/** comp:PlaneMeshComponent — 平面：size: [w, h]；color；opacity [0,1]；kind 材质两态；阴影标记。 */
class PlaneMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:PlaneMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.size', type: 'array', minItems: 2, maxItems: 2, label: '平面尺寸 [w, h]' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.kind', type: 'string', enum: ['standard', 'basic'], label: '材质类型' },
    { field: 'properties.castShadow', type: 'boolean', label: '投射阴影' },
    { field: 'properties.receiveShadow', type: 'boolean', label: '接收阴影' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return checkBasicReceiveShadow(node, ctx)
  }
}
registerAssetChecker('comp:PlaneMeshComponent', PlaneMeshComponentChecker)

/** comp:CapsuleMeshComponent — 胶囊体：radius/length/color；kind 材质两态；阴影标记。 */
class CapsuleMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:CapsuleMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, minExclusive: true, label: '半径' },
    { field: 'properties.length', type: 'number', min: 0, label: '圆柱段长度' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.kind', type: 'string', enum: ['standard', 'basic'], label: '材质类型' },
    { field: 'properties.castShadow', type: 'boolean', label: '投射阴影' },
    { field: 'properties.receiveShadow', type: 'boolean', label: '接收阴影' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    return checkBasicReceiveShadow(node, ctx)
  }
}
registerAssetChecker('comp:CapsuleMeshComponent', CapsuleMeshComponentChecker)

/** comp:LightComponent — 灯光（场景资产灯光声明）：type/color/intensity/castShadow 等。定位由 TransformComponent 承载。 */
class LightComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:LightComponent'
  schema: FieldSpec[] = [
    {
      field: 'properties.type', type: 'string',
      enum: ['directional', 'point', 'ambient', 'hemisphere', 'spot'],
      label: '灯光类型',
    },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.intensity', type: 'number', min: 0, label: '强度' },
    { field: 'properties.distance', type: 'number', min: 0, label: '照射距离' },
    { field: 'properties.decay', type: 'number', min: 0, label: '衰减' },
    { field: 'properties.angle', type: 'number', min: 0, label: '锥角' },
    { field: 'properties.penumbra', type: 'number', min: 0, label: '半影' },
    { field: 'properties.castShadow', type: 'boolean', label: '投射阴影' },
    { field: 'properties.shadowExtent', type: 'number', min: 0, label: '阴影正交范围（缺省 0=不改，three 默认 ±5）' },
    { field: 'properties.shadowMapSize', type: 'integer', enum: [512, 1024, 2048, 4096], label: '阴影贴图边长' },
    { field: 'properties.shadowBias', type: 'number', label: '阴影深度偏移' },
    { field: 'properties.shadowNormalBias', type: 'number', min: 0, label: '阴影法线偏移' },
    { field: 'properties.shadowRadius', type: 'number', min: 0, label: '阴影柔化半径' },
    { field: 'properties.targetPosition', type: 'vec3', label: 'target 局部偏移（directional/spot）' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:LightComponent', LightComponentChecker)

/** 碰撞体组件公共 properties schema（三个碰撞组件共用；bodyType/mass/group/mask/offset/linearDamping/lockY） */
const COLLIDER_COMMON_SCHEMA: FieldSpec[] = [
  { field: 'properties.bodyType', type: 'string', enum: ['static', 'dynamic'], label: '刚体类型' },
  { field: 'properties.mass', type: 'number', min: 0, minExclusive: true, label: '质量' },
  { field: 'properties.group', type: 'string', enum: ['default', 'troop', 'building'], label: '碰撞层' },
  { field: 'properties.mask', type: 'array', label: '碰撞掩码层' },
  { field: 'properties.offset', type: 'vec3', label: '中心偏移' },
  { field: 'properties.linearDamping', type: 'number', min: 0, label: '线性阻尼' },
  { field: 'properties.lockY', type: 'boolean', label: '锁定 Y' },
  { field: 'properties.name', type: 'string', label: '组件名' },
]

/** comp:BoxColliderComponent — 盒形碰撞体：size + 通用属性。 */
class BoxColliderComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:BoxColliderComponent'
  schema: FieldSpec[] = [
    { field: 'properties.size', type: 'array', minItems: 3, maxItems: 3, label: '盒尺寸' },
    ...COLLIDER_COMMON_SCHEMA,
  ]
}
registerAssetChecker('comp:BoxColliderComponent', BoxColliderComponentChecker)

/** comp:CircleColliderComponent — 圆形碰撞体：radius/height + 通用属性。 */
class CircleColliderComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:CircleColliderComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, minExclusive: true, label: '半径' },
    { field: 'properties.height', type: 'number', min: 0, minExclusive: true, label: '高度' },
    ...COLLIDER_COMMON_SCHEMA,
  ]
}
registerAssetChecker('comp:CircleColliderComponent', CircleColliderComponentChecker)

/** comp:CapsuleColliderComponent — 胶囊碰撞体：radius/length + 通用属性。 */
class CapsuleColliderComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:CapsuleColliderComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, minExclusive: true, label: '半径' },
    { field: 'properties.length', type: 'number', min: 0, label: '圆柱段长度' },
    ...COLLIDER_COMMON_SCHEMA,
  ]
}
registerAssetChecker('comp:CapsuleColliderComponent', CapsuleColliderComponentChecker)

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

/** comp:UITextComponent — 文本属性 + 字体参数 + UI 定位（显隐由节点 CanvasUIComponent 统一控制） */
class UITextComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UITextComponent'
  schema: FieldSpec[] = [
    { field: 'properties.text', type: 'string', label: '文本内容' },
    { field: 'properties.fontSize', type: 'integer', min: 1, label: '字号（整数）' },
    { field: 'properties.fontFamily', type: 'string', label: '字体' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.bold', type: 'boolean', label: '加粗' },
    { field: 'properties.italic', type: 'boolean', label: '斜体' },
    { field: 'properties.align', type: 'string', enum: ['left', 'center', 'right'], label: '对齐' },
    { field: 'properties.lineHeight', type: 'number', min: 0, minExclusive: true, label: '行高系数（fontSize 倍数）' },
    { field: 'properties.letterSpacing', type: 'number', min: 0, label: '字间距' },
    { field: 'properties.shadowColor', type: 'color', label: '阴影色' },
    { field: 'properties.shadowBlur', type: 'number', min: 0, label: '阴影模糊' },
    { field: 'properties.shadowOffsetX', type: 'number', label: '阴影 X 偏移' },
    { field: 'properties.shadowOffsetY', type: 'number', label: '阴影 Y 偏移' },
    { field: 'properties.width', type: 'number', min: 1, label: 'Canvas 像素宽' },
    { field: 'properties.height', type: 'number', min: 1, label: 'Canvas 像素高' },
    { field: 'properties.fontSizeScale', type: 'number', min: 0, minExclusive: true, label: '字号世界系数（持久化派生值）' },
    { field: 'properties.zOrder', type: 'number', label: 'UI 层级' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UITextComponent', UITextComponentChecker)

/** comp:UITextInputComponent — 单行文本输入控件（占位符/字号/颜色/Canvas 尺寸/层级） */
class UITextInputComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UITextInputComponent'
  schema: FieldSpec[] = [
    { field: 'properties.placeholder', type: 'string', label: '占位提示' },
    { field: 'properties.value', type: 'string', label: '初始文本' },
    { field: 'properties.fontSize', type: 'integer', min: 1, label: '字号（整数）' },
    { field: 'properties.color', type: 'color', label: '文本颜色' },
    { field: 'properties.width', type: 'number', min: 1, label: 'Canvas 像素宽' },
    { field: 'properties.height', type: 'number', min: 1, label: 'Canvas 像素高' },
    { field: 'properties.zOrder', type: 'number', label: 'UI 层级' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UITextInputComponent', UITextInputComponentChecker)

/** comp:UIScrollListComponent — 滚动列表组件（item 对象池 + 滚动偏移，超框 item 隐藏） */
class UIScrollListComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIScrollListComponent'
  schema: FieldSpec[] = [
    { field: 'properties.itemWidget', type: 'string', label: 'item 蓝图路径' },
    { field: 'properties.itemSize', type: 'vec2', label: 'item 世界尺寸 [w, h]' },
    { field: 'properties.spacing', type: 'number', min: 0, label: '项间距' },
    { field: 'properties.visibleCount', type: 'integer', min: 1, label: '可视数量（省略 = 按容器自动推导）' },
    { field: 'properties.direction', type: 'string', label: '滚动方向（vertical/horizontal）' },
    { field: 'properties.zOrderLift', type: 'number', min: 0, label: 'item zOrder 抬升值' },
    { field: 'properties.draggable', type: 'boolean', label: '鼠标拖拽滚动开关' },
    { field: 'properties.scrollbar', type: 'boolean', label: '右侧滚动条开关' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIScrollListComponent', UIScrollListComponentChecker)

/** comp:UIMaskComponent — 裁剪遮罩（裁剪框 = 节点 uitransform 边盒；HTML overflow 映射） */
class UIMaskComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIMaskComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, label: '圆角半径（世界米，0 = 矩形）' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIMaskComponent', UIMaskComponentChecker)

/** comp:UIScrollContainerComponent — 通用滚动容器（任意内容层 + 拖拽/滚动条，配 UIMask 裁剪） */
class UIScrollContainerComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIScrollContainerComponent'
  schema: FieldSpec[] = [
    { field: 'properties.direction', type: 'string', label: '滚动方向（vertical/horizontal）' },
    { field: 'properties.scrollOffset', type: 'number', min: 0, label: '初始滚动偏移（世界米）' },
    { field: 'properties.draggable', type: 'boolean', label: '鼠标拖拽滚动开关' },
    { field: 'properties.scrollbar', type: 'boolean', label: '滚动条开关' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIScrollContainerComponent', UIScrollContainerComponentChecker)

/** comp:UIProgressBarComponent — 进度条组件（数值模型 value/min/max + fill 子 Actor + 填充方向） */
class UIProgressBarComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIProgressBarComponent'
  schema: FieldSpec[] = [
    { field: 'properties.value', type: 'number', label: '当前值' },
    { field: 'properties.min', type: 'number', label: '最小值' },
    { field: 'properties.max', type: 'number', label: '最大值' },
    { field: 'properties.fillActorName', type: 'string', label: 'fill 子 Actor 名（默认 Fill）' },
    { field: 'properties.direction', type: 'string', enum: ['left-to-right', 'right-to-left', 'bottom-to-top', 'top-to-bottom'], label: '填充方向' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIProgressBarComponent', UIProgressBarComponentChecker)

/** comp:UITooltipComponent — 悬停提示组件（挂任意 UI 控件 Actor；delay 秒后在宿主上/下方生成 tooltip widget） */
class UITooltipComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UITooltipComponent'
  schema: FieldSpec[] = [
    { field: 'properties.text', type: 'string', label: '提示文本' },
    { field: 'properties.delay', type: 'number', min: 0, label: '悬停延迟（秒）' },
    { field: 'properties.direction', type: 'string', enum: ['top', 'bottom'], label: '弹出方向' },
    { field: 'properties.widgetPath', type: 'string', label: 'tooltip widget 资产路径' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UITooltipComponent', UITooltipComponentChecker)

/** comp:UIImageComponent — 颜色/圆角/不透明度/图片源 + UI 定位（显隐由节点 CanvasUIComponent 统一控制） */
class UIImageComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIImageComponent'
  schema: FieldSpec[] = [
    { field: 'properties.color', type: 'color', label: '填充色' },
    { field: 'properties.radius', type: 'number', min: 0, label: '圆角' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.src', type: 'string', label: '图片源' },
    {
      field: 'properties.gradient',
      type: 'object',
      label: '线性渐变填充（HTML 源 linear-gradient 映射）',
    },
    { field: 'properties.gradient.angle', type: 'number', label: '渐变角度（CSS 语义，度）' },
    { field: 'properties.gradient.stops', type: 'array', itemsType: 'object', label: '渐变色标' },
    { field: 'properties.width', type: 'number', min: 1, label: 'Canvas 像素宽' },
    { field: 'properties.height', type: 'number', min: 1, label: 'Canvas 像素高' },
    { field: 'properties.zOrder', type: 'number', label: 'UI 层级' },
    { field: 'properties.name', type: 'string', label: '组件名' },
    { field: 'properties.hitTest', type: 'string', enum: ['visible', 'block', 'hitTestInvisible'], label: '命中测试（仿 UE：block=拦截点击，落在本视觉 mesh 上；CSS hit-test 编译产物）' },
  ]
}
registerAssetChecker('comp:UIImageComponent', UIImageComponentChecker)

/** comp:UIButtonComponent — 按钮纯交互组件（按下缩放 pressScale；stateColors 交互态视觉表由引擎状态机原生驱动） */
class UIButtonComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIButtonComponent'
  schema: FieldSpec[] = [
    { field: 'properties.pressScale', type: 'number', min: 0, max: 1, label: '按下缩放比例' },
    { field: 'properties.stateColors', type: 'object', label: '交互态视觉表（HTML 源 :hover/:active/:disabled 编译映射）' },
    { field: 'properties.stateColors.hover', type: 'object', label: 'hover 态视觉' },
    { field: 'properties.stateColors.hover.color', type: 'color', label: 'hover 填充色' },
    { field: 'properties.stateColors.hover.opacity', type: 'number', min: 0, max: 1, label: 'hover 不透明度' },
    { field: 'properties.stateColors.pressed', type: 'object', label: 'pressed 态视觉' },
    { field: 'properties.stateColors.pressed.color', type: 'color', label: 'pressed 填充色' },
    { field: 'properties.stateColors.pressed.opacity', type: 'number', min: 0, max: 1, label: 'pressed 不透明度' },
    { field: 'properties.stateColors.disabled', type: 'object', label: 'disabled 态视觉' },
    { field: 'properties.stateColors.disabled.color', type: 'color', label: 'disabled 填充色' },
    { field: 'properties.stateColors.disabled.opacity', type: 'number', min: 0, max: 1, label: 'disabled 不透明度' },
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
    { field: 'properties.active', type: 'boolean', label: '激活（false = 不渲染）' },
    { field: 'properties.hitTest', type: 'string', enum: ['visible', 'block', 'hitTestInvisible'], label: '命中测试（仿 UE：visible=可命中/block=拦截/hitTestInvisible=穿透）' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:CanvasUIComponent', CanvasUIComponentChecker)

/** comp:UIWorldAnchorComponent — 3D 场景 UI 锚定（World-Space UI 双模式：screen 跟随 / world 面板） */
class UIWorldAnchorComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIWorldAnchorComponent'
  schema: FieldSpec[] = [
    { field: 'properties.mode', type: 'string', enum: ['screen', 'world'], label: '锚定模式' },
    { field: 'properties.targetActorId', type: 'string', label: '锚定目标 Actor 名' },
    { field: 'properties.localOffset', type: 'vec3', label: '局部偏移（米）' },
    { field: 'properties.faceCamera', type: 'boolean', label: 'billboard 朝向相机' },
    { field: 'properties.constantScreenSize', type: 'boolean', label: '恒定屏占' },
    { field: 'properties.clamping', type: 'string', enum: ['none', 'clamp'], label: '出屏策略' },
    { field: 'properties.pxPerMeter', type: 'number', min: 1, label: '设计 px → 米换算基准' },
    { field: 'properties.pixelDensity', type: 'number', min: 1, max: 4, label: 'canvas 纹理密度倍数' },
    { field: 'properties.alwaysOnTop', type: 'boolean', label: '始终顶层（world 面板关深度测试，不被 3D 物体遮挡）' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIWorldAnchorComponent', UIWorldAnchorComponentChecker)

/** comp:UIScriptComponent — UI 资产「挂载脚本」组件（Unity MonoBehaviour 挂载点） */
class UIScriptComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIScriptComponent'
  schema: FieldSpec[] = [
    { field: 'properties.script', type: 'string', label: '脚本 id（从项目 asset 自动扫描注册）' },
    { field: 'properties.args', type: 'object', label: '脚本启动参数' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIScriptComponent', UIScriptComponentChecker)

/** comp:UILayoutComponent — UI 布局组件（水平/垂直/网格自动排布子节点） */
class UILayoutComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UILayoutComponent'
  schema: FieldSpec[] = [
    {
      field: 'properties.mode',
      type: 'string',
      enum: ['horizontal', 'vertical', 'grid'],
      label: '布局模式',
    },
    { field: 'properties.columns', type: 'integer', min: 1, label: '网格列数（grid 模式）' },
    { field: 'properties.spacingX', type: 'number', min: 0, label: 'X 轴间距' },
    { field: 'properties.spacingY', type: 'number', min: 0, label: 'Y 轴间距' },
    { field: 'properties.autoLayout', type: 'boolean', label: '自动布局（子项变化时重排）' },
    { field: 'properties.wrap', type: 'boolean', label: '主轴换行（grid 列数/水平换行/垂直换列按容器尺寸自动推导）' },
    { field: 'properties.autoHeight', type: 'boolean', label: '自适应高度（布局后容器高度写回内容包围盒高）' },
    {
      field: 'properties.justify',
      type: 'string',
      enum: [...UILAYOUT_JUSTIFY_OPTIONS],
      label: '主轴分布（justify-content，缺省 center）',
    },
    {
      field: 'properties.align',
      type: 'string',
      enum: [...UILAYOUT_ALIGN_OPTIONS],
      label: '交叉轴对齐（align-items，缺省 center）',
    },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UILayoutComponent', UILayoutComponentChecker)

/** comp:ShadowBlobComponent — Blob 假阴影：radius > 0；opacity [0,1]；normal vec3（不可零向量）；offset ≥ 0。 */
class ShadowBlobComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:ShadowBlobComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, minExclusive: true, label: '暗斑半径' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.normal', type: 'vec3', label: '贴地法线（[0,1,0]=XZ 地面，[0,0,1]=XY 世界）' },
    { field: 'properties.offset', type: 'number', min: 0, label: '沿法线抬升' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
  override validate(node: unknown, ctx: CheckerContext): LintIssue[] {
    const issues: LintIssue[] = []
    if (!node || typeof node !== 'object') return issues
    const props = (node as Record<string, unknown>).properties as Record<string, unknown> | undefined
    const normal = props?.normal
    if (Array.isArray(normal) && normal.length === 3 && normal.every((v) => typeof v === 'number')) {
      if (Math.hypot(normal[0], normal[1], normal[2]) === 0) {
        issues.push(ctx.issue('properties.normal', 'shadow-blob-normal-zero',
          '贴地法线不可为零向量：XZ 地面用 [0,1,0]，XY 世界用 [0,0,1]', 'error', normal))
      }
    }
    return issues
  }
}
registerAssetChecker('comp:ShadowBlobComponent', ShadowBlobComponentChecker)
