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
import { CanvasUIComponent, type AnchorPreset } from '../rendering/CanvasUIComponent'
import { TroikaTextComponent } from '../rendering/TroikaTextComponent'
import { UITextComponent } from '../ui/UITextComponent'
import { UIImageComponent } from '../ui/UIImageComponent'
import { UIButtonComponent } from '../ui/UIButtonComponent'

let _registered = false

/** 注册所有内置 Component（幂等，重复调用无副作用） */
export function registerBuiltinComponents(): void {
  if (_registered) return
  _registered = true

  // ─── sprite ─── props: { width?, height?, color?, opacity?, texture?, name? }
  ComponentRegistry.register(
    'sprite',
    (owner, p = {}) =>
      new SpriteComponent(owner, p.width ?? 1, p.height ?? 1, p.name ?? 'SpriteComponent'),
    (c, p) => {
      const sp = c as SpriteComponent
      if (p.color !== undefined) sp.setColor(p.color as THREE.ColorRepresentation)
      if (p.opacity !== undefined) sp.setOpacity(p.opacity as number)
      if (p.texture !== undefined) sp.setTexture(p.texture as string | THREE.Texture)
    },
  )

  // ─── clickable ─── props: { clickCooldown? }
  ComponentRegistry.register('clickable', (owner) => new ClickableComponent(owner), (c, p) => {
    const ck = c as ClickableComponent
    if (p.clickCooldown !== undefined) ck.clickCooldown = p.clickCooldown as number
  })

  // ─── camera ─── props: { mode?, fov?, orthoSize?, near?, far?, priority?, name? }
  ComponentRegistry.register(
    'camera',
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

  // ─── input ─── 构造即用，按键绑定由代码 BindAction 完成
  ComponentRegistry.register('input', (owner, p = {}) => new InputComponent(owner, p.name ?? 'InputComponent'))

  // ─── spawn ─── 构造即用，生成点由代码 AddSpawnPoint 配置
  ComponentRegistry.register('spawn', (owner) => new SpawnComponent(owner))

  // ─── mesh ─── props: { geometry?, size?, color?, opacity?, name? }
  // geometry 取值: 'box'（默认）| 'sphere' | 'plane'
  // size 按几何类型: box→[w,h,d], sphere→[radius], plane→[w,h]
  ComponentRegistry.register(
    'mesh',
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

  // ─── canvasui ─── props: { width?, height?, worldWidth?, worldHeight?, doubleSided?, name?, anchor?, anchorOffset? }
  ComponentRegistry.register(
    'canvasui',
    (owner, p = {}) =>
      new CanvasUIComponent(owner, {
        width: p.width ?? 512,
        height: p.height ?? 256,
        worldWidth: p.worldWidth ?? 5,
        worldHeight: p.worldHeight ?? 2.5,
        doubleSided: (p.doubleSided as boolean) ?? true,
        name: p.name ?? 'CanvasUIComponent',
        zOrder: p.zOrder as number | undefined,
        anchor: p.anchor as AnchorPreset | undefined,
        anchorOffset: p.anchorOffset as [number, number] | undefined,
      }),
    (c, p) => {
      const ui = c as CanvasUIComponent
      if (p.worldWidth != null || p.worldHeight != null) {
        ui.setWorldSize(p.worldWidth ?? 5, p.worldHeight ?? 2.5)
      }
      if (p.opacity !== undefined) ui.setOpacity(p.opacity as number)
      if (p.zOrder !== undefined) ui.zOrder = p.zOrder as number
      if (p.anchor !== undefined) ui.anchor = p.anchor as AnchorPreset
      if (p.anchorOffset !== undefined) ui.anchorOffset = p.anchorOffset as [number, number]
    },
  )

  // ─── troika ─── props: { text?, fontSize?, color?, maxWidth?, textAlign?, outlineWidth?, name? }
  ComponentRegistry.register(
    'troika',
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

  // ─── uitext ─── props: { text?, fontSize?, color?, bold?, align?, width?, height?, ... }
  ComponentRegistry.register(
    'uitext',
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
        anchor: p.anchor as AnchorPreset | undefined,
        anchorOffset: p.anchorOffset as [number, number] | undefined,
      }),
    (c, p) => {
      const t = c as UITextComponent
      if (p.text !== undefined) t.text = p.text as string
      if (p.fontSize !== undefined) t.fontSize = p.fontSize as number
      if (p.color !== undefined) t.color = p.color as string
      if (p.align !== undefined) t.align = p.align as 'left' | 'center' | 'right'
      if (p.zOrder !== undefined) t.zOrder = p.zOrder as number
      if (p.anchor !== undefined) t.anchor = p.anchor as AnchorPreset
      if (p.anchorOffset !== undefined) t.anchorOffset = p.anchorOffset as [number, number]
    },
  )

  // ─── uiimage ─── props: { color?, radius?, opacity?, src?, worldWidth?, worldHeight?, anchor?, anchorOffset? }
  ComponentRegistry.register(
    'uiimage',
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
        anchor: p.anchor as AnchorPreset | undefined,
        anchorOffset: p.anchorOffset as [number, number] | undefined,
      }),
    (c, p) => {
      const img = c as UIImageComponent
      if (p.color !== undefined) img.color = p.color as string
      if (p.radius !== undefined) img.radius = p.radius as number
      if (p.src !== undefined) img.loadImage(p.src as string)
      if (p.zOrder !== undefined) img.zOrder = p.zOrder as number
      if (p.anchor !== undefined) img.anchor = p.anchor as AnchorPreset
      if (p.anchorOffset !== undefined) img.anchorOffset = p.anchorOffset as [number, number]
    },
  )

  // ─── uibutton ─── props: { colors?, anchor?, anchorOffset?, onClick? (代码设置) }
  // 仅交互功能：背景色随状态变化；文字由独立子 Actor 挂 uitext 提供。
  ComponentRegistry.register(
    'uibutton',
    (owner, p = {}) =>
      new UIButtonComponent(owner, {
        colors: p.colors as Record<string, string> | undefined,
        worldWidth: p.worldWidth as number | undefined,
        worldHeight: p.worldHeight as number | undefined,
        color: p.color as string | undefined,
        radius: p.radius as number | undefined,
        anchor: p.anchor as AnchorPreset | undefined,
        anchorOffset: p.anchorOffset as [number, number] | undefined,
      }),
    (c, p) => {
      const btn = c as UIButtonComponent
      if (p.zOrder !== undefined) btn.zOrder = p.zOrder as number
      if (p.anchor !== undefined) btn.anchor = p.anchor as AnchorPreset
      if (p.anchorOffset !== undefined) btn.anchorOffset = p.anchorOffset as [number, number]
    },
  )
}
