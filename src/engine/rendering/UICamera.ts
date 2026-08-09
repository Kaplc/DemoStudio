/**
 * UICamera — UI 独立叠加相机（游戏视口 UI 渲染）
 *
 * 负责游戏 UI 场景的独立正交相机 + 叠加渲染：
 *  - 相机：正交，contain 模式完整显示 UI 画布（9.6×5.4），
 *    非 16:9 视口时画布完整居中、两侧留空（不裁切）
 *  - 渲染：主场景渲染后叠加（autoClear=false + clearDepth），UI 永远在顶层
 *  - 点击：PhySys.setupUI(camera) 用此相机做平行射线检测
 *
 * 由 SceneRendererComponent 持有；随组件销毁终态化（BObject.EndPlay）。
 *
 * 继承 BObject：纳入引擎对象体系（构造自动注册到 ObjectRegistry，泄漏诊断可见）。
 */
import * as THREE from 'three'
import { BObject } from '../entity/BObject'
import { logger } from '../Logger'

/** UI 根画布世界尺寸（资产约定：widget 蓝图根节点 worldWidth/worldHeight） */
export const UI_CANVAS_W = 9.6
export const UI_CANVAS_H = 5.4

export class UICamera extends BObject {
  /** 底层正交相机（视锥由 setCanvasSize 按 contain 模式维护） */
  readonly camera: THREE.OrthographicCamera

  /** 当前挂载的 UI 场景（null = 未挂载） */
  private _scene: THREE.Scene | null = null

  constructor() {
    super('UICamera')
    // 初始视锥为 16:9 画布（9.6×5.4），实际由 setCanvasSize 按 contain 维护
    this.camera = new THREE.OrthographicCamera(-4.8, 4.8, 2.7, -2.7, 0.1, 200)
    this.camera.position.set(0, 0, 10) // z=0 为 UI 面板平面（zOrder 偏移量级为 0.001）
    this.camera.lookAt(0, 0, 0)
  }

  /** 当前挂载的 UI 场景 */
  get scene(): THREE.Scene | null {
    return this._scene
  }

  /** 挂载/分离 UI 场景 */
  attach(scene: THREE.Scene | null): void {
    this._scene = scene
    logger.info(`[UICamera] UI 场景${scene ? '已挂载' : '已分离'}${scene ? '（双摄像机叠加渲染）' : ''}`)
  }

  /**
   * contain 模式同步视锥：完整显示 UI 画布（9.6×5.4）。
   * 视口 16:9 → 画布正好铺满；更宽/更窄 → 画布完整居中，多余空间留空（不裁切）。
   * @param canvasW 画布像素宽（渲染器尺寸）
   * @param canvasH 画布像素高
   */
  setCanvasSize(canvasW: number, canvasH: number): void {
    const scale = Math.min(canvasW / UI_CANVAS_W, canvasH / UI_CANVAS_H)
    const halfW = canvasW / scale / 2
    const halfH = canvasH / scale / 2
    this.camera.left = -halfW
    this.camera.right = halfW
    this.camera.top = halfH
    this.camera.bottom = -halfH
    this.camera.updateProjectionMatrix()
  }

  /** 叠加渲染 UI 场景（主场景渲染后调用；UI 永远在顶层） */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this._scene) return
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(this._scene, this.camera)
    renderer.autoClear = prevAutoClear
  }

  /** 终态（BObject.EndPlay 自动 markDestroyed + 注册表注销，幂等） */
  override EndPlay(): void {
    this._scene = null
    super.EndPlay()
  }
}
