/**
 * UICamera — 2D UI 渲染摄像机
 *
 * 为游戏 UI 提供独立的 2D 正交渲染层，拥有自己的 THREE.Scene 和 OrthographicCamera。
 * 基于"设计分辨率"概念：设置一个逻辑尺寸（如 1920×1080），
 * 所有 UI 元素用像素坐标定位，UICamera 自动按视口比例缩放适配。
 *
 * 通过 Compositor2D 与主 3D 场景叠加渲染（UI 永远在顶层）。
 *
 * 用法：
 *   const uiCam = new UICamera(renderer, 1920, 1080)
 *   // 接入渲染循环
 *   sceneMgr.onAfterRender(() => uiCam.render())
 *
 *   // 添加 2D 元素
 *   const canvas = uiCam.createCanvas(400, 200)
 *   canvas.setPosition(960, 540)  // 屏幕居中
 *   canvas.draw((ctx, w, h) => {
 *     ctx.fillStyle = '#1a1a2e'
 *     ctx.fillRect(0, 0, w, h)
 *   })
 */
import * as THREE from 'three'
import { logger } from '../Logger'

export class UICamera {
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly designWidth: number
  readonly designHeight: number

  private renderer: THREE.WebGLRenderer
  private _scale = 1

  constructor(renderer: THREE.WebGLRenderer, designWidth: number, designHeight: number) {
    this.renderer = renderer
    this.designWidth = designWidth
    this.designHeight = designHeight

    // 独立场景
    this.scene = new THREE.Scene()

    // 正交相机：以设计分辨率为中心，左下角为 (0,0)，右上角为 (designW, designH)
    const halfW = designWidth / 2
    const halfH = designHeight / 2
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0, 100)
    this.camera.position.set(0, 0, 10)
    this.camera.lookAt(0, 0, 0)

    this.updateScale()
    logger.info(`[UICamera] 创建: 设计分辨率 ${designWidth}x${designHeight}, scale=${this._scale.toFixed(3)}`)
  }

  /** 根据实际视口尺寸计算缩放比例 */
  private updateScale(): void {
    const w = this.renderer.domElement.width || this.renderer.domElement.clientWidth
    const h = this.renderer.domElement.height || this.renderer.domElement.clientHeight
    if (w === 0 || h === 0) { this._scale = 1; return }
    this._scale = Math.min(w / this.designWidth, h / this.designHeight)
  }

  /** 获取当前像素到设计坐标的缩放比 */
  get scale(): number { return this._scale }

  /** 像素坐标 → 设计坐标 */
  pixelToDesign(px: number, py: number): [number, number] {
    this.updateScale()
    const sx = this.renderer.domElement.width || this.renderer.domElement.clientWidth
    const sy = this.renderer.domElement.height || this.renderer.domElement.clientHeight
    return [
      (px / sx) * this.designWidth,
      this.designHeight - (py / sy) * this.designHeight,
    ]
  }

  /** 设计坐标 → 像素坐标 */
  designToPixel(dx: number, dy: number): [number, number] {
    this.updateScale()
    const sx = this.renderer.domElement.width || this.renderer.domElement.clientWidth
    const sy = this.renderer.domElement.height || this.renderer.domElement.clientHeight
    return [
      (dx / this.designWidth) * sx,
      (1 - dy / this.designHeight) * sy,
    ]
  }

  /** 渲染 UI（在主场景渲染完后调用） */
  render(): void {
    if (this.scene.children.length === 0) return
    this.updateScale()

    const prevAutoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.render(this.scene, this.camera)
    this.renderer.autoClear = prevAutoClear
    logger.debug(`[UICamera] 渲染 UI 层 (元素数=${this.scene.children.length})`)
  }

  /**
   * 创建一个 UICanvas 并添加到场景中。
   * 简写方式：等价于 new UICanvas(...) 再 addCanvas(canvas)
   */
  createCanvas(width: number, height: number): UICanvas {
    const canvas = new UICanvas(width, height)
    this.addCanvas(canvas)
    logger.info(`[UICamera] 创建 UICanvas ${width}x${height}（当前元素数=${this.scene.children.length}）`)
    return canvas
  }

  /** 将已存在的 UICanvas 加入场景 */
  addCanvas(canvas: UICanvas): void {
    this.scene.add(canvas.mesh)
    logger.debug(`[UICamera] 添加 UICanvas（当前元素数=${this.scene.children.length}）`)
  }

  /** 从场景移除 UICanvas */
  removeCanvas(canvas: UICanvas): void {
    this.scene.remove(canvas.mesh)
    logger.debug(`[UICamera] 移除 UICanvas（当前元素数=${this.scene.children.length}）`)
  }

  /** 清空所有 UI 元素 */
  clear(): void {
    logger.info(`[UICamera] 清空 UI 元素（元素数=${this.scene.children.length}）`)
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0]
      this.scene.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    }
  }

  /** 销毁 */
  dispose(): void {
    this.clear()
  }
}

// ════════════════════════════════════════
//  UICanvas — 2D 界面画布元素
// ════════════════════════════════════════

export interface UICanvasOptions {
  opacity?: number
  doubleSided?: boolean
  name?: string
}

export class UICanvas {
  readonly mesh: THREE.Mesh
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D

  private texture: THREE.CanvasTexture
  private _width: number
  private _height: number

  constructor(width: number, height: number, options: UICanvasOptions = {}) {
    this._width = width
    this._height = height

    // 离屏 Canvas
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d')!

    // Canvas → Texture
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter

    // Texture → Plane Mesh（单位尺寸，通过 scale 设实际大小）
    const geo = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: options.opacity ?? 1,
      side: (options.doubleSided ?? false) ? THREE.DoubleSide : THREE.FrontSide,
      depthTest: false,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.scale.set(width, height, 1)
  }

  /** 获取像素尺寸 */
  get width(): number { return this._width }
  get height(): number { return this._height }

  /** 设置设计坐标位置 (x, y) 为元素中心 */
  setPosition(x: number, y: number): void {
    this.mesh.position.set(x, y, 0)
  }

  /** 获取设计坐标位置 */
  getPosition(): [number, number] {
    return [this.mesh.position.x, this.mesh.position.y]
  }

  /** 设置旋转角度（度） */
  setRotation(degrees: number): void {
    this.mesh.rotation.z = (degrees * Math.PI) / 180
  }

  /** 设置不透明度 */
  setOpacity(opacity: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity
    ;(this.mesh.material as THREE.MeshBasicMaterial).transparent = opacity < 1
  }

  /** 自定义绘制：清空画布并执行回调 */
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    this.ctx.clearRect(0, 0, this._width, this._height)
    fn(this.ctx, this._width, this._height)
    this.texture.needsUpdate = true
  }

  /** 标记纹理脏（配合外部直接 ctx 操作） */
  markDirty(): void {
    this.texture.needsUpdate = true
  }

  /** 销毁 */
  dispose(): void {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.MeshBasicMaterial).dispose()
  }
}
