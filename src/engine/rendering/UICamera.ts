/**
 * UICamera — UI 独立叠加相机（游戏视口 UI 渲染）
 *
 * 负责游戏 UI 场景的独立正交相机 + 叠加渲染：
 *  - 相机：正交，contain 模式完整显示 UI 画布（1920×1080），
 *    非 16:9 视口时画布完整居中、两侧留空（不裁切）
 *  - 渲染：主场景渲染后叠加（autoClear=false + clearDepth），UI 永远在顶层
 *  - 点击：PhySys.setupUI(camera) 用此相机做平行射线检测
 *
 * UI 世界单位 = 设计像素（1 单位 = 1px，UI 单位一元化，doc-dev/ui-unit-unification）：
 * 相机 contain 视锥是把 1920×1080 的 UI 像素世界整体缩放到实际渲染视口的唯一开关。
 *
 * 由 SceneRendererComponent 持有；随组件销毁终态化（BObject.EndPlay）。
 *
 * 继承 BObject：纳入引擎对象体系（构造自动注册到 ObjectRegistry，泄漏诊断可见）。
 */
import * as THREE from 'three'
import { BObject } from '../entity/BObject'
import { logger } from '../Logger'

/** UI 根画布世界尺寸 = 设计像素尺寸（资产约定：widget 蓝图根节点 worldWidth/worldHeight = 画布 px） */
export const UI_CANVAS_W = 1920
export const UI_CANVAS_H = 1080

/** 复用临时向量（projectToUi 高频调用，避免每帧分配） */
const _projVec = new THREE.Vector3()
/** 剔除判定专用向量（project 内部会再乘 viewMatrix，不能与投影共用） */
const _cullVec = new THREE.Vector3()

export class UICamera extends BObject {
  /**
   * 世界坐标 → UI 设计像素坐标（静态工具，World-Space UI 投影唯一入口）。
   *
   * NDC 投影后线性映射到 1920×1080 设计画布（原点画布中心、y 向上）：
   *   ui.x = ndc.x * 960 + 960, ui.y = ndc.y * 540 + 540
   *
   * 背面剔除：相机背后的点投影会镜像翻转到屏内，以 NDC z/w 判定剔除返回 null
   * （点在相机后方时 project 产生的 w<0，投影坐标不可信）。视锥内的裁剪交由上层
   * （clamping 出屏钳制 / 背后隐藏整树）处理，本方法只负责"可信投影 or null"。
   *
   * @param camera   主透视/正交相机（内部会先刷新矩阵，容忍位姿刚变未 update）
   * @param worldPos 世界坐标（米制 3D 世界）
   * @returns [x, y] UI 设计像素坐标；相机背面/无相机返回 null
   */
  static projectToUi(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null, worldPos: THREE.Vector3): [number, number] | null {
    if (!camera) return null
    camera.updateMatrixWorld()
    // 背面剔除（先于投影）：变换到相机空间，相机看向 -z，相机空间 z>0 即在相机背后
    // （此时透视除法产生的镜像坐标不可信）。用独立向量——project 内部会再乘 viewMatrix。
    _cullVec.copy(worldPos)
    const camSpaceZ = _cullVec.applyMatrix4(camera.matrixWorldInverse).z
    if (camSpaceZ > 0) return null
    // project 内部：applyMatrix4(viewMatrix) → applyMatrix4(projectionMatrix) → 透视除法
    const v = _projVec.copy(worldPos).project(camera)
    return [v.x * UI_CANVAS_W * 0.5 + UI_CANVAS_W * 0.5, v.y * UI_CANVAS_H * 0.5 + UI_CANVAS_H * 0.5]
  }
  /** 底层正交相机（视锥由 setCanvasSize 按 contain 模式维护） */
  readonly camera: THREE.OrthographicCamera

  /** 当前挂载的 UI 场景（null = 未挂载） */
  private _scene: THREE.Scene | null = null

  constructor() {
    super('UICamera')
    // 初始视锥为 16:9 画布（1920×1080），实际由 setCanvasSize 按 contain 维护
    this.camera = new THREE.OrthographicCamera(-960, 960, 540, -540, 0.1, 200)
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
   * contain 视锥设计尺寸（共享计算，UIManager.relayoutForViewport 与 setCanvasSize 同式）：
   * scale = min(canvasW/1920, canvasH/1080)，视锥 = 画布/scale（设计单位，恒 ⊇ 画布）。
   * 16:9 → 1920×1080；4:3 画布(1440×1080) → 1920×1440；超宽(2560×1080) → 2560×1080。
   */
  static computeContainFrustum(canvasW: number, canvasH: number): [number, number] {
    const scale = Math.min(canvasW / UI_CANVAS_W, canvasH / UI_CANVAS_H)
    return [canvasW / scale, canvasH / scale]
  }

  /**
   * contain 模式同步视锥：完整显示 UI 画布（1920×1080 设计像素）。
   * 视口 16:9 → 画布正好铺满；更宽/更窄 → 画布完整居中，多余空间留空（不裁切）。
   * @param canvasW 画布像素宽（渲染器尺寸）
   * @param canvasH 画布像素高
   */
  setCanvasSize(canvasW: number, canvasH: number): void {
    const [vw, vh] = UICamera.computeContainFrustum(canvasW, canvasH)
    const halfW = vw / 2
    const halfH = vh / 2
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
