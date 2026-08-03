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
import { ComponentRegistry } from './ComponentRegistry'
import { SpriteComponent } from '../rendering/SpriteComponent'
import { ClickableComponent } from '../physics/ClickableComponent'
import { CameraComponent, type CameraMode } from '../input/CameraComponent'
import { InputComponent } from '../input/InputComponent'
import { SpawnComponent } from '../entity/SpawnComponent'
import { TransformComponent } from '../entity/TransformComponent'
import { UITransformComponent, type AnchorPreset } from '../ui/UITransformComponent'
import { CanvasUIComponent } from '../rendering/CanvasUIComponent'
import { TroikaTextComponent } from '../rendering/TroikaTextComponent'
import { UITextComponent } from '../ui/UITextComponent'
import { UIImageComponent } from '../ui/UIImageComponent'
import { UIButtonComponent, type ButtonState } from '../ui/UIButtonComponent'

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
      new TransformComponent(owner, {
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
      new UITransformComponent(owner, {
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
      new SpriteComponent(owner, p.width ?? 1, p.height ?? 1, p.name ?? 'SpriteComponent'),
    (c, p) => {
      const sp = c as SpriteComponent
      if (p.color !== undefined) sp.setColor(p.color as THREE.ColorRepresentation)
      if (p.opacity !== undefined) sp.setOpacity(p.opacity as number)
      if (p.texture !== undefined) sp.setTexture(p.texture as string | THREE.Texture)
    },
  )

  // ─── ClickableComponent ─── props: { clickCooldown? }
  ComponentRegistry.register('ClickableComponent', (owner) => new ClickableComponent(owner), (c, p) => {
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
      return new MeshComponent(owner, mesh, (p.name as string) ?? 'MeshComponent')
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

  // ─── CanvasUIComponent ─── props: { width?, height?, worldWidth?, worldHeight?, doubleSided?, name?, markerOnly? }
  // 世界尺寸已在 uitransform 上（Unity RectTransform 风格），此处只传显式值，
  // 未设置时由 CanvasUIComponent 从 owner 的 uitransform 读取（避免默认值覆盖）
  ComponentRegistry.register(
    'CanvasUIComponent',
    (owner, p = {}) =>
      new CanvasUIComponent(owner, {
        width: p.width ?? 512,
        height: p.height ?? 256,
        ...(p.worldWidth != null ? { worldWidth: p.worldWidth } : {}),
        ...(p.worldHeight != null ? { worldHeight: p.worldHeight } : {}),
        doubleSided: (p.doubleSided as boolean) ?? true,
        name: p.name ?? 'CanvasUIComponent',
        zOrder: p.zOrder as number | undefined,
        markerOnly: (p.markerOnly as boolean) ?? false,
      }),
    (c, p) => {
      const ui = c as CanvasUIComponent
      if (p.worldWidth != null || p.worldHeight != null) {
        ui.setWorldSize(p.worldWidth ?? 5, p.worldHeight ?? 2.5)
      }
      if (p.opacity !== undefined) ui.setOpacity(p.opacity as number)
      if (p.zOrder !== undefined) ui.zOrder = p.zOrder as number
    },
  )

  // ─── TroikaTextComponent ─── props: { text?, fontSize?, color?, maxWidth?, textAlign?, outlineWidth?, name? }
  ComponentRegistry.register(
    'TroikaTextComponent',
    (owner, p = {}) =>
      new TroikaTextComponent(owner, (p.text as string) ?? '', {
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

  // ─── UITextComponent ─── props: { text?, fontSize?, color?, bold?, align?, width?, height?, ... }
  ComponentRegistry.register(
    'UITextComponent',
    (owner, p = {}) =>
      new UITextComponent(owner, {
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
      }),
    (c, p) => {
      const t = c as UITextComponent
      if (p.text !== undefined) t.text = p.text as string
      if (p.fontSize !== undefined) t.fontSize = p.fontSize as number
      if (p.color !== undefined) t.color = p.color as string
      if (p.align !== undefined) t.align = p.align as 'left' | 'center' | 'right'
      if (p.zOrder !== undefined) t.zOrder = p.zOrder as number
    },
  )

  // ─── UIImageComponent ─── props: { color?, radius?, opacity?, src?, worldWidth?, worldHeight? }
  ComponentRegistry.register(
    'UIImageComponent',
    (owner, p = {}) =>
      new UIImageComponent(owner, {
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
      new UIButtonComponent(owner, {
        colors: p.colors as Record<string, string> | undefined,
      }),
    (c, p) => {
      const btn = c as UIButtonComponent
      if (p.colors !== undefined) btn.setColors(p.colors as Partial<Record<ButtonState, string>>)
    },
  )
}
