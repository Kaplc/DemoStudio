/**
 * CanvasUIComponent — 基于 CanvasTexture 的 3D 世界空间 UI 面板
 *
 * 用 <canvas> 2D API 自绘 UI → 贴到 THREE.PlaneGeometry 上 → 挂载为 Actor 的 Component。
 * 与你现有 SpriteComponent / MeshComponent 同级的 Component 模式。
 *
 * 特点：
 *  - 纯 GPU 渲染（作为贴图 mesh），可被其他 3D 物体遮挡
 *  - 支持任意 Canvas 2D 绘制（矩形/图片/渐变/emoji/圆角）
 *  - 运行时 draw() 增量更新纹理
 *  - 像素位图，需按目标精度设置 canvas 分辨率
 *
 * 用法：
 *   const ui = new CanvasUIComponent(actor, { width: 512, height: 256 })
 *   actor.addComponent(ui)
 *   ui.draw((ctx, w, h) => {
 *     ctx.fillStyle = 'rgba(0,0,0,0.7)'
 *     ctx.fillRect(0, 0, w, h)
 *     ctx.fillStyle = '#ffcc00'
 *     ctx.font = '24px monospace'
 *     ctx.fillText('任务公告', 20, 50)
 *   })
 *   ui.setWorldSize(5, 2.5)  // 设置 3D 世界尺寸（米）
 */
import * as THREE from 'three'
import { Component, type EditableProperty } from '../entity/Component'
import { logger } from '../../Logger'
import type { Actor } from '../entity/Actor'
// 循环引用（UITransformComponent → CanvasUIComponent）：ESM 活绑定，构造时使用安全
import { UITransformComponent } from '../ui/UITransformComponent'

export interface CanvasUIOptions {
  width?: number           // canvas 像素宽，默认 512
  height?: number          // canvas 像素高，默认 256
  worldWidth?: number      // 3D 世界宽（米），默认 5
  worldHeight?: number     // 3D 世界高（米），默认 2.5
  doubleSided?: boolean    // 是否双面可见，默认 true
  name?: string
  zOrder?: number          // UI 层级（越大越靠前），默认 0
  /**
   * 仅标记模式（默认 false）：只把 Actor 标记为 UI 元素，不创建渲染 mesh。
   * 用于"每个 UI Actor 挂一个 canvasui 作为 UI 标识"的约定；
   * 不参与锚点容器查找（子元素锚点由 UITransformComponent 以真正的画布为基准）。
   */
  markerOnly?: boolean
}

export class CanvasUIComponent extends Component {
  /** 渲染面板；markerOnly 模式下为 null */
  public panel: THREE.Mesh | null
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  private texture: THREE.CanvasTexture
  private _width: number
  private _height: number
  private _worldW = 5
  private _worldH = 2.5
  private _zOrder = 0
  /** 仅标记模式（不渲染） */
  private _markerOnly: boolean

  constructor(owner: Actor, options: CanvasUIOptions = {}) {
    super(owner)
    this.name = options.name ?? 'CanvasUIComponent'
    this._width = options.width ?? 512
    this._height = options.height ?? 256
    this._markerOnly = options.markerOnly ?? false

    // 1. 离屏 Canvas
    this.canvas = document.createElement('canvas')
    this.canvas.width = this._width
    this.canvas.height = this._height
    this.ctx = this.canvas.getContext('2d')!

    // 2. Canvas → Texture
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter

    // 世界尺寸：优先 uitransform（尺寸归 transform 管，Unity RectTransform 风格）。
    //  - tsf 已显式设置且组件未传 → 用 tsf 值（JSON 迁移后标准）
    //  - 组件显式传入（uitext 推导 / 旧数据兼容）→ 组件值并同步回 tsf
    let ww = options.worldWidth ?? 5
    let wh = options.worldHeight ?? 2.5
    const uiTf = owner.getComponent(UITransformComponent)
    if (uiTf) {
      if (uiTf.worldSizeExplicit && options.worldWidth === undefined && options.worldHeight === undefined) {
        ;[ww, wh] = uiTf.getWorldSize()
      } else if (options.worldWidth !== undefined || options.worldHeight !== undefined) {
        uiTf.setWorldSize(ww, wh)
      }
    }
    this._worldW = ww
    this._worldH = wh

    if (this._markerOnly) {
      // 仅标记模式：不创建 mesh、不挂到场景，仅声明"本 Actor 是 UI"
      this.panel = null
      logger.info(`[CanvasUIComponent] 创建 "${this.name}": 仅标记模式（不渲染，标记 Actor 为 UI）`)
    } else {
      // 3. Texture → Plane Mesh（共享单位几何体，scale 控制尺寸）
      const geo = new THREE.PlaneGeometry(1, 1)
      const mat = new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        side: (options.doubleSided ?? true) ? THREE.DoubleSide : THREE.FrontSide,
      })
      this.panel = new THREE.Mesh(geo, mat)
      this.panel.scale.set(ww, wh, 1)
      owner.root.add(this.panel)
      logger.info(`[CanvasUIComponent] 创建 "${this.name}": canvas=${this._width}x${this._height}px, world=${ww}x${wh}, zOrder=${this._zOrder}`)
    }

    if (options.zOrder !== undefined) this.zOrder = options.zOrder
  }

  /** 仅标记模式（不渲染，仅作 UI 标识） */
  get isMarkerOnly(): boolean { return this._markerOnly }

  /** UI 层级（越大越靠前）：设置 renderOrder + panel z 偏移分层 */
  get zOrder(): number { return this._zOrder }
  set zOrder(v: number) {
    this._zOrder = v
    if (!this.panel) return
    this.panel.renderOrder = v
    // z 偏移分层：zOrder 每 +1 对应 0.001 世界单位前移（正交相机下无透视变形）
    this.panel.position.z = v * 0.001
  }

  override BeginPlay() {
    logger.debug(`[CanvasUIComponent] "${this.name}" BeginPlay 进入`)
    super.BeginPlay()
    logger.debug(`[CanvasUIComponent] "${this.name}" BeginPlay 退出`)
  }

  /** 获取 canvas 像素尺寸 */
  getSize(): [number, number] {
    return [this._width, this._height]
  }

  /** 设置 3D 世界尺寸（单位：米）；同步到 owner 的 uitransform（尺寸权威在 transform） */
  setWorldSize(w: number, h: number) {
    this._worldW = w
    this._worldH = h
    this.panel?.scale.set(w, h, 1)
    this.owner.getComponent(UITransformComponent)?.setWorldSize(w, h)
  }

  /**
   * 世界尺寸变化钩子：由 UITransformComponent.setWorldSize 遍历调用（含 markerOnly 组件）。
   * 子类可覆写以响应尺寸变化（如 UITextComponent 重算字形字号）。
   */
  onWorldSizeChange(): void {}

  /** 获取 3D 世界尺寸；优先读 owner 的 uitransform */
  getWorldSize(): [number, number] {
    const uiTf = this.owner.getComponent(UITransformComponent)
    if (uiTf) return uiTf.getWorldSize()
    return [this._worldW, this._worldH]
  }

  /** Inspector 属性展示（世界尺寸在 uitransform 上展示） */
  override getProperties(): Record<string, unknown> {
    const [cw, ch] = this.getSize()
    return {
      canvas: `${cw}×${ch}px`,
      zOrder: this._zOrder,
      markerOnly: this._markerOnly,
    }
  }

  /** Inspector 可编辑属性：UI 层级（number） */
  override getEditableProperties(): EditableProperty[] {
    return [
      {
        key: 'zOrder', type: 'number', step: 1, min: 0, max: 100,
        get: () => this._zOrder,
        set: (v) => { this.zOrder = v as number },
      },
    ]
  }

  /** 保留 2 位小数的数值 */
  protected round2(v: number): number {
    return Math.round(v * 100) / 100
  }

  /** 设置不透明度 */
  setOpacity(opacity: number) {
    if (!this.panel) return
    ;(this.panel.material as THREE.MeshBasicMaterial).opacity = opacity
    ;(this.panel.material as THREE.MeshBasicMaterial).transparent = opacity < 1
  }

  /** 自定义绘制回调。每次调用清空 canvas 并执行 fn，然后标记纹理更新 */
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    this.ctx.clearRect(0, 0, this._width, this._height)
    fn(this.ctx, this._width, this._height)
    logger.debug(`[CanvasUIComponent] "${this.name}" 重绘 (${this._width}x${this._height})`)
  }

  /** 只标记纹理更新（外部已通过 this.ctx 直接绘制） */
  markDirty() {
    this.texture.needsUpdate = true
    logger.debug(`[CanvasUIComponent] "${this.name}" 纹理标记脏`)
  }

  override EndPlay() {
    logger.info(`[CanvasUIComponent] 销毁 "${this.name}"`)
    super.EndPlay()
    if (!this.panel) return // 仅标记模式无渲染资源
    this.owner.root.remove(this.panel)
    this.texture.dispose()
    this.panel.geometry.dispose()
    ;(this.panel.material as THREE.MeshBasicMaterial).dispose()
  }
}
