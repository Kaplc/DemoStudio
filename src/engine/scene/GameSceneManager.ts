/**
 * GameSceneManager — 游戏视口专用渲染器
 *
 * 与 PreviewSceneManager 完全独立的实现，专用于 Game 视口。
 * 职责：
 *  - 管理 WebGL 渲染器、共享场景、摄像机
 *  - orbit 摄像机控制
 *  - 强制画面比例 letterbox
 *  - UI 覆盖层宿主
 *  - 挂载 GameUI
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { logger } from '../Logger'
import type { GameUI } from '../gameplay/ui/GameUI'
import type { CameraMode } from './PreviewSceneManager'

// clientToWorld 复用临时对象
const _raycaster = new THREE.Raycaster()
const _planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const _ndc = new THREE.Vector2()
const _worldOut = new THREE.Vector3()

export interface GameSceneManagerOptions {
  /** 相机投影模式，默认 'perspective'。2D 项目用 'orthographic' */
  cameraMode?: CameraMode
  /** 外部共享场景 */
  sharedScene?: THREE.Scene
}

export class GameSceneManager {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  public renderer: THREE.WebGLRenderer
  public controls: OrbitControls | null = null
  /** UI 覆盖层宿主 */
  readonly uiLayer: HTMLDivElement

  /** 正交模式半高（世界单位） */
  public orthoSize = 5

  private animationId: number | null = null
  private lastTime = 0
  private updateCallbacks: Array<(dt: number) => void> = []
  private afterRenderCallbacks: Array<() => void> = []
  private container: HTMLElement

  // ─── 相机模式与宽高比 ───
  private cameraMode: CameraMode
  private _aspect = 1
  get aspect(): number { return this._aspect }

  // ─── 强制画面比例 ───
  private targetAspect: number | null = null

  setTargetAspect(ratio: number | null) {
    this.targetAspect = ratio
    this.resize()
  }

  constructor(container: HTMLElement, options: GameSceneManagerOptions = {}) {
    this.container = container
    this.cameraMode = options.cameraMode ?? 'perspective'

    // ─── 渲染器 ───
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setClearColor(0x1a1a2e, 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    // ─── UI 覆盖层宿主 ───
    this.uiLayer = document.createElement('div')
    this.uiLayer.className = 'scene-ui-layer'
    this.uiLayer.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;overflow:hidden;z-index:100;'
    this.uiLayer.style.width = `${container.clientWidth}px`
    this.uiLayer.style.height = `${container.clientHeight}px`
    container.appendChild(this.uiLayer)

    // ─── 场景 ───
    if (options.sharedScene) {
      this.scene = options.sharedScene
    } else {
      this.scene = new THREE.Scene()
      this.scene.background = new THREE.Color(0x1a1a2e)
    }

    // ─── 摄像机 ───
    this._aspect = container.clientWidth / container.clientHeight
    this.camera = this.createCamera()

    // ─── OrbitControls（纯跟随，禁止交互）───
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableRotate = false
    this.controls.enablePan = false
    this.controls.enableZoom = false
    this.controls.enableDamping = false
    this.controls.enabled = false

    // ─── Game 视口默认视角 ───
    this.camera.position.set(17, 17, 17)

    // 初始停止渲染
    this.stop()
    logger.info(`[GameSceneManager] 创建: ${container.clientWidth}x${container.clientHeight}, cameraMode=${this.cameraMode}`)
  }

  // ════════════════════════════════════════════
  //   Game 视口专用方法
  // ════════════════════════════════════════════

  /** 将 GameUI 根元素挂载到 UI 覆盖层 */
  mountGameUI(ui: GameUI): void {
    logger.info(`[GameSceneManager] 挂载 GameUI 容器 (el=${ui.el.className})`)
    this.uiLayer.appendChild(ui.el)
  }

  /** 启用/禁用 OrbitControls 交互（Game 场景不开放手动控制，暂留空） */
  setControlsEnabled(_enabled: boolean): void {
    // Game 视口的摄像机由游戏逻辑（syncCamera）驱动，不开放手动交互
  }

  /** 重置摄像机到默认视角 */
  resetView(): void {
    this.camera.position.set(17, 17, 17)
    if (this.controls) {
      this.controls.target.set(0, 0, 0)
      this.controls.update()
    }
  }

  // ════════════════════════════════════════════
  //   摄像机
  // ════════════════════════════════════════════

  private createCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    if (this.cameraMode === 'orthographic') {
      const halfH = this.orthoSize
      const halfW = halfH * this._aspect
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200)
      cam.position.set(0, 0, 20)
      cam.lookAt(0, 0, 0)
      return cam
    }
    const cam = new THREE.PerspectiveCamera(60, this._aspect, 0.1, 200)
    cam.position.set(15, 20, 15)
    cam.lookAt(0, 0, 0)
    return cam
  }

  /** 切换相机投影模式 */
  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode
    if (this.controls) {
      this.controls.dispose()
      this.controls = null
    }
    this.camera = this.createCamera()
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableRotate = false
    this.controls.enablePan = false
    this.controls.enableZoom = false
    this.controls.enableDamping = false
    this.controls.enabled = false
    this.resize()
  }

  /** 设置视场角（仅透视） */
  setFov(fov: number) {
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
  }

  /** 预设摄像机轨道角度 */
  setCameraOrbit(azimuth: number, elevation: number, distance: number) {
    const theta = (azimuth * Math.PI) / 180
    const phi = (elevation * Math.PI) / 180
    this.camera.position.set(
      distance * Math.cos(phi) * Math.sin(theta),
      distance * Math.sin(phi),
      distance * Math.cos(phi) * Math.cos(theta),
    )
    if (this.controls) {
      this.controls.target.set(0, 0, 0)
      this.controls.update()
    } else {
      this.camera.lookAt(0, 0, 0)
    }
  }

  // ════════════════════════════════════════════
  //   尺寸 & 比例
  // ════════════════════════════════════════════

  resize() {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return

    let canvasW: number
    let canvasH: number
    let aspect: number

    if (this.targetAspect) {
      const containerAspect = width / height
      if (containerAspect > this.targetAspect) {
        canvasH = height
        canvasW = height * this.targetAspect
      } else {
        canvasW = width
        canvasH = width / this.targetAspect
      }
      aspect = this.targetAspect
    } else {
      canvasW = width
      canvasH = height
      aspect = width / height
    }

    this._aspect = aspect
    const cam = this.camera
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.aspect = aspect
    } else {
      const halfH = this.orthoSize
      const halfW = halfH * aspect
      cam.left = -halfW
      cam.right = halfW
      cam.top = halfH
      cam.bottom = -halfH
    }

    const w = Math.round(canvasW)
    const h = Math.round(canvasH)
    this.renderer.setSize(w, h)
    cam.updateProjectionMatrix()

    this.uiLayer.style.width = `${w}px`
    this.uiLayer.style.height = `${h}px`
  }

  // ════════════════════════════════════════════
  //   动画循环
  // ════════════════════════════════════════════

  start() {
    logger.info('[GameSceneManager] 渲染循环启动')
    this.lastTime = performance.now()
    const animate = (time: number) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      this.controls?.update()

      for (const cb of this.updateCallbacks) {
        cb(dt)
      }

      this.renderer.render(this.scene, this.camera)

      for (const cb of this.afterRenderCallbacks) {
        cb()
      }
      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  stop() {
    if (this.animationId !== null) {
      logger.info('[GameSceneManager] 渲染循环停止')
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  clearFrame() {
    this.renderer.clear()
  }

  onUpdate(callback: (dt: number) => void): () => void {
    this.updateCallbacks.push(callback)
    return () => {
      this.updateCallbacks = this.updateCallbacks.filter((cb) => cb !== callback)
    }
  }

  onAfterRender(callback: () => void): () => void {
    this.afterRenderCallbacks.push(callback)
    return () => {
      this.afterRenderCallbacks = this.afterRenderCallbacks.filter((cb) => cb !== callback)
    }
  }

  // ════════════════════════════════════════════
  //   场景操作
  // ════════════════════════════════════════════

  addObject(object: THREE.Object3D) {
    this.scene.add(object)
  }

  removeObject(object: THREE.Object3D) {
    this.scene.remove(object)
  }

  clearScene() {
    while (this.scene.children.length > 0) {
      const child = this.scene.children[0]
      if (child.type === 'Scene' || child instanceof THREE.Camera) {
        this.scene.children.shift()
        continue
      }
      this.scene.remove(child)
    }
  }

  // ════════════════════════════════════════════
  //   坐标转换
  // ════════════════════════════════════════════

  clientToWorld(clientX: number, clientY: number, out: THREE.Vector3 = _worldOut): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect()
    _ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    _raycaster.setFromCamera(_ndc, this.camera)
    _raycaster.ray.intersectPlane(_planeZ0, out)
    return out
  }

  // ════════════════════════════════════════════
  //   清理
  // ════════════════════════════════════════════

  dispose() {
    this.stop()
    this.renderer.forceContextLoss()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.uiLayer.remove()
  }
}
