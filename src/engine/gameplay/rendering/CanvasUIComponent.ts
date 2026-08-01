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
import { Component } from '../entity/Component'
import { logger } from '../../Logger'
import type { Actor } from '../entity/Actor'

/**
 * 九宫格锚点预设（相对父容器，Unity Anchor Preset 风格）
 *  - 决定 UI 元素中心在父容器九宫格上的对齐位置
 *  - 默认贴合容器内边（不溢出），可用 anchorOffset 微调
 */
export type AnchorPreset =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** 锚点 → 方向因子（x: -1 左/0 中/+1 右，y: -1 下/0 中/+1 上） */
const ANCHOR_FACTORS: Record<AnchorPreset, [number, number]> = {
  'top-left': [-1, 1], 'top-center': [0, 1], 'top-right': [1, 1],
  'middle-left': [-1, 0], 'middle-center': [0, 0], 'center': [0, 0], 'middle-right': [1, 0],
  'bottom-left': [-1, -1], 'bottom-center': [0, -1], 'bottom-right': [1, -1],
}

export interface CanvasUIOptions {
  width?: number           // canvas 像素宽，默认 512
  height?: number          // canvas 像素高，默认 256
  worldWidth?: number      // 3D 世界宽（米），默认 5
  worldHeight?: number     // 3D 世界高（米），默认 2.5
  doubleSided?: boolean    // 是否双面可见，默认 true
  name?: string
  zOrder?: number          // UI 层级（越大越靠前），默认 0
  /** 九宫格锚点（相对父容器画布），默认 null（不自动定位，用 position） */
  anchor?: AnchorPreset
  /** 相对锚点的世界偏移 [x, y]，默认 [0, 0] */
  anchorOffset?: [number, number]
  /**
   * 仅标记模式（默认 false）：只把 Actor 标记为 UI 元素，不创建渲染 mesh。
   * 用于"每个 UI Actor 挂一个 canvasui 作为 UI 标识"的约定；
   * 不参与 findContainerSize 容器查找（子元素锚点仍以真正的画布为基准）。
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

  /** 九宫格锚点（null = 不自动定位，沿用 position） */
  private _anchor: AnchorPreset | null = null
  /** 相对锚点的世界偏移 */
  private _anchorOffset: [number, number] = [0, 0]

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

    const ww = options.worldWidth ?? 5
    const wh = options.worldHeight ?? 2.5
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
    if (options.anchor !== undefined) this._anchor = options.anchor
    if (options.anchorOffset !== undefined) this._anchorOffset = options.anchorOffset
    else if (this._anchor) this._anchorOffset = [0, 0]
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

  /** 九宫格锚点（null = 不自动定位，沿用 position） */
  get anchor(): AnchorPreset | null { return this._anchor }
  set anchor(v: AnchorPreset | null) {
    logger.debug(`[CanvasUIComponent] "${this.name}" 设置锚点: ${v ?? 'null'}（offset=${JSON.stringify(this._anchorOffset)}）`)
    this._anchor = v
    this.applyAnchor()
  }

  /** 相对锚点的世界偏移 */
  get anchorOffset(): [number, number] { return this._anchorOffset }
  set anchorOffset(v: [number, number]) {
    logger.debug(`[CanvasUIComponent] "${this.name}" 设置锚点偏移: [${v[0]}, ${v[1]}]`)
    this._anchorOffset = v
    this.applyAnchor()
  }

  /**
   * 应用九宫格锚点：按父容器画布尺寸把元素中心放到锚点位置。
   * 语义（Unity Anchor Preset）：
   *  - 元素边缘贴合容器内边（不溢出），中心 = 父中心 + 方向因子 × (父半尺寸 − 自身半尺寸)
   *  - anchorOffset 在此基准上微调
   *  - 找不到父画布（根画布自身）时跳过，沿用 position
   */
  applyAnchor(): void {
    logger.debug(`[CanvasUIComponent] "${this.name}" applyAnchor 进入 (anchor=${this._anchor ?? 'null'})`)
    if (!this._anchor) {
      logger.debug(`[CanvasUIComponent] "${this.name}" 无锚点，跳过定位（沿用 position）`)
      return
    }
    const container = this.findContainerSize()
    if (!container) {
      logger.warn(`[CanvasUIComponent] "${this.name}" 未找到父画布容器，跳过锚点 ${this._anchor}（树未构建？）`)
      return
    }
    const factors = ANCHOR_FACTORS[this._anchor]
    if (!factors) {
      logger.error(`[CanvasUIComponent] "${this.name}" 未知锚点值 "${this._anchor}"，已跳过`)
      return
    }
    const [fx, fy] = factors
    const [cw, ch] = container
    const [sw, sh] = this.getWorldSize()
    const ox = this._anchorOffset[0] ?? 0
    const oy = this._anchorOffset[1] ?? 0
    const x = fx * (cw / 2 - sw / 2) + ox
    const y = fy * (ch / 2 - sh / 2) + oy
    this.owner.setPosition(x, y, this.owner.root.position.z)
    logger.info(`[CanvasUIComponent] "${this.name}" 锚点 ${this._anchor} → 位置 (${x.toFixed(3)}, ${y.toFixed(3)})（容器=${cw}x${ch}, 自身=${sw.toFixed(3)}x${sh.toFixed(3)}, offset=[${ox}, ${oy}]）`)
  }

  /** 向上查找最近的父画布尺寸（父 Actor 上的 CanvasUIComponent 世界尺寸；跳过仅标记组件） */
  private findContainerSize(): [number, number] | null {
    let p = this.owner.parent
    let hops = 0
    while (p) {
      // 取该 Actor 上第一个"真正画布"（非仅标记）——markerOnly 组件只作 UI 标识，不作为容器
      const comp = p.getComponents(CanvasUIComponent).find((c) => !c.isMarkerOnly)
      if (comp) {
        const size = comp.getWorldSize()
        logger.debug(`[CanvasUIComponent] "${this.name}" 找到父画布: Actor="${p.name}" 尺寸=${size[0]}x${size[1]} (${hops + 1} 级向上)`)
        return size
      }
      p = p.parent
      hops++
    }
    logger.debug(`[CanvasUIComponent] "${this.name}" 未找到父画布（parent=${this.owner.parent?.name ?? 'null'}）`)
    return null
  }

  override BeginPlay() {
    logger.debug(`[CanvasUIComponent] "${this.name}" BeginPlay 进入 (anchor=${this._anchor ?? 'null'})`)
    super.BeginPlay()
    // 树构建完成（所有 attachTo 已就绪）后应用锚点定位
    this.applyAnchor()
    logger.debug(`[CanvasUIComponent] "${this.name}" BeginPlay 退出`)
  }

  /** 获取 canvas 像素尺寸 */
  getSize(): [number, number] {
    return [this._width, this._height]
  }

  /** 设置 3D 世界尺寸（单位：米） */
  setWorldSize(w: number, h: number) {
    this._worldW = w
    this._worldH = h
    this.panel?.scale.set(w, h, 1)
  }

  /** 获取 3D 世界尺寸 */
  getWorldSize(): [number, number] {
    return [this._worldW, this._worldH]
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
