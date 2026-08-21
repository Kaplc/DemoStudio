/**
 * SceneViewport — Scene 视口专用逻辑
 *
 * 职责：
 *  - PreviewSceneManager：Scene 视口渲染器（fly 飞越摄像机 / orbit 轨道控制 + WASD 漫游）
 *  - 创建并初始化 PreviewSceneManager
 *  - Scene 视口键盘输入处理（WASD 漫游控制）
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Compositor2D, logger, GenericActor, LightComponent } from '../engine'
import type { LightComponentOptions } from '../engine'

// ════════════════════════════════════════════
//   Scene 视口初始化
// ════════════════════════════════════════════

/**
 * 创建 Scene 视口的 PreviewSceneManager
 * @param containerEl  DOM 容器
 * @param editorScene  共享 THREE.Scene
 */
export function createSceneViewport(
  containerEl: HTMLElement,
  editorScene?: THREE.Scene,
): PreviewSceneManager {
  const mgr = new PreviewSceneManager(containerEl, {
    controlMode: 'fly',
    editorScene,
    addDefaultContent: false,
  })
  mgr.setWASDControl(true)
  mgr.setCameraOrbit(45, 30, 20)
  mgr.start()
  return mgr
}

// ════════════════════════════════════════════
//   Scene 视口输入
// ════════════════════════════════════════════

const SCENE_WASD_KEYS = new Set([
  'w', 'W', 'a', 'A', 's', 'S', 'd', 'D', 'q', 'Q', 'e', 'E',
])

/**
 * 处理 Scene 视口的键盘按下（WASD 飞越漫游）
 * @returns 是否已消费该事件
 */
export function handleSceneKeyDown(
  e: KeyboardEvent,
  mgr: PreviewSceneManager | null,
): boolean {
  if (!SCENE_WASD_KEYS.has(e.key)) return false
  mgr?.onWASDKeyDown(e.key)
  e.preventDefault()
  return true
}

/**
 * 处理 Scene 视口的键盘释放
 * @returns 是否已消费该事件
 */
export function handleSceneKeyUp(
  e: KeyboardEvent,
  mgr: PreviewSceneManager | null,
): boolean {
  if (!SCENE_WASD_KEYS.has(e.key)) return false
  mgr?.onWASDKeyUp(e.key)
  return true
}

// ════════════════════════════════════════════
//   PreviewSceneManager — Scene 视口渲染器
// ════════════════════════════════════════════

export type ControlMode = 'orbit' | 'fly'
/** 相机投影模式：'perspective' 透视(3D)/ 'orthographic' 正交(2D) */
export type CameraMode = 'perspective' | 'orthographic'

// clientToWorld 复用临时对象（避免每次调用分配）
const _raycaster = new THREE.Raycaster()
const _planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
const _ndc = new THREE.Vector2()
const _worldOut = new THREE.Vector3()

export interface PreviewSceneManagerOptions {
  controlMode?: ControlMode
  /** 相机投影模式，默认 'perspective'。2D 项目用 'orthographic' */
  cameraMode?: CameraMode
  /** 外部共享场景（两个视口渲染同一场景） */
  editorScene?: THREE.Scene
  /** 是否添加默认光照和辅助工具（共享场景时只需加一次） */
  addDefaultContent?: boolean
}

/**
 * PreviewSceneManager — 编辑器 Scene 视口/预览专用渲染器
 * 封装场景、摄像机、渲染器管理，支持两种控制模式：
 *   'orbit' — 轨道控制（Game 视口使用）
 *   'fly'   — 第一人称飞行摄像机（Scene 视口使用, 左键旋转自身）
 */
export class PreviewSceneManager {
  public scene: THREE.Scene
  /** 摄像机 */
  public camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  public renderer: THREE.WebGLRenderer
  public controls: OrbitControls | null = null
  /** UI 覆盖层宿主：尺寸/位置始终跟随 canvas 实际渲染矩形（letterbox 后的居中区域） */
  readonly uiLayer: HTMLDivElement

  // ─── 场景读取模式（编辑器只读游戏场景，不注入编辑器内容）───
  /**
   * 当前渲染主场景（null = 默认 this.scene；游戏运行时切换为游戏场景只读）。
   * Scene 视图直接渲染 game.scene，用 Scene tab 自己的相机，无需叠加层。
   */
  private _viewScene: THREE.Scene | null = null

  /**
   * 切换渲染主场景（编辑器读取游戏场景用）：传 null 恢复默认场景（this.scene）。
   * 注意：这只是渲染层只读引用，不向目标场景注入任何编辑器内容。
   */
  setViewScene(scene: THREE.Scene | null): void {
    this._viewScene = scene
  }

  /** 当前渲染主场景（调试/拾取用） */
  get viewScene(): THREE.Scene {
    return this._viewScene ?? this.scene
  }

  private animationId: number | null = null
  private lastTime = 0
  private updateCallbacks: Array<(dt: number) => void> = []
  private afterRenderCallbacks: Array<() => void> = []
  private container: HTMLElement

  // ─── WebGL 上下文丢失/恢复 ───
  private contextLost = false
  private _onContextLost: ((e: Event) => void) | null = null
  private _onContextRestored: (() => void) | null = null

  // ─── 相机模式与视口宽高比 ───
  private cameraMode: CameraMode
  /** 正交模式半高（世界单位），仅 orthographic 时生效 */
  public orthoSize = 5
  /** 当前视口宽高比（OrthographicCamera 无 aspect 字段，统一由此维护） */
  private _aspect = 1
  /** 只读访问当前 aspect（供 Game.syncCamera 等外部使用） */
  get aspect(): number { return this._aspect }

  // ─── 输入控制（用于 TransformGizmo 临时冻结摄像机操作）───
  private _inputEnabled = true

  /** 是否允许摄像机输入（鼠标/键盘） */
  get inputEnabled(): boolean { return this._inputEnabled }

  /**
   * 临时启用/禁用摄像机输入。
   * 用于 TransformGizmo 拖拽时冻结视角，防止与飞越/轨道控制冲突。
   */
  setInputEnabled(v: boolean) {
    this._inputEnabled = v
    if (this.controls) {
      this.controls.enabled = v
    }
  }

  // ─── 强制画面比例（canvas 物理缩放，CSS flex 居中）───
  private targetAspect: number | null = null

  /** 设置强制画面比例（例如 16/9 = 1.777），null=自由拉伸 */
  setTargetAspect(ratio: number | null) {
    this.targetAspect = ratio
    this.resize()
  }

  // ─── WASD 漫游 ───
  private wasdEnabled = false
  private wasdKeys = new Set<string>()
  private wasdSpeed = 8

  // ─── Fly 摄像机状态 ───
  private controlMode: ControlMode
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private isLeftDown = false
  private isRightDown = false
  private prevMouseX = 0
  private prevMouseY = 0
  private flySpeed = 10
  private flySensitivity = 0.0015

  constructor(container: HTMLElement, options: PreviewSceneManagerOptions = {}) {
    this.container = container
    this.controlMode = options.controlMode ?? 'orbit'

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

    // UI 覆盖层宿主：绝对定位居中，尺寸由 resize() 同步为 canvas 实际渲染矩形，
    // 使挂载其上的 React HUD 与画面对齐（而非铺满含黑边的整个容器）
    this.uiLayer = document.createElement('div')
    this.uiLayer.className = 'scene-ui-layer'
    this.uiLayer.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;overflow:hidden;z-index:100;'
    this.uiLayer.style.width = `${container.clientWidth}px`
    this.uiLayer.style.height = `${container.clientHeight}px`
    container.appendChild(this.uiLayer)

    // ─── 场景（共享或独立） ───
    if (options.editorScene) {
      this.scene = options.editorScene
    } else {
      this.scene = new THREE.Scene()
      this.scene.background = new THREE.Color(0x1a1a2e)
    }

    // ─── 摄像机（按 cameraMode 创建透视或正交） ───
    this._aspect = container.clientWidth / container.clientHeight
    this.cameraMode = options.cameraMode ?? 'perspective'
    this.camera = this.createCamera()

    // ─── 控制 ───
    if (this.controlMode === 'orbit') {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement)
      this.controls.enableDamping = true
      this.controls.dampingFactor = 0.08
      this.controls.minDistance = 5
      this.controls.maxDistance = 80
      this.controls.maxPolarAngle = Math.PI / 2.1
      this.controls.target.set(0, 0, 0)
      this.controls.update()
    } else {
      this.initFlyEuler()
      this.setupFlyMouse()
    }

    // ─── 默认内容（仅独立场景 / 共享场景只加一次） ───
    const addDefault = options.addDefaultContent ?? true
    if (addDefault) {
      this.setupLighting()
      this.setupHelpers()
    }

    // ─── WebGL 上下文丢失/恢复：GPU 重置或内存不足时暂停渲染，恢复后重建纹理继续 ───
    this._onContextLost = (e: Event) => {
      e.preventDefault() // 阻止浏览器永久销毁上下文，允许后续恢复
      this.contextLost = true
      this.stop()
      logger.warn('[PreviewSceneManager] WebGL 上下文丢失，已暂停渲染，等待浏览器恢复…')
    }
    this._onContextRestored = () => {
      logger.info('[PreviewSceneManager] WebGL 上下文已恢复，重建纹理并恢复渲染')
      this.restoreAllTextures()
      this.contextLost = false
      this.start()
    }
    this.renderer.domElement.addEventListener('webglcontextlost', this._onContextLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored, false)
  }

  /**
   * WebGL 上下文恢复后，GPU 上的纹理数据已全部失效。
   * 遍历场景内所有材质，将纹理标记 needsUpdate 强制重新上传。
   */
  private restoreAllTextures() {
    this.scene.traverse((obj) => {
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

  /** 按 cameraMode 创建相机并置于该模式默认视角 */
  private createCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    if (this.cameraMode === 'orthographic') {
      const halfH = this.orthoSize
      const halfW = halfH * this._aspect
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200)
      // 2D 约定：相机在 +Z 朝 -Z 看，物体在 z=0 的 XY 平面
      cam.position.set(0, 0, 20)
      cam.lookAt(0, 0, 0)
      return cam
    }
    const cam = new THREE.PerspectiveCamera(60, this._aspect, 0.1, 200)
    cam.position.set(15, 20, 15)
    cam.lookAt(0, 0, 0)
    return cam
  }

  /** 切换相机模式：重建相机 + 重置默认视角 + 刷新投影（OrbitControls 原生兼容正交相机） */
  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode
    // 记录旧 controls 交互开关，重建后保持（避免切换项目时意外开启/关闭交互）
    const prevEnabled = this.controls?.enabled ?? true
    // orbit 控制器绑定具体相机对象，需解绑后重建
    if (this.controlMode === 'orbit' && this.controls) {
      this.controls.dispose()
      this.controls = null
    }
    this.camera = this.createCamera()
    if (this.controlMode === 'orbit') {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement)
      this.controls.enableDamping = true
      this.controls.dampingFactor = 0.08
      this.controls.target.set(0, 0, 0)
      this.controls.update()
      this.controls.enabled = prevEnabled
    } else {
      this.initFlyEuler()
    }
    this.resize()
  }

  private initFlyEuler() {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    this.euler.setFromQuaternion(this.camera.quaternion)
    this.euler.order = 'YXZ'
  }

  private setupFlyMouse() {
    const canvas = this.renderer.domElement

    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    canvas.addEventListener('mousedown', (e) => {
      // 始终记录鼠标状态（即使 inputEnabled=false 也要正确跟踪按键）
      if (e.button === 0) {
        this.isLeftDown = true
        this.prevMouseX = e.clientX
        this.prevMouseY = e.clientY
      }
      if (e.button === 2) {
        this.isRightDown = true
        this.prevMouseX = e.clientX
        this.prevMouseY = e.clientY
      }
    })

    window.addEventListener('mousemove', (e) => {
      if (!this._inputEnabled) return
      if (!this.isLeftDown && !this.isRightDown) return

      const dx = e.clientX - this.prevMouseX
      const dy = e.clientY - this.prevMouseY
      this.prevMouseX = e.clientX
      this.prevMouseY = e.clientY

      if (this.isLeftDown) {
        // 左键拖拽: 旋转摄像机自身
        this.euler.y -= dx * this.flySensitivity
        this.euler.x -= dy * this.flySensitivity
        // 限制俯仰角度，防止翻转
        this.euler.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.euler.x))
        this.camera.quaternion.setFromEuler(this.euler)
      }

      if (this.isRightDown) {
        // 右键拖拽: 在当前朝向垂直平面上平移
        const dir = new THREE.Vector3()
        this.camera.getWorldDirection(dir)
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
        const up = new THREE.Vector3().crossVectors(right, dir).normalize()
        const panSpeed = 0.03
        this.camera.position.addScaledVector(right, -dx * panSpeed)
        this.camera.position.addScaledVector(up, dy * panSpeed)
      }
    })

    window.addEventListener('mouseup', (e) => {
      // 始终清除鼠标状态（即使 inputEnabled=false 也要正确跟踪按键）
      if (e.button === 0) this.isLeftDown = false
      if (e.button === 2) this.isRightDown = false
    })

    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
      if (!this._inputEnabled) return
      e.preventDefault()
      const dir = new THREE.Vector3()
      this.camera.getWorldDirection(dir)
      this.camera.position.addScaledVector(dir, -e.deltaY * 0.02)
    }, { passive: false })
  }

  private setupLighting() {
    // 灯光 actor 化：灯光挂到 Actor 上（LightComponent），大纲显示为可选中/可编辑的节点
    // （Actor.root 带 userData.actorRef，getSceneTree 会正确显示名字而非裸 THREE 类型）
    const makeLightActor = (name: string, options: LightComponentOptions) => {
      const actor = new GenericActor(name)
      actor.addComponent(LightComponent, options)
      this.scene.add(actor.root)
      return actor
    }

    // 环境光
    makeLightActor('AmbientLight', { type: 'ambient', color: '#ffffff', intensity: 0.6 })
    // 半球光
    makeLightActor('HemisphereLight', { type: 'hemisphere', color: '#87ceeb', intensity: 0.4 })
    // 主方向光（带阴影）
    makeLightActor('KeyLight', {
      type: 'directional', color: '#ffffff', intensity: 1.2,
      position: [20, 30, 10], castShadow: true,
    })
    // 补光
    makeLightActor('FillLight', {
      type: 'directional', color: '#8888ff', intensity: 0.3,
      position: [-10, 15, -10],
    })
  }

  private setupHelpers() {
    // 网格地面
    const grid = new THREE.GridHelper(40, 40, 0x444466, 0x333355)
    grid.position.y = -0.01
    this.scene.add(grid)
  }

  /** 公开方法：供外部在容器尺寸变化时调用，触发渲染器与摄像机更新 */
  resize() {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return

    let canvasW: number
    let canvasH: number
    let aspect: number

    if (this.targetAspect) {
      // canvas 物理尺寸按比例缩放（通过 CSS flex 居中，黑底由容器背景填充）
      const containerAspect = width / height
      if (containerAspect > this.targetAspect) {
        // 容器更宽 → canvas 按高度撑满，左右黑边
        canvasH = height
        canvasW = height * this.targetAspect
      } else {
        // 容器更高 → canvas 按宽度撑满，上下黑边
        canvasW = width
        canvasH = width / this.targetAspect
      }
      aspect = this.targetAspect
    } else {
      canvasW = width
      canvasH = height
      aspect = width / height
    }

    // 统一维护 _aspect；按相机类型更新投影（正交无 aspect 字段）
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

    // UI 覆盖层宿主跟随 canvas 实际渲染矩形，使 React HUD 对齐画面而非黑边
    this.uiLayer.style.width = `${w}px`
    this.uiLayer.style.height = `${h}px`
  }

  // ─── 动画循环 ───

  start() {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      // 上下文丢失期间跳过渲染，避免对失效 GL 上下文上传纹理报错
      if (this.contextLost) {
        this.animationId = requestAnimationFrame(animate)
        return
      }
      const dt = (time - this.lastTime) / 1000
      this.lastTime = time

      // WASD 漫游
      this.updateWASD(dt)

      this.controls?.update()

      // 执行更新回调
      for (const cb of this.updateCallbacks) {
        cb(dt)
      }

      // 主场景渲染（默认 this.scene；游戏运行时 = 游戏场景只读）
      this.renderer.render(this.viewScene, this.camera)

      // 渲染后回调（UI 覆盖层等）
      for (const cb of this.afterRenderCallbacks) {
        cb()
      }
      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  /** 清除画布残留画面 */
  clearFrame() {
    this.renderer.clear()
  }

  onUpdate(callback: (dt: number) => void) {
    this.updateCallbacks.push(callback)
    return () => {
      this.updateCallbacks = this.updateCallbacks.filter((cb) => cb !== callback)
    }
  }

  /** 注册渲染后回调（每帧主场景渲染完毕后调用，用于 UI 覆盖层） */
  onAfterRender(callback: () => void): () => void {
    this.afterRenderCallbacks.push(callback)
    return () => {
      this.afterRenderCallbacks = this.afterRenderCallbacks.filter((cb) => cb !== callback)
    }
  }

  // ─── WASD 漫游控制 ───

  /** WASD 是否有键正在被按下（用于外部判断是否需要暂停相机同步） */
  get isWASDActive(): boolean {
    return this.wasdKeys.size > 0
  }

  /** 启用或禁用 WASD 漫游摄像机控制 */
  setWASDControl(enabled: boolean) {
    this.wasdEnabled = enabled
    if (this.controls) {
      if (enabled) {
        this.controls.minDistance = 0
        this.controls.maxDistance = Infinity
        this.controls.maxPolarAngle = Math.PI / 1.8
      } else {
        this.wasdKeys.clear()
        this.controls.minDistance = 5
        this.controls.maxDistance = 80
        this.controls.maxPolarAngle = Math.PI / 2.1
      }
    }
  }

  /** 处理 WASD 按键按下（由外部传入） */
  onWASDKeyDown(key: string) {
    if (!this.wasdEnabled) return
    this.wasdKeys.add(key.toLowerCase())
  }

  /** 处理 WASD 按键释放（由外部传入） */
  onWASDKeyUp(key: string) {
    this.wasdKeys.delete(key.toLowerCase())
  }

  /** 清除所有按键状态 */
  clearWASDKeys() {
    this.wasdKeys.clear()
  }

  private updateWASD(dt: number) {
    if (!this.wasdEnabled || this.wasdKeys.size === 0) return

    const speed = this.wasdSpeed * dt

    // 摄像机完整朝向（含俯仰），W/S 沿视线方向前进/后退
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)

    // 水平右向量（A/D 侧移用），保持水平不随俯仰倾斜
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    // 垂直上向量（Q/E 升降用），始终朝世界 Y 轴
    const worldUp = new THREE.Vector3(0, 1, 0)

    if (this.wasdKeys.has('w')) this.camera.position.addScaledVector(forward, speed)
    if (this.wasdKeys.has('s')) this.camera.position.addScaledVector(forward, -speed)
    if (this.wasdKeys.has('a')) this.camera.position.addScaledVector(right, -speed)
    if (this.wasdKeys.has('d')) this.camera.position.addScaledVector(right, speed)
    if (this.wasdKeys.has('q')) this.camera.position.addScaledVector(worldUp, -speed)
    if (this.wasdKeys.has('e')) this.camera.position.addScaledVector(worldUp, speed)

    if (this.controlMode === 'fly' && this.controls) {
      const fwd = new THREE.Vector3()
      this.camera.getWorldDirection(fwd)
      this.controls.target.copy(this.camera.position).add(fwd.clone().multiplyScalar(10))
    } else if (this.controlMode === 'orbit' && this.controls) {
      // Orbit 模式：target 在地面跟随 camera 水平位置
      this.controls.target.set(this.camera.position.x, 0, this.camera.position.z)
    }
  }

  // ─── 场景道具 ───

  setFov(fov: number) {
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
  }

  /**
   * 把鼠标 client 坐标转为世界坐标（投影到 z=0 平面），供 2D 鼠标拾取。
   * 用 Raycaster.setFromCamera + 射线与 z=0 平面求交，对正交/透视相机都正确。
   * canvas 实际矩形用 getBoundingClientRect（已含 letterbox 缩放）。
   */
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
        // 跳过场景和摄像机（透视/正交通用）
        this.scene.children.shift()
        continue
      }
      this.scene.remove(child)
    }
    // 重新添加基础元素
    this.setupLighting()
    this.setupHelpers()
  }

  // ─── 摄像机预设 ───

  setCameraOrbit(azimuth: number, elevation: number, distance: number) {
    const theta = (azimuth * Math.PI) / 180
    const phi = (elevation * Math.PI) / 180
    this.camera.position.set(
      distance * Math.cos(phi) * Math.sin(theta),
      distance * Math.sin(phi),
      distance * Math.cos(phi) * Math.cos(theta)
    )
    this.controls?.target?.set(0, 0, 0)
    this.controls?.update()
    if (!this.controls) {
      this.camera.lookAt(0, 0, 0)
      this.initFlyEuler()
    }
  }

  /**
   * 聚焦到指定对象上（移动 Scene 摄像机看向目标）。
   * @param target  目标 Object3D
   * @param distance 距目标距离（默认自动计算）
   */
  focusOn(target: THREE.Object3D, distance?: number): void {
    // 获取对象世界中心
    const center = new THREE.Vector3()
    const box = new THREE.Box3().setFromObject(target)
    box.getCenter(center)

    // 计算包围盒大小，确定合适的观察距离
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z, 0.5)
    const dist = distance ?? maxDim * 2.5 + 3

    if (this.controls) {
      // orbit 模式：移动 controls.target + 调整相机位置保持距离
      this.controls.target.copy(center)
      const dir = new THREE.Vector3()
      this.camera.getWorldDirection(dir)
      this.camera.position.copy(center).add(dir.multiplyScalar(-dist))
      this.controls.update()
    } else {
      // fly 模式：直接设置位置和朝向
      this.camera.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist)
      this.camera.lookAt(center)
      this.initFlyEuler()
    }
  }

  // ─── 2D 叠加合成 ───

  /** 创建 2D 叠加层并自动接入每帧渲染循环，返回 Compositor2D 实例 */
  createCompositor2D(): Compositor2D {
    const comp = new Compositor2D(this.renderer)
    const remove = this.onAfterRender(() => comp.render())
    // 在 Compositor2D 上挂一个清理方法，避免外部需要额外注册 cleanup
    const origDispose = comp.dispose.bind(comp)
    comp.dispose = () => {
      remove()
      origDispose()
    }
    return comp
  }

  // ─── 清理 ───

  dispose() {
    this.stop()
    // 移除 WebGL 上下文事件监听，避免内存泄漏
    if (this._onContextLost) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this._onContextLost, false)
      this._onContextLost = null
    }
    if (this._onContextRestored) {
      this.renderer.domElement.removeEventListener('webglcontextrestored', this._onContextRestored, false)
      this._onContextRestored = null
    }
    // 必须先强制丢失上下文再 dispose，否则 WebGL 上下文会泄漏
    this.renderer.forceContextLoss()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.uiLayer.remove()
  }
}
