/**
 * DemoStudio Three.js 引擎核心
 * 封装场景、摄像机、渲染器管理
 * 支持两种控制模式:
 *   'orbit' — 轨道控制（Game 视口使用）
 *   'fly'   — 第一人称飞行摄像机（Scene 视口使用, 左键旋转自身）
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type ControlMode = 'orbit' | 'fly'

export interface SceneManagerOptions {
  controlMode?: ControlMode
  /** 外部共享场景（两个视口渲染同一场景） */
  sharedScene?: THREE.Scene
  /** 是否添加默认光照和辅助工具（共享场景时只需加一次） */
  addDefaultContent?: boolean
}

export class SceneManager {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer: THREE.WebGLRenderer
  public controls: OrbitControls | null = null
  /** UI 覆盖层宿主：尺寸/位置始终跟随 canvas 实际渲染矩形（letterbox 后的居中区域） */
  readonly uiLayer: HTMLDivElement
  private animationId: number | null = null
  private lastTime = 0
  private updateCallbacks: Array<(dt: number) => void> = []
  private afterRenderCallbacks: Array<() => void> = []
  private container: HTMLElement

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

  constructor(container: HTMLElement, options: SceneManagerOptions = {}) {
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
    if (options.sharedScene) {
      this.scene = options.sharedScene
    } else {
      this.scene = new THREE.Scene()
      this.scene.background = new THREE.Color(0x1a1a2e)
      this.scene.fog = new THREE.Fog(0x1a1a2e, 30, 60)
    }

    // ─── 摄像机 ───
    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 200)
    this.camera.position.set(15, 20, 15)
    this.camera.lookAt(0, 0, 0)

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
      if (e.button === 0) this.isLeftDown = false
      if (e.button === 2) this.isRightDown = false
    })

    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const dir = new THREE.Vector3()
      this.camera.getWorldDirection(dir)
      this.camera.position.addScaledVector(dir, -e.deltaY * 0.02)
    }, { passive: false })
  }

  private setupLighting() {
    // 环境光
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambient)

    // 半球光
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a3a4a, 0.4)
    this.scene.add(hemi)

    // 主方向光
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight.position.set(20, 30, 10)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 2048
    dirLight.shadow.mapSize.height = 2048
    dirLight.shadow.camera.near = 1
    dirLight.shadow.camera.far = 60
    dirLight.shadow.camera.left = -25
    dirLight.shadow.camera.right = 25
    dirLight.shadow.camera.top = 25
    dirLight.shadow.camera.bottom = -25
    this.scene.add(dirLight)

    // 补光
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3)
    fillLight.position.set(-10, 15, -10)
    this.scene.add(fillLight)
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
      this.camera.aspect = this.targetAspect
    } else {
      canvasW = width
      canvasH = height
      this.camera.aspect = width / height
    }

    const w = Math.round(canvasW)
    const h = Math.round(canvasH)
    this.renderer.setSize(w, h)
    this.camera.updateProjectionMatrix()

    // UI 覆盖层宿主跟随 canvas 实际渲染矩形，使 React HUD 对齐画面而非黑边
    this.uiLayer.style.width = `${w}px`
    this.uiLayer.style.height = `${h}px`
  }

  // ─── 动画循环 ───

  start() {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      // WASD 漫游
      this.updateWASD(dt)

      this.controls?.update()

      // 执行更新回调
      for (const cb of this.updateCallbacks) {
        cb(dt)
      }

      this.renderer.render(this.scene, this.camera)
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
    this.camera.fov = fov
    this.camera.updateProjectionMatrix()
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
      if (child.type === 'Scene' || child.type === 'PerspectiveCamera') {
        // 跳过场景和摄像机
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

  // ─── 清理 ───

  dispose() {
    this.stop()
    // 必须先强制丢失上下文再 dispose，否则 WebGL 上下文会泄漏
    this.renderer.forceContextLoss()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.uiLayer.remove()
  }
}
