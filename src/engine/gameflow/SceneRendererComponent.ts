/**
 * SceneRendererComponent — 游戏视口场景渲染器组件
 *
 * 挂载在 World 上的场景渲染组件（负责游戏视口渲染），
 * 与编辑器层 Scene 视口渲染器（PreviewSceneManager）完全独立。
 * 职责：
 *  - 管理 WebGL 渲染器、共享场景、摄像机
 *  - orbit 摄像机控制
 *  - 强制画面比例 letterbox
 *  - UI 覆盖层宿主（挂载 GameUI 已废弃：UI 渲染统一走 UI 摄像机叠加）
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { logger } from '../Logger'
import { AObjectComponent } from '../entity/AObjectComponent'
import { gizmos } from '../tools/Gizmos'
import { GameInstance } from './GameInstance'
import { UICamera } from '../rendering/UICamera'
import type { World } from './World'
import type { CameraMode } from '../rendering/CameraComponent'

// clientToWorld 复用临时对象
const _raycaster = new THREE.Raycaster()
const _planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const _ndc = new THREE.Vector2()
const _worldOut = new THREE.Vector3()

export interface SceneRendererComponentOptions {
  /** 相机投影模式，默认 'perspective'。2D 项目用 'orthographic' */
  cameraMode?: CameraMode
  /** 外部共享场景 */
  editorScene?: THREE.Scene
}

export class SceneRendererComponent extends AObjectComponent<World> {
  public scene: THREE.Scene
  /** 当前渲染相机（由 cameraProvider 委托每帧获取；null = 不渲染 3D 主场景） */
  public camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null
  public renderer: THREE.WebGLRenderer
  public controls: OrbitControls | null = null
  /** UI 覆盖层宿主 */
  readonly uiLayer: HTMLDivElement

  /**
   * 相机委托：每帧从 GameInstance 获取当前主摄像机直接渲染（不再复制同步）。
   * 由 Game.launch 注册；返回 null 时跳过主场景渲染（UI 仍可叠加）。
   */
  private cameraProvider: (() => THREE.PerspectiveCamera | THREE.OrthographicCamera | null) | null = null

  /** 注册相机委托（每帧调用获取当前主摄像机） */
  setCameraProvider(
    provider: (() => THREE.PerspectiveCamera | THREE.OrthographicCamera | null) | null,
  ): void {
    this.cameraProvider = provider
    // 立即取一次相机，以便重建 OrbitControls（跟随新相机，仍禁止交互）
    this.camera = provider ? provider() : null
    if (this.controls) {
      this.controls.dispose()
      this.controls = null
    }
    if (this.camera) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement)
      this.controls.enableRotate = false
      this.controls.enablePan = false
      this.controls.enableZoom = false
      this.controls.enableDamping = false
      this.controls.enabled = false
    }
    this.resize()
    logger.info(`[SceneRendererComponent] setCameraProvider: ${this.camera ? this.camera.type : 'null'}`)
  }

  /**
   * UI 独立叠加相机（由 UICamera 类封装：正交 contain 模式 + 叠加渲染）。
   * 渲染 UI 场景时用此相机而非主相机 → UI 固定铺满视口、不随主相机移动/缩放。
   * 与主相机共用同一渲染器（autoClear=false + clearDepth 叠加）。
   */
  private _uiCam: UICamera | null = null

  /** 当前 UI 叠加相机（未挂载 UI 场景时为 null；PhySys.setupUI 点击检测用） */
  get uiCamera(): THREE.OrthographicCamera | null {
    return this._uiCam?.camera ?? null
  }

  /** 正交模式半高（世界单位） */
  public orthoSize = 5

  private animationId: number | null = null
  private lastTime = 0
  /** 最近一次渲染帧的 dt（秒），供外部读取帧率用 */
  private _lastDt = 0
  /** 渲染帧率（1/dt，每帧更新） */
  get renderFps(): number {
    return this._lastDt > 0 ? Math.round(1 / this._lastDt) : 0
  }
  private updateCallbacks: Array<(dt: number) => void> = []
  private afterRenderCallbacks: Array<() => void> = []
  private container: HTMLElement
  /** 容器尺寸变化监听（放大窗口/拖动面板时自动刷新画面比例） */
  private resizeObserver: ResizeObserver | null = null

  // ─── WebGL 上下文丢失/恢复 ───
  private contextLost = false
  private _onContextLost: ((e: Event) => void) | null = null
  private _onContextRestored: (() => void) | null = null

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

  /**
   * 创建游戏视口渲染器组件。
   * DOM 容器自行从当前活跃实例的 viewport 组件获取。
   * 由 World.ensureGameRenderer 负责创建并挂载到 World；调用方须保证已有活跃实例且带渲染容器。
   */
  constructor(owner: World, options: SceneRendererComponentOptions = {}) {
    super(owner)
    const container = GameInstance.current?.viewport.container
    if (!container) {
      throw new Error('[SceneRendererComponent] 无当前 GameInstance 或 viewport.container，无法创建渲染器（请先 Game.createInstance）')
    }
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

    // ─── 容器尺寸变化自动刷新：放大窗口/拖动面板时重算尺寸与宽高比（与 Scene 视口的 ResizeObserver 行为一致）───
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)

    // ─── 场景 ───
    if (options.editorScene) {
      this.scene = options.editorScene
    } else {
      this.scene = new THREE.Scene()
      this.scene.background = new THREE.Color(0x1a1a2e)
    }
    // 将 gizmos 也挂到游戏场景（编辑器模式下已挂到 shared 场景；游戏运行时挂到游戏场景）
    gizmos.attach(this.scene)

    // ─── 摄像机 ───
    // 不再创建默认相机：渲染相机由游戏自己创建并通过 setCamera() 注入
    this._aspect = container.clientWidth / container.clientHeight

    // ─── WebGL 上下文丢失/恢复：GPU 重置或内存不足时暂停渲染，恢复后重建纹理继续 ───
    this._onContextLost = (e: Event) => {
      e.preventDefault() // 阻止浏览器永久销毁上下文，允许后续恢复
      this.contextLost = true
      this.stop()
      logger.warn('[SceneRendererComponent] WebGL 上下文丢失，已暂停渲染，等待浏览器恢复…')
    }
    this._onContextRestored = () => {
      logger.info('[SceneRendererComponent] WebGL 上下文已恢复，重建纹理并恢复渲染')
      this.restoreAllTextures()
      this.contextLost = false
      this.start()
    }
    this.renderer.domElement.addEventListener('webglcontextlost', this._onContextLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored, false)

    // 初始停止渲染
    this.stop()
    logger.info(`[SceneRendererComponent] 创建: ${container.clientWidth}x${container.clientHeight}, cameraMode=${this.cameraMode}`)
  }

  /**
   * WebGL 上下文恢复后，GPU 上的纹理数据已全部失效。
   * 遍历场景内所有材质，将纹理标记 needsUpdate 强制重新上传。
   */
  private restoreAllTextures() {
    const scenes = [this.scene, this._uiCam?.scene].filter(Boolean) as THREE.Scene[]
    for (const scene of scenes) {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        const mat = (mesh as THREE.Mesh).material
        if (!mat) return
        const mats = Array.isArray(mat) ? mat : [mat]
        for (const m of mats) {
          const anyMat = m as THREE.Material & Record<string, unknown>
          for (const key of Object.keys(anyMat)) {
            const value = anyMat[key]
            if (value instanceof THREE.Texture) {
              value.needsUpdate = true
            }
          }
        }
      })
    }
  }

  // ════════════════════════════════════════════
  //   Game 视口专用方法
  // ════════════════════════════════════════════

  /** 启用/禁用 OrbitControls 交互（Game 场景不开放手动控制，暂留空） */
  setControlsEnabled(_enabled: boolean): void {
    // Game 视口的摄像机由游戏逻辑（syncCamera）驱动，不开放手动交互
  }

  /**
   * 注入渲染相机（已废弃：改由 setCameraProvider 委托每帧获取）。
   * 传入 null 表示游戏未提供相机（此时不渲染 3D 主场景）。
   */
  setCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null): void {
    this.camera = camera
    // 相机更换后重建 OrbitControls（跟随新相机，仍禁止交互）
    if (this.controls) {
      this.controls.dispose()
      this.controls = null
    }
    if (camera) {
      this.controls = new OrbitControls(camera, this.renderer.domElement)
      this.controls.enableRotate = false
      this.controls.enablePan = false
      this.controls.enableZoom = false
      this.controls.enableDamping = false
      this.controls.enabled = false
    }
    this.resize()
    logger.info(`[SceneRendererComponent] setCamera: ${camera ? camera.type : 'null'}`)
  }

  /** 重置摄像机到默认视角（无相机时跳过） */
  resetView(): void {
    if (!this.camera) return
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

  /** 切换相机投影模式（仅记录模式；实际相机由游戏创建注入） */
  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode
    this.resize()
  }

  /** 设置视场角（仅透视，且已有相机） */
  setFov(fov: number) {
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
  }

  /** 预设摄像机轨道角度（无相机时跳过） */
  setCameraOrbit(azimuth: number, elevation: number, distance: number) {
    if (!this.camera) return
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
    const cam = this.cameraProvider ? this.cameraProvider() : this.camera
    if (cam instanceof THREE.PerspectiveCamera) {
      // 透视：跟随视口比例（游戏相机对象引用，直接生效）
      cam.aspect = aspect
      cam.updateProjectionMatrix()
    }
    // 正交：视锥由游戏相机自己管理（CameraComponent.SetOrtho/SetAspect），
    // 渲染器不覆盖，避免与游戏 orthoSize 冲突

    const w = Math.round(canvasW)
    const h = Math.round(canvasH)
    this.renderer.setSize(w, h)

    // 同步 UI 独立叠加相机视锥（UICamera contain 模式：完整显示 9.6×5.4 画布）
    this._uiCam?.setCanvasSize(w, h)

    this.uiLayer.style.width = `${w}px`
    this.uiLayer.style.height = `${h}px`
  }

  // ════════════════════════════════════════════
  //   动画循环
  // ════════════════════════════════════════════

  /**
   * 挂载 UI 独立场景：主场景渲染后叠加渲染（autoClear=false + clearDepth，
   * UI 不参与 3D 深度测试 → 永远在顶层）。
   *
   * 双摄像机方案：UI 场景使用独立正交相机（UICamera，视锥 contain 匹配 UI 画布
   * 世界尺寸），不再复用主相机 → UI 固定铺满视口，不受主相机（透视/正交、位置/视角）影响。
   */
  attachUIScene(scene: THREE.Scene | null): void {
    if (scene && !this._uiCam) {
      // UICamera 内置正交相机（contain 模式，画布 9.6×5.4）
      this._uiCam = new UICamera()
      this.resize()
      logger.info('[SceneRendererComponent] UI 独立叠加相机已创建（UICamera 正交 contain 1920×1080 px 世界）')
    }
    this._uiCam?.attach(scene)
    if (!scene) {
      // 分离即终态（BObject.EndPlay：markDestroyed + 注册表注销），下次挂载重建
      this._uiCam?.EndPlay()
      this._uiCam = null
    }
    logger.info(`[SceneRendererComponent] UI 场景${scene ? '已挂载' : '已分离'}${scene ? '（双摄像机叠加渲染）' : ''}`)
  }

  start() {
    logger.info('[SceneRendererComponent] 渲染循环启动')
    this.lastTime = performance.now()
    const animate = (time: number) => {
      // 上下文丢失期间跳过渲染，避免对失效 GL 上下文上传纹理报错
      if (this.contextLost) {
        this.animationId = requestAnimationFrame(animate)
        return
      }
      const dt = (time - this.lastTime) / 1000
      this.lastTime = time
      this._lastDt = dt

      // 每帧从委托获取当前主摄像机（游戏自己创建的摄像机 actor）
      this.camera = this.cameraProvider ? this.cameraProvider() : this.camera
      const cam = this.camera

      // 每帧同步宽高比到游戏相机（渲染器直接用它渲染，需保证 aspect 最新）
      if (cam instanceof THREE.PerspectiveCamera) {
        if (Math.abs(cam.aspect - this._aspect) > 1e-6) {
          cam.aspect = this._aspect
          cam.updateProjectionMatrix()
        }
      } else if (cam instanceof THREE.OrthographicCamera) {
        // 正交：半高保持不变（游戏设定），半宽按视口比例伸缩
        const halfH = cam.top
        const halfW = halfH * this._aspect
        if (cam.right !== halfW || cam.top !== halfH) {
          cam.left = -halfW
          cam.right = halfW
          cam.top = halfH
          cam.bottom = -halfH
          cam.updateProjectionMatrix()
        }
      }

      this.controls?.update()

      for (const cb of this.updateCallbacks) {
        cb(dt)
      }

      // 主场景：直接用游戏相机的引用渲染（不再复制同步）
      if (cam) {
        this.renderer.render(this.scene, cam)
      } else {
        this.renderer.clear()
      }

      // UI 独立场景叠加渲染（UI 永远在顶层）：
      // 双摄像机——UICamera 持独立正交相机，不随主相机移动/缩放
      this._uiCam?.render(this.renderer)

      for (const cb of this.afterRenderCallbacks) {
        cb()
      }
      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  stop() {
    if (this.animationId !== null) {
      logger.info('[SceneRendererComponent] 渲染循环停止')
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
    if (this.camera) {
      _raycaster.setFromCamera(_ndc, this.camera)
      _raycaster.ray.intersectPlane(_planeZ0, out)
    }
    return out
  }

  // ════════════════════════════════════════════
  //   清理
  // ════════════════════════════════════════════

  dispose() {
    this.stop()
    // 断开容器尺寸监听（防止销毁后仍触发 resize）
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    // 移除 WebGL 上下文事件监听，避免内存泄漏
    if (this._onContextLost) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this._onContextLost, false)
      this._onContextLost = null
    }
    if (this._onContextRestored) {
      this.renderer.domElement.removeEventListener('webglcontextrestored', this._onContextRestored, false)
      this._onContextRestored = null
    }
    this.renderer.forceContextLoss()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    // UI 相机终态兜底（attachUIScene(null) 未调用时的残留）
    this._uiCam?.EndPlay()
    this._uiCam = null
    this.uiLayer.remove()
  }
}
