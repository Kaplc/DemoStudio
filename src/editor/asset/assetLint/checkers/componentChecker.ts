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

/** comp:BoxMeshComponent — 轴对齐盒：size: [w, h, d]；color；opacity [0,1]。 */
class BoxMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:BoxMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.size', type: 'array', minItems: 3, maxItems: 3, label: '盒尺寸 [w, h, d]' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
}
registerAssetChecker('comp:BoxMeshComponent', BoxMeshComponentChecker)

/** comp:SphereMeshComponent — 球体：radius；color；opacity [0,1]。 */
class SphereMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:SphereMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, minExclusive: true, label: '半径' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
}
registerAssetChecker('comp:SphereMeshComponent', SphereMeshComponentChecker)

/** comp:PlaneMeshComponent — 平面：size: [w, h]；color；opacity [0,1]。 */
class PlaneMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:PlaneMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.size', type: 'array', minItems: 2, maxItems: 2, label: '平面尺寸 [w, h]' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.opacity', type: 'number', min: 0, max: 1, label: '不透明度' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
}
registerAssetChecker('comp:PlaneMeshComponent', PlaneMeshComponentChecker)

/** comp:CapsuleMeshComponent — 胶囊体：radius/length/color。 */
class CapsuleMeshComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:CapsuleMeshComponent'
  schema: FieldSpec[] = [
    { field: 'properties.radius', type: 'number', min: 0, minExclusive: true, label: '半径' },
    { field: 'properties.length', type: 'number', min: 0, label: '圆柱段长度' },
    { field: 'properties.color', type: 'color', label: '颜色' },
    { field: 'properties.name', type: 'string', label: '网格名' },
  ]
}
registerAssetChecker('comp:CapsuleMeshComponent', CapsuleMeshComponentChecker)

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
    { field: 'properties.hitTest', type: 'string', enum: ['visible', 'block', 'hitTestInvisible'], label: '命中测试（继承 CanvasUIComponent）' },
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
    { field: 'properties.hitTest', type: 'string', enum: ['visible', 'block', 'hitTestInvisible'], label: '命中测试（继承 CanvasUIComponent）' },
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

/** comp:UIImageComponent — 颜色/圆角/不透明度/图片源 + UI 定位（显隐由节点 CanvasUIComponent 统一控制） */
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
    { field: 'properties.hitTest', type: 'string', enum: ['visible', 'block', 'hitTestInvisible'], label: '命中测试（继承 CanvasUIComponent）' },
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UIImageComponent', UIImageComponentChecker)

/** comp:UIButtonComponent — 按钮纯交互组件（按下缩放 pressScale；自动生成透明点击层，不驱动颜色） */
class UIButtonComponentChecker extends AbstractAssetChecker {
  readonly kind = 'comp:UIButtonComponent'
  schema: FieldSpec[] = [
    { field: 'properties.pressScale', type: 'number', min: 0, max: 1, label: '按下缩放比例' },
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
    { field: 'properties.name', type: 'string', label: '组件名' },
  ]
}
registerAssetChecker('comp:UILayoutComponent', UILayoutComponentChecker)
