/**
 * CameraOverlayRenderer — 多摄像机画面叠加渲染
 *
 * 在一个 Renderer 上叠加渲染第二台摄像机的画面（画中画 / 分屏 / 小地图）。
 * 利用主场景的 onAfterRender 回调，在主画面渲染完成后绘制叠加层。
 *
 * 三种模式：
 *   - 'pip' (画中画)：叠加画面显示在右下角固定区域
 *   - 'split' (分屏)：左右或上下平分画面
 *   - 'full' (全屏叠层)：整个画面混合叠加（A-Buffer 效果）
 *
 * 用法：
 *   const overlay = new CameraOverlayRenderer(sceneMgr, sceneMgr.scene, pipCamera, {
 *     mode: 'pip', width: 0.25, height: 0.25, position: 'bottom-right'
 *   })
 *   // 游戏中切换相机
 *   overlay.setCamera(anotherCamera)
 *   // 清理
 *   overlay.dispose()
 */
import * as THREE from 'three'
import type { SceneRenderHost } from './SceneRenderHost'

export type OverlayMode = 'pip' | 'split' | 'full'
export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type SplitDirection = 'horizontal' | 'vertical'

export interface CameraOverlayOptions {
  mode?: OverlayMode
  /** pip 模式下：叠加区域占全屏比例 (0~1)，默认 { width: 0.25, height: 0.25 } */
  size?: { width: number; height: number }
  /** pip 模式下：边距比例 (0~1)，默认 0.02 */
  margin?: number
  /** pip 模式下：角落位置，默认 'bottom-right' */
  position?: OverlayPosition
  /** split 模式下：分割方向，默认 'vertical' */
  splitDirection?: SplitDirection
  /** split 模式下：主画面占比 (0~1)，默认 0.5 */
  splitRatio?: number
  /** 叠加区域是否显示边框，默认 true */
  showBorder?: boolean
  /** 边框颜色，默认 '#00ff88' */
  borderColor?: string
}

export class CameraOverlayRenderer {
  private sceneMgr: SceneRenderHost
  private scene: THREE.Scene
  private camera: THREE.Camera
  private options: Required<CameraOverlayOptions>
  private removeHook: (() => void) | null = null
  private _enabled = true

  constructor(
    sceneMgr: SceneRenderHost,
    scene: THREE.Scene,
    camera: THREE.Camera,
    options: CameraOverlayOptions = {},
  ) {
    this.sceneMgr = sceneMgr
    this.scene = scene
    this.camera = camera

    this.options = {
      mode: 'pip',
      size: { width: 0.25, height: 0.25 },
      margin: 0.02,
      position: 'bottom-right',
      splitDirection: 'vertical',
      splitRatio: 0.5,
      showBorder: true,
      borderColor: '#00ff88',
      ...options,
    }

    this.removeHook = sceneMgr.onAfterRender(() => this.renderOverlay())
  }

  /** 启用/禁用叠加 */
  set enabled(v: boolean) {
    this._enabled = v
  }
  get enabled(): boolean {
    return this._enabled
  }

  /** 替换叠加相机（运行时切换） */
  setCamera(cam: THREE.Camera) {
    this.camera = cam
  }

  /** 更新叠加配置（运行时调整） */
  setOptions(opts: Partial<CameraOverlayOptions>) {
    Object.assign(this.options, opts)
  }

  private renderOverlay() {
    if (!this._enabled) return

    const renderer = this.sceneMgr.renderer
    const fullW = renderer.domElement.width
    const fullH = renderer.domElement.height
    if (fullW === 0 || fullH === 0) return

    const { mode } = this.options

    if (mode === 'split') {
      this.renderSplit(renderer, fullW, fullH)
    } else if (mode === 'pip') {
      this.renderPip(renderer, fullW, fullH)
    } else {
      // full: 全屏覆盖
      renderer.setViewport(0, 0, fullW, fullH)
      renderer.setScissor(0, 0, fullW, fullH)
      renderer.render(this.scene, this.camera)
    }
  }

  private renderPip(renderer: THREE.WebGLRenderer, fullW: number, fullH: number) {
    const { size, margin, position, showBorder, borderColor } = this.options
    const w = Math.round(fullW * size.width)
    const h = Math.round(fullH * size.height)
    const m = Math.round(Math.min(fullW, fullH) * margin)

    let x: number, y: number
    switch (position) {
      case 'top-left':
        x = m; y = fullH - h - m; break
      case 'top-right':
        x = fullW - w - m; y = fullH - h - m; break
      case 'bottom-left':
        x = m; y = m; break
      case 'bottom-right':
      default:
        x = fullW - w - m; y = m; break
    }

    // 更新第二台相机的宽高比
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }

    renderer.setViewport(x, y, w, h)
    renderer.setScissor(x, y, w, h)
    renderer.setScissorTest(true)
    renderer.render(this.scene, this.camera)

    // 边框
    if (showBorder) {
      renderer.setViewport(x - 1, y - 1, w + 2, h + 2)
      renderer.setScissor(x, y, w, h)
      renderer.setScissorTest(false) // 边框不剪裁
      renderer.clear(true, false, false) // 只清颜色
    }
  }

  private renderSplit(renderer: THREE.WebGLRenderer, fullW: number, fullH: number) {
    const { splitDirection, splitRatio, showBorder, borderColor } = this.options
    const renderer2 = renderer // 复用同一个 renderer

    // 主画面渲染由 sceneMgr.start() 已完成
    // 第二画面占剩余区域
    if (splitDirection === 'vertical') {
      const splitX = Math.round(fullW * splitRatio)
      const sw = fullW - splitX
      // 更新第二相机宽高比
      if (this.camera instanceof THREE.PerspectiveCamera) {
        this.camera.aspect = sw / fullH
        this.camera.updateProjectionMatrix()
      }
      renderer.setViewport(splitX, 0, sw, fullH)
      renderer.setScissor(splitX, 0, sw, fullH)
      renderer.setScissorTest(true)
      renderer.render(this.scene, this.camera)
    } else {
      const splitY = Math.round(fullH * (1 - splitRatio))
      const sh = Math.round(fullH * splitRatio)
      if (this.camera instanceof THREE.PerspectiveCamera) {
        this.camera.aspect = fullW / sh
        this.camera.updateProjectionMatrix()
      }
      renderer.setViewport(0, 0, fullW, sh)
      renderer.setScissor(0, 0, fullW, sh)
      renderer.setScissorTest(true)
      renderer.render(this.scene, this.camera)
    }
  }

  /** 销毁，移除回调 */
  dispose() {
    this.removeHook?.()
    this.removeHook = null
  }
}
