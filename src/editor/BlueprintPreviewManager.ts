/**
 * BlueprintPreviewManager — 蓝图 3D 预览
 *
 * 为蓝图编辑器提供专用的 3D 场景：
 *  - 独立的 THREE.Scene（默认光照 + 网格地面）
 *  - 专用 WebGLRenderer
 *  - 自由漫游控制（左键旋转 · 右键平移 · 滚轮缩放 · WASD 漫游）
 *  - 内置 World，通过 SpawnActorFromBlueprint 实例化蓝图 Actor
 *  - 自动清理（dispose）
 *  - 支持从 Outline 选中聚焦 + 显示坐标轴标记
 */
import * as THREE from 'three'
import { World } from '../engine'
import { logger } from '../engine'
import { Actor } from '../engine/gameplay/entity/Actor'
import { select } from './SelectionManager'

export class BlueprintPreviewManager {
  /** 全局活动实例（供 Outline 访问） */
  private static _activeInstance: BlueprintPreviewManager | null = null

  /** 获取当前活动实例 */
  static getActiveInstance(): BlueprintPreviewManager | null {
    return BlueprintPreviewManager._activeInstance
  }

  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0
  private _currentBlueprintId: number | null = null

  /** 当前预览的 Actor 根节点缓存，用于快速重建 */
  private previewRoot: THREE.Object3D | null = null

  // ─── 聚焦标记 ───
  private focusMarker: THREE.Group | null = null

  // ─── Fly 自由漫游 ───
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private isLeftDown = false
  private isRightDown = false
  private prevMouseX = 0
  private prevMouseY = 0
  private flySensitivity = 0.0015

  // ─── WASD ───
  private wasdKeys = new Set<string>()
  private wasdSpeed = 8

  constructor(container: HTMLElement) {
    this.container = container

    // ─── 渲染器 ───
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    // ─── 场景 ───
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)

    // ─── 摄像机 ───
    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200)
    this.camera.position.set(5, 4, 5)
    this.camera.lookAt(0, 0, 0)

    // ─── 输入 ───
    this.initFlyEuler()
    this.setupFlyMouse()

    // ─── World ───
    this.world = new World(this.scene)

    // ─── 注册为全局活动实例 ───
    BlueprintPreviewManager._activeInstance = this

    // ─── 默认内容 ───
    this.setupLighting()
    this.setupHelpers()

    // ─── 启动渲染循环 ───
    this.start()
  }

  /** 处理 WASD 按键按下 */
  onWASDKeyDown(key: string) {
    this.wasdKeys.add(key.toLowerCase())
  }

  /** 处理 WASD 按键释放 */
  onWASDKeyUp(key: string) {
    this.wasdKeys.delete(key.toLowerCase())
  }

  /** 清除所有按键状态 */
  clearWASDKeys() {
    this.wasdKeys.clear()
  }

  // ═══════════════════════════════════
  //  输入初始化
  // ═══════════════════════════════════

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
        // 左键旋转
        this.euler.y -= dx * this.flySensitivity
        this.euler.x -= dy * this.flySensitivity
        this.euler.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.euler.x))
        this.camera.quaternion.setFromEuler(this.euler)
      }

      if (this.isRightDown) {
        // 右键平移
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

  // ═══════════════════════════════════
  //  场景内容
  // ═══════════════════════════════════

  private setupLighting() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    this.scene.add(ambient)

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a3a4a, 0.5)
    this.scene.add(hemi)

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
    dirLight.position.set(10, 15, 8)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 1024
    dirLight.shadow.mapSize.height = 1024
    this.scene.add(dirLight)

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4)
    fillLight.position.set(-5, 10, -8)
    this.scene.add(fillLight)
  }

  private setupHelpers() {
    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355)
    grid.position.y = -0.01
    this.scene.add(grid)
  }

  // ═══════════════════════════════════
  //  蓝图加载
  // ═══════════════════════════════════

  loadBlueprint(blueprintId: number): boolean {
    this.clearPreview()

    const actor = this.world.SpawnActorFromBlueprint(blueprintId)
    if (!actor) {
      logger.warn(`[BlueprintPreview] SpawnActorFromBlueprint("${blueprintId}") 失败`)
      return false
    }

    this.world.BeginPlay()
    this.world.manualTick(0)

    this._currentBlueprintId = blueprintId

    this.fitToActor(actor.root)

    logger.info(`[BlueprintPreview] 加载蓝图预览: ${blueprintId}`)
    return true
  }

  clearPreview() {
    select(null)
    this.world.DestroyAllActors()
    this._currentBlueprintId = null
    this.previewRoot = null
  }

  get currentBlueprintId(): number | null {
    return this._currentBlueprintId
  }

  private fitToActor(root: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    if (size.length() < 0.01) {
      this.camera.position.set(5, 4, 5)
      this.camera.lookAt(0, 0, 0)
      return
    }

    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = maxDim * 2.5 + 2

    this.camera.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.6)
    this.camera.lookAt(center)
    this.initFlyEuler()
  }

  resize() {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return

    const aspect = width / height
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  // ═══════════════════════════════════
  //  渲染循环
  // ═══════════════════════════════════

  private start() {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      this.updateWASD(dt)
      this.renderer.render(this.scene, this.camera)
      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  private stop() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  // ═══════════════════════════════════
  //  WASD 漫游
  // ═══════════════════════════════════

  private updateWASD(dt: number) {
    if (this.wasdKeys.size === 0) return

    const speed = this.wasdSpeed * dt
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const worldUp = new THREE.Vector3(0, 1, 0)

    if (this.wasdKeys.has('w')) this.camera.position.addScaledVector(forward, speed)
    if (this.wasdKeys.has('s')) this.camera.position.addScaledVector(forward, -speed)
    if (this.wasdKeys.has('a')) this.camera.position.addScaledVector(right, -speed)
    if (this.wasdKeys.has('d')) this.camera.position.addScaledVector(right, speed)
    if (this.wasdKeys.has('q')) this.camera.position.addScaledVector(worldUp, -speed)
    if (this.wasdKeys.has('e')) this.camera.position.addScaledVector(worldUp, speed)
  }

  dispose() {
    this.stop()
    this.clearFocus()
    this.world.DestroyAllActors()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    if (BlueprintPreviewManager._activeInstance === this) {
      BlueprintPreviewManager._activeInstance = null
    }
    // 清空 SelectionManager 选中（避免选中已销毁的 Actor）
    select(null)
  }

  // ═══════════════════════════════════
  //  聚焦 & 标记
  // ═══════════════════════════════════

  focusOnActor(actorName: string): boolean {
    // 清除旧标记
    this.clearFocus()

    // 在世界中搜索匹配名称的 Actor
    const allActors = this.world.GetAllActors()
    let target: Actor | null = null
    for (const actor of allActors) {
      if (actor.name === actorName || actor.root.name === actorName || String(actor.blueprintRef?.id) === actorName) {
        target = actor
        break
      }
    }
    if (!target) {
      logger.warn(`[BlueprintPreview] focusOnActor("${actorName}"): 未找到匹配 Actor`)
      return false
    }

    // 选中（SelectionManager → Outline 高亮 + Inspector 显示详情）
    select(target)

    // 聚焦摄像机
    this.fitToActor(target.root)

    // 创建坐标轴标记
    this.buildFocusMarker(target.root)

    logger.info(`[BlueprintPreview] 聚焦 Actor: ${actorName}`)
    return true
  }

  /** 清除聚焦标记 */
  clearFocus() {
    if (this.focusMarker) {
      this.scene.remove(this.focusMarker)
      this.focusMarker = null
    }
  }

  /** 在目标对象上创建坐标轴 AxesHelper */
  private buildFocusMarker(target: THREE.Object3D) {
    const group = new THREE.Group()
    group.name = '__bp_focus_marker__'

    // 3 轴箭头
    const axes = new THREE.AxesHelper(0.6)
    group.add(axes)

    // 包围盒线框（白色闪烁）
    const box = new THREE.Box3().setFromObject(target)
    const size = box.getSize(new THREE.Vector3())
    if (size.length() > 0.01) {
      const boxHelper = new THREE.BoxHelper(target, 0xffffff)
      group.add(boxHelper)
    }

    this.scene.add(group)
    this.focusMarker = group
  }
}
