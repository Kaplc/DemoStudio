/**
 * registerBuiltinComponents — 集中注册引擎内置 Component
 *
 * 每个注册项定义：
 *   - factory:  从 props 提取构造参数
 *   - configure: 构造后调各 setter
 *
 * 约定：Component 的"构造所需参数"与"可配置属性"都走 props。
 *
 * 限制（文档标注）：
 *   - ClickableComponent 的 targets / onClick / onHover 不通过 props 配置
 *     （targets 是 Object3D[]，回调是代码逻辑），blueprint 仅设 clickCooldown。
 *     ClickableComponent 默认自动收集 owner.root 下所有 Mesh 作为检测目标。
 *   - InputComponent 的按键绑定、SpawnComponent 的生成点由代码配置，不进 props。
 */
import * as THREE from 'three'
import { MeshComponent } from '../rendering/MeshComponent'
import { CapsuleMeshComponent } from '../rendering/CapsuleMeshComponent'
import { LineComponent } from '../rendering/LineComponent'
import { ComponentRegistry } from './ComponentRegistry'
import { SpriteComponent } from '../rendering/SpriteComponent'
import { ClickableComponent } from '../physics/ClickableComponent'
import { CameraComponent, type CameraMode } from '../rendering/CameraComponent'
import { InputComponent } from '../input/InputComponent'
import { SpawnComponent } from '../entity/SpawnComponent'
import { TransformComponent } from '../entity/TransformComponent'
import { UITransformComponent, type AnchorPreset } from '../ui/UITransformComponent'
import { UILayoutComponent, type UILayoutMode } from '../ui/UILayoutComponent'
import { UIProgressBarComponent, type UIProgressDirection } from '../ui/UIProgressBarComponent'
import { UIScrollListComponent, type UIScrollDirection } from '../ui/UIScrollListComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { TroikaTextComponent } from '../rendering/TroikaTextComponent'
import { UITextComponent } from '../ui/UITextComponent'
import { UITextInputComponent } from '../ui/UITextInputComponent'
import { UIImageComponent } from '../ui/UIImageComponent'
import { UIButtonComponent, type ButtonState } from '../ui/UIButtonComponent'
import { UIScriptComponent } from '../ui/UIScriptComponent'
import { UITooltipComponent } from '../ui/UITooltipComponent'
import { LightComponent, type LightType } from '../rendering/LightComponent'
import type { Actor } from '../entity/Actor'
import type { BObject } from '../entity/BObject'

/** 注册工厂 owner 收窄：渲染类组件需要 Actor（挂场景节点）；逻辑类组件接受任意 BObject */
const asActor = (owner: BObject): Actor => owner as Actor

let _registered = false

/** 注册所有内置 Component（幂等，重复调用无副作用） */
export function registerBuiltinComponents(): void {
  if (_registered) return
  _registered = true

  // ─── TransformComponent ─── props: { position?, rotation?, scale? }
  // 变换修改能力组件化：位置/旋转/缩放经组件读写（底层仍为 owner.root）
  ComponentRegistry.register(
    'TransformComponent',
    (owner, p = {}) =>
      new TransformComponent(asActor(owner), {
        position: p.position as [number, number, number] | undefined,
        rotation: p.rotation as [number, number, number] | undefined,
        scale: p.scale as [number, number, number] | undefined,
      }),
    (c, p) => {
      const tf = c as TransformComponent
      if (Array.isArray(p.position)) tf.setPosition(p.position[0], p.position[1], p.position[2])
      if (Array.isArray(p.rotation)) tf.setRotation(p.rotation[0], p.rotation[1], p.rotation[2])
      if (Array.isArray(p.scale)) tf.setScale(p.scale[0], p.scale[1], p.scale[2])
    },
  )

  // ─── UITransformComponent ─── props: { position?, rotation?, scale?, worldWidth?, worldHeight?, anchor?, anchorOffset? }
  // UI 专用变换组件：继承 transform，额外承载尺寸 + 九宫格锚点定位（Unity RectTransform 风格）
  ComponentRegistry.register(
    'UITransformComponent',
    (owner, p = {}) =>
      new UITransformComponent(asActor(owner), {
        position: p.position as [number, number, number] | undefined,
        rotation: p.rotation as [number, number, number] | undefined,
        scale: p.scale as [number, number, number] | undefined,
        worldWidth: p.worldWidth as number | undefined,
        worldHeight: p.worldHeight as number | undefined,
        anchor: p.anchor as AnchorPreset | undefined,
        anchorOffset: p.anchorOffset as [number, number] | undefined,
      }),
    (c, p) => {
      const tf = c as UITransformComponent
      if (Array.isArray(p.position)) tf.setPosition(p.position[0], p.position[1], p.position[2])
      if (Array.isArray(p.rotation)) tf.setRotation(p.rotation[0], p.rotation[1], p.rotation[2])
      if (Array.isArray(p.scale)) tf.setScale(p.scale[0], p.scale[1], p.scale[2])
      if (p.worldWidth != null || p.worldHeight != null) {
        // 同步所有真实画布面板 scale（兜底组件创建顺序问题）
        tf.setWorldSize(p.worldWidth ?? 5, p.worldHeight ?? 2.5)
      }
      if (p.anchor !== undefined) tf.anchor = p.anchor as AnchorPreset
      if (p.anchorOffset !== undefined) tf.anchorOffset = p.anchorOffset as [number, number]
    },
  )

  // ─── SpriteComponent ─── props: { width?, height?, color?, opacity?, texture?, name? }
  ComponentRegistry.register(
    'SpriteComponent',
    (owner, p = {}) =>
      new SpriteComponent(asActor(owner), p.width ?? 1, p.height ?? 1, p.name ?? 'SpriteComponent'),
    (c, p) => {
      const sp = c as SpriteComponent
      if (p.color !== undefined) sp.setColor(p.color as THREE.ColorRepresentation)
      if (p.opacity !== undefined) sp.setOpacity(p.opacity as number)
      if (p.texture !== undefined) sp.setTexture(p.texture as string | THREE.Texture)
    },
  )

  // ─── ClickableComponent ─── props: { clickCooldown? }
  ComponentRegistry.register('ClickableComponent', (owner) => new ClickableComponent(asActor(owner)), (c, p) => {
    const ck = c as ClickableComponent
    if (p.clickCooldown !== undefined) ck.clickCooldown = p.clickCooldown as number
  })

  // ─── CameraComponent ─── props: { mode?, fov?, orthoSize?, near?, far?, priority?, name? }
  ComponentRegistry.register(
    'CameraComponent',
    (owner, p = {}) =>
      new CameraComponent(owner, p.name ?? 'CameraComponent', (p.mode as CameraMode) ?? 'perspective'),
    (c, p) => {
      const cam = c as CameraComponent
      if (p.priority !== undefined) cam.priority = p.priority as number
      // 投影参数：按 mode 走对应 setter（变更后重建投影矩阵）
      if (cam.mode === 'perspective') {
        cam.SetView(
          p.fov !== undefined ? (p.fov as number) : cam.fov,
          p.near !== undefined ? (p.near as number) : cam.near,
          p.far !== undefined ? (p.far as number) : cam.far,
        )
      } else {
        cam.SetOrtho(
          p.orthoSize !== undefined ? (p.orthoSize as number) : cam.orthoSize,
          p.near !== undefined ? (p.near as number) : cam.near,
          p.far !== undefined ? (p.far as number) : cam.far,
        )
      }
    },
  )

  // ─── InputComponent ─── 构造即用，按键绑定由代码 BindAction 完成
  ComponentRegistry.register('InputComponent', (owner, p = {}) => new InputComponent(owner, p.name ?? 'InputComponent'))

  // ─── SpawnComponent ─── 构造即用，生成点由代码 AddSpawnPoint 配置
  ComponentRegistry.register('SpawnComponent', (owner) => new SpawnComponent(owner))

  // ─── LineComponent ─── 线框/线段渲染（选中高亮、网格线等），EndPlay 自动释放资源
  // line 对象由代码构造传入，props 仅支持 name
  ComponentRegistry.register(
    'LineComponent',
    (owner, p = {}) =>
      new LineComponent(
        asActor(owner),
        new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()),
        (p.name as string) ?? 'LineComponent',
      ),
  )

  // ─── MeshComponent ─── props: { geometry?, size?, color?, opacity?, name? }
  // geometry 取值: 'box'（默认）| 'sphere' | 'plane'
  // size 按几何类型: box→[w,h,d], sphere→[radius], plane→[w,h]
  ComponentRegistry.register(
    'MeshComponent',
    (owner, p = {}) => {
      const geometryType = (p.geometry as string) ?? 'box'
      const size = p.size as number[] | undefined
      let geo: THREE.BufferGeometry
      switch (geometryType) {
        case 'sphere':
          geo = new THREE.SphereGeometry(size?.[0] ?? 0.5, 16, 16)
          break
        case 'plane':
          geo = new THREE.PlaneGeometry(size?.[0] ?? 1, size?.[1] ?? 1)
          break
        default:
          geo = new THREE.BoxGeometry(size?.[0] ?? 1, size?.[1] ?? 1, size?.[2] ?? 1)
      }
      const color = (p.color as number | string) ?? 0xffffff
      const mat = new THREE.MeshStandardMaterial({ color })
      if (p.opacity !== undefined) {
        mat.transparent = true
        mat.opacity = p.opacity as number
      }
      const mesh = new THREE.Mesh(geo, mat)
      return new MeshComponent(asActor(owner), mesh, (p.name as string) ?? 'MeshComponent')
    },
    (c, p) => {
      const mc = c as MeshComponent
      const mat = mc.mesh.material as THREE.MeshStandardMaterial
      if (p.color !== undefined) mat.color.set(p.color as THREE.ColorRepresentation)
      if (p.opacity !== undefined) {
        mat.transparent = true
        mat.opacity = p.opacity as number
      }
    },
  )

  // ─── CapsuleMeshComponent ─── props: { radius?, length?, color?, name? }
  // 胶囊体网格（兵种等角色模型）：radius=半径，length=圆柱段长度（0=纯球）
  // 几何体中心在胶囊体中心，贴地偏移由蓝图 TransformComponent 控制
  ComponentRegistry.register(
    'CapsuleMeshComponent',
    (owner, p = {}) => {
      const radius = (p.radius as number) ?? 0.3
      const length = (p.length as number) ?? 0.3
      const color = (p.color as number | string) ?? 0xffffff
      return new CapsuleMeshComponent(asActor(owner), radius, length, color, (p.name as string) ?? 'CapsuleMeshComponent')
    },
    (c, p) => {
      const mc = c as MeshComponent
      const mat = mc.mesh.material as THREE.MeshStandardMaterial
      if (p.color !== undefined) mat.color.set(p.color as THREE.ColorRepresentation)
    },
  )

  // ─── CanvasUIComponent ─── props: { width?, height?, worldWidth?, worldHeight?, doubleSided?, name?, markerOnly?, active? }
  // 世界尺寸已在 uitransform 上（Unity RectTransform 风格），此处只传显式值，
  // 未设置时由 CanvasUIComponent 从 owner 的 uitransform 读取（避免默认值覆盖）
  // active 是本组件持有的节点级显隐开关（applyActive 级联到自身 panel + 子树全部渲染组件）
  ComponentRegistry.register(
    'CanvasUIComponent',
    (owner, p = {}) =>
      new CanvasUIComponent(asActor(owner), {
        width: p.width ?? 512,
        height: p.height ?? 256,
        ...(p.worldWidth != null ? { worldWidth: p.worldWidth } : {}),
        ...(p.worldHeight != null ? { worldHeight: p.worldHeight } : {}),
        doubleSided: (p.doubleSided as boolean) ?? true,
        name: p.name ?? 'CanvasUIComponent',
        zOrder: p.zOrder as number | undefined,
        markerOnly: (p.markerOnly as boolean) ?? false,
        ...(p.active !== undefined ? { active: p.active as boolean } : {}),
        ...(p.hitTest !== undefined ? { hitTest: p.hitTest as 'visible' | 'block' | 'hitTestInvisible' } : {}),
      }),
    (c, p) => {
      const ui = c as CanvasUIComponent
      if (p.worldWidth != null || p.worldHeight != null) {
        ui.setWorldSize(p.worldWidth ?? 5, p.worldHeight ?? 2.5)
      }
      if (p.opacity !== undefined) ui.setOpacity(p.opacity as number)
      if (p.zOrder !== undefined) ui.zOrder = p.zOrder as number
      if (p.active !== undefined) ui.bActive = p.active as boolean
    },
  )

  // ─── TroikaTextComponent ─── props: { text?, fontSize?, color?, maxWidth?, textAlign?, outlineWidth?, name? }
  ComponentRegistry.register(
    'TroikaTextComponent',
    (owner, p = {}) =>
      new TroikaTextComponent(asActor(owner), (p.text as string) ?? '', {
        fontSize: p.fontSize ?? 0.3,
        color: (p.color as string) ?? '#ffffff',
        maxWidth: p.maxWidth as number | undefined,
        textAlign: p.textAlign as 'left' | 'center' | 'right' | undefined,
        outlineWidth: p.outlineWidth as number | undefined,
        outlineColor: p.outlineColor as string | undefined,
        name: p.name ?? 'TroikaTextComponent',
      }),
    (c, p) => {
      const txt = c as TroikaTextComponent
      if (p.text !== undefined) txt.setText(p.text as string)
      if (p.color !== undefined) txt.setColor(p.color as string)
    },
  )

  // ─── UITextComponent ─── props: { text?, fontSize?, color?, ..., width?, height?, fontSizeScale?, ... }
  // 显隐由同/父节点的 CanvasUIComponent.active 统一控制（节点级级联），UIText 不再消费 active。
  // fontSizeScale：像素→世界换算系数（持久化字段）。蓝图重建时回灌，让字号与控件尺寸彻底解耦
  // （拖拽控件大小后字号保持不变）。省略时（首次创建/程序化）按当前世界高自动推导。
  ComponentRegistry.register(
    'UITextComponent',
    (owner, p = {}) =>
      new UITextComponent(asActor(owner), {
        text: p.text as string | undefined,
        fontSize: p.fontSize as number | undefined,
        color: p.color as string | undefined,
        bold: p.bold as boolean | undefined,
        italic: p.italic as boolean | undefined,
        align: p.align as 'left' | 'center' | 'right' | undefined,
        fontFamily: p.fontFamily as string | undefined,
        lineHeight: p.lineHeight as number | undefined,
        shadowColor: p.shadowColor as string | undefined,
        shadowBlur: p.shadowBlur as number | undefined,
        letterSpacing: p.letterSpacing as number | undefined,
        width: p.width as number | undefined,
        height: p.height as number | undefined,
        fontSizeScale: p.fontSizeScale as number | undefined,
      }),
    (c, p) => {
      const t = c as UITextComponent
      if (p.text !== undefined) t.text = p.text as string
      if (p.fontSize !== undefined) t.fontSize = p.fontSize as number
      if (p.color !== undefined) t.color = p.color as string
      if (p.align !== undefined) t.align = p.align as 'left' | 'center' | 'right'
      if (p.bold !== undefined) t.bold = p.bold as boolean
      if (p.italic !== undefined) t.italic = p.italic as boolean
      if (p.lineHeight !== undefined) t.lineHeight = p.lineHeight as number
      if (p.letterSpacing !== undefined) t.letterSpacing = p.letterSpacing as number
      if (p.zOrder !== undefined) t.zOrder = p.zOrder as number
    },
  )

  // ─── UITextInputComponent ─── props: { placeholder?, value?, fontSize?, color?, width?, height?, zOrder? }
  // 单行文本输入控件（GM 控制台输入框等）。onSubmit 由代码设置（资产无法表达回调）。
  ComponentRegistry.register(
    'UITextInputComponent',
    (owner, p = {}) =>
      new UITextInputComponent(asActor(owner), {
        placeholder: p.placeholder as string | undefined,
        value: p.value as string | undefined,
        fontSize: p.fontSize as number | undefined,
        color: p.color as string | undefined,
        width: p.width as number | undefined,
        height: p.height as number | undefined,
        ...(p.zOrder !== undefined ? { zOrder: p.zOrder as number } : {}),
      }),
    (c, p) => {
      const input = c as UITextInputComponent
      if (p.placeholder !== undefined) input.placeholder = p.placeholder as string
      if (p.value !== undefined) input.value = p.value as string
      if (p.fontSize !== undefined) input.fontSize = p.fontSize as number
      if (p.color !== undefined) input.color = p.color as string
      if (p.zOrder !== undefined) input.zOrder = p.zOrder as number
    },
  )

  // ─── UIImageComponent ─── props: { color?, radius?, opacity?, src?, worldWidth?, worldHeight?, ... }
  // 显隐由同/父节点的 CanvasUIComponent.active 统一控制（节点级级联），UIImage 不再消费 active。
  ComponentRegistry.register(
    'UIImageComponent',
    (owner, p = {}) =>
      new UIImageComponent(asActor(owner), {
        color: p.color as string | undefined,
        radius: p.radius as number | undefined,
        opacity: p.opacity as number | undefined,
        src: p.src as string | undefined,
        worldWidth: p.worldWidth as number | undefined,
        worldHeight: p.worldHeight as number | undefined,
        width: p.width as number | undefined,
        height: p.height as number | undefined,
      }),
    (c, p) => {
      const img = c as UIImageComponent
      if (p.color !== undefined) img.color = p.color as string
      if (p.radius !== undefined) img.radius = p.radius as number
      if (p.src !== undefined) img.loadImage(p.src as string)
      if (p.zOrder !== undefined) img.zOrder = p.zOrder as number
    },
  )

  // ─── UIButtonComponent ─── props: { colors?, onClick? (代码设置) }
  // 纯交互组件：背景渲染由同 Actor 的 uiimage 提供（Unity Button.targetGraphic 模式），
  // 状态切换时 UIButtonComponent 驱动 uiimage 的颜色；文字由独立子 Actor 挂 UITextComponent 提供。
  ComponentRegistry.register(
    'UIButtonComponent',
    (owner, p = {}) =>
      new UIButtonComponent(asActor(owner), {
        colors: p.colors as Record<string, string> | undefined,
      }),
    (c, p) => {
      const btn = c as UIButtonComponent
      if (p.colors !== undefined) btn.setColors(p.colors as Partial<Record<ButtonState, string>>)
    },
  )

  // ─── UITooltipComponent ─── props: { text?, delay?, direction?, widgetPath? }
  // 悬停提示组件：挂在任意 UI 控件上，悬停 delay 秒后在宿主上方/下方动态生成 tooltip 面板。
  ComponentRegistry.register(
    'UITooltipComponent',
    (owner, p = {}) =>
      new UITooltipComponent(asActor(owner), {
        text: p.text as string | undefined,
        delay: p.delay as number | undefined,
        direction: p.direction as 'top' | 'bottom' | undefined,
        widgetPath: p.widgetPath as string | undefined,
      }),
    (c, p) => {
      const tip = c as UITooltipComponent
      if (p.text !== undefined) tip.text = p.text as string
      if (p.delay !== undefined) tip.delay = p.delay as number
      if (p.direction !== undefined) tip.direction = p.direction as 'top' | 'bottom'
      if (p.widgetPath !== undefined) tip.widgetPath = p.widgetPath as string
    },
  )

  // ─── UIProgressBarComponent ─── props: { value?, min?, max?, fillActorName?, direction? }
  // 进度条/血条：驱动 fill 子 Actor 尺寸按比例填充。
  ComponentRegistry.register(
    'UIProgressBarComponent',
    (owner, p = {}) =>
      new UIProgressBarComponent(asActor(owner), {
        value: p.value as number | undefined,
        min: p.min as number | undefined,
        max: p.max as number | undefined,
        fillActorName: p.fillActorName as string | undefined,
        direction: p.direction as UIProgressDirection | undefined,
      }),
    (c, p) => {
      const bar = c as UIProgressBarComponent
      if (p.value !== undefined) bar.value = p.value as number
      if (p.min !== undefined) bar.min = p.min as number
      if (p.max !== undefined) bar.max = p.max as number
      if (p.fillActorName !== undefined) bar.fillActorName = p.fillActorName as string
      if (p.direction !== undefined) bar.direction = p.direction as UIProgressDirection
    },
  )

  // ─── UIScrollListComponent ─── props: { itemWidget?, itemSize?, spacing?, visibleCount?, direction?, draggable?, scrollbar? }
  // 滚动列表：item 对象池 + 滚动偏移排布 + 鼠标拖拽滚动 + 右侧滚动条。
  ComponentRegistry.register(
    'UIScrollListComponent',
    (owner, p = {}) =>
      new UIScrollListComponent(asActor(owner), {
        itemWidget: p.itemWidget as string | undefined,
        itemSize: p.itemSize as [number, number] | undefined,
        spacing: p.spacing as number | undefined,
        visibleCount: p.visibleCount as number | undefined,
        direction: p.direction as UIScrollDirection | undefined,
        draggable: p.draggable as boolean | undefined,
        scrollbar: p.scrollbar as boolean | undefined,
      }),
    (c, p) => {
      const list = c as UIScrollListComponent
      if (p.itemWidget !== undefined) list.itemWidget = p.itemWidget as string
      if (p.itemSize !== undefined) list.itemSize = p.itemSize as [number, number]
      if (p.spacing !== undefined) list.spacing = p.spacing as number
      if (p.visibleCount !== undefined) list.visibleCount = p.visibleCount as number
      if (p.direction !== undefined) list.direction = p.direction as UIScrollDirection
      if (p.draggable !== undefined) list.draggable = p.draggable as boolean
      if (p.scrollbar !== undefined) list.scrollbar = p.scrollbar as boolean
    },
  )

  // ─── UIScriptComponent ─── props: { script?, args? }
  // UI 资产「挂载脚本」组件（Unity MonoBehaviour 挂载点）：BeginPlay 时按 script id
  // 从 ScriptRegistry 实例化脚本并注入宿主，转发 onStart/onUpdate/onDestroy。
  // 脚本 id 由项目 asset/index.ts 的 import.meta.glob 自动扫描注册。
  ComponentRegistry.register(
    'UIScriptComponent',
    (owner, p = {}) => {
      const comp = new UIScriptComponent(asActor(owner))
      if (p.script !== undefined) comp.script = p.script as string
      if (p.args !== undefined) comp.args = p.args as Record<string, unknown>
      return comp
    },
    (c, p) => {
      const sc = c as UIScriptComponent
      if (p.script !== undefined) sc.script = p.script as string
      if (p.args !== undefined) sc.args = p.args as Record<string, unknown>
    },
  )

  // ─── LightComponent ─── props: { type?, color?, intensity?, castShadow?, position?, ... }
  // 灯光挂载到 Actor（灯光 Actor 模式）：Scene 视口默认灯光与场景资产灯光声明均走此组件。
  ComponentRegistry.register(
    'LightComponent',
    (owner, p = {}) =>
      new LightComponent(asActor(owner), {
        type: p.type as LightType | undefined,
        color: p.color as string | number | undefined,
        intensity: p.intensity as number | undefined,
        distance: p.distance as number | undefined,
        decay: p.decay as number | undefined,
        angle: p.angle as number | undefined,
        penumbra: p.penumbra as number | undefined,
        castShadow: p.castShadow as boolean | undefined,
        position: p.position as [number, number, number] | undefined,
      }),
    (c, p) => {
      const lc = c as LightComponent
      if (p.color !== undefined) lc.color = p.color as string
      if (p.intensity !== undefined) lc.intensity = p.intensity as number
      if (p.castShadow !== undefined) lc.castShadow = p.castShadow as boolean
    },
  )

  // ─── UILayoutComponent ─── props: { mode?, columns?, spacingX?, spacingY?, autoLayout? }
  // 布局组件：挂在容器 Actor 上，自动按模式（水平/垂直/网格）排列其子 UI 节点。
  ComponentRegistry.register(
    'UILayoutComponent',
    (owner, p = {}) =>
      new UILayoutComponent(asActor(owner), {
        mode: (p.mode as UILayoutMode) ?? 'grid',
        columns: p.columns as number | undefined,
        spacingX: p.spacingX as number | undefined,
        spacingY: p.spacingY as number | undefined,
        autoLayout: p.autoLayout as boolean | undefined,
      }),
    (c, p) => {
      const layout = c as UILayoutComponent
      if (p.mode !== undefined) layout.mode = p.mode as UILayoutMode
      if (p.columns !== undefined) layout.columns = p.columns as number
      if (p.spacingX !== undefined) layout.spacingX = p.spacingX as number
      if (p.spacingY !== undefined) layout.spacingY = p.spacingY as number
      if (p.autoLayout !== undefined) layout.autoLayout = p.autoLayout as boolean
    },
  )
}
