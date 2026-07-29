/**
 * BlueprintPreviewManager — 蓝图 3D 预览
 *
 * 为蓝图编辑器提供专用的 3D 场景：
 *  - 独立的 THREE.Scene（默认光照 + 网格地面）
 *  - 专用 WebGLRenderer
 *  - 自由漫游控制（左键旋转 · 右键平移 · 滚轮缩放 · WASD 漫游）
 *  - 内置 World，通过 SpawnActorFromBlueprint 实例化蓝图 Actor
 *  - 自动清理（dispose）
 *  - 支持从 Outline 选中聚焦 + 坐标轴 Gizmo
 */
import * as THREE from 'three'
import { World } from '../engine'
import { logger } from '../engine'
import { BlueprintRegistry } from '../engine'
import { Actor } from '../engine/gameplay/entity/Actor'
import { select, notifySelectionChange } from './SelectionManager'
import { TransformGizmo } from './TransformGizmo'
import { AssetPreviewManager } from './AssetPreviewManager'
import type { SceneTreeNode } from './SelectionManager'

export class BlueprintPreviewManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0
  private _currentBlueprintPath: string | null = null

  /**
   * 当前预览蓝图 JSON 的可变深拷贝。loadBlueprint 时建立，
   * collectSaveData 据此生成保存数据。
   */
  private _jsonTree: Record<string, unknown> | null = null

  /** Actor → JSON 节点映射（以对象引用为 key），由 loadBlueprint 在 spawn 后构建 */
  private _actorJsonMap: Map<Actor, Record<string, unknown>> | null = null

  /** 当前预览的 Actor 根节点缓存，用于快速重建 */
  private previewRoot: THREE.Object3D | null = null

  /** 大纲树缓存：结构不变时复用，避免每次 render 都遍历场景 */
  private _actorTreeCache: SceneTreeNode[] | null = null

  /** 变换 Gizmo */
  readonly gizmo: TransformGizmo

  // ─── 树变化回调 ───
  private _onChangeCallbacks: Array<() => void> = []

  onChange(cb: () => void): () => void {
    this._onChangeCallbacks.push(cb)
    return () => {
      const i = this._onChangeCallbacks.indexOf(cb)
      if (i >= 0) this._onChangeCallbacks.splice(i, 1)
    }
  }

  private notifyChange() {
    for (const cb of this._onChangeCallbacks) cb()
  }

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

    // ─── TransformGizmo ───
    this.gizmo = new TransformGizmo()
    this.gizmo.setup(this.scene, this.camera, this.renderer)

    // ─── World ───
    this.world = new World(this.scene)

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

  /** 外部调用：保存后恢复摄像机位姿（含 fly euler 同步，避免下次鼠标移动跳动） */
  restoreCamera(pos: THREE.Vector3, quat: THREE.Quaternion) {
    // logger.debug(`[BlueprintPreview] restoreCamera pos=${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}`)
    this.camera.position.copy(pos)
    this.camera.quaternion.copy(quat)
    this.initFlyEuler()
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

  loadBlueprint(path: string): boolean {
    // logger.debug(`[BlueprintPreview] loadBlueprint 开始 path=${path} 摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    this.clearPreview()
    // logger.debug(`[BlueprintPreview] clearPreview 后摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)

    // 持有蓝图 JSON 的可变深拷贝
    const asset = BlueprintRegistry.get(path)
    this._jsonTree = asset ? (JSON.parse(JSON.stringify(asset)) as Record<string, unknown>) : null

    const actor = this.world.SpawnActorFromBlueprint(path, undefined)
    if (!actor) {
      logger.warn(`[BlueprintPreview] SpawnActorFromBlueprint("${path}") 失败`)
      return false
    }

    // 构建 Actor.uid → JSON 节点映射（跳过 ref 实例，它们属于另一文件）
    if (!this._jsonTree) return false
    this._actorJsonMap = new Map()
    const buildMapping = (a: Actor, jsonNode: Record<string, unknown>) => {
      this._actorJsonMap!.set(a, jsonNode)
      const childActors = a.getChildren().filter((c) => !c.isRefInstance)
      const jsonChildren = (jsonNode.children as Array<Record<string, unknown>> | undefined) ?? []
      for (let i = 0; i < Math.min(childActors.length, jsonChildren.length); i++) {
        buildMapping(childActors[i], jsonChildren[i])
      }
    }
    buildMapping(actor, this._jsonTree)

    this.world.BeginPlay()
    this.world.manualTick(0)

    this._currentBlueprintPath = path

    // logger.debug(`[BlueprintPreview] fitToActor 前摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    this.fitToActor(actor.root)
    // logger.debug(`[BlueprintPreview] fitToActor 后摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    this.notifyChange()

    logger.info(`[BlueprintPreview] 加载蓝图预览: ${path}`)
    return true
  }

  clearPreview() {
    // logger.debug(`[BlueprintPreview] clearPreview 开始 摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    select(null)
    this.gizmo.detach()
    this.world.DestroyAllActors()
    this._currentBlueprintPath = null
    this.previewRoot = null
    this._jsonTree = null
    this._actorJsonMap = null
    this._actorTreeCache = null
    this.notifyChange()
    // logger.debug(`[BlueprintPreview] clearPreview 结束 摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
  }

  get currentBlueprintId(): string | null {
    return this._currentBlueprintPath
  }

  getActorTree(): SceneTreeNode[] {
    if (this._actorTreeCache) return this._actorTreeCache

    const result: SceneTreeNode[] = []

    function walk(obj: THREE.Object3D, depth: number) {
      if (!obj.visible && obj.type !== 'Scene') return
      if (obj.type === 'GridHelper' || obj.type === 'AxesHelper' || obj.type === 'AmbientLight' || obj.type === 'HemisphereLight') return
      if (obj.name === 'TransformGizmo' || obj.name === '__bp_focus_marker__') return

      const isRoot = obj.type === 'Scene'
      if (!isRoot) {
        const actorRef = (obj as any).userData?.actorRef as Actor | undefined
        if (!actorRef) return
        result.push({
          depth,
          name: obj.name || obj.type,
          actor: actorRef,
        })
        if (actorRef.isRefInstance) return
      }

      const nextDepth = isRoot ? depth : depth + 1
      for (const child of obj.children) {
        walk(child, nextDepth)
      }
    }

    walk(this.scene, 0)
    this._actorTreeCache = result
    return result
  }

  /**
   * 收集保存数据：遍历大纲 Actor，通过 _actorJsonMap 把实时 transform 回写到各 Actor
   * 对应的 JSON 节点，返回一份干净的深拷贝供写入磁盘。
   *
   * 相比按字符串 ref 反查 JSON：O(1) 直查、零歧义，且覆盖内联 baseClass / 容器子节点
   * （它们没有 blueprintRef，旧方案无法保存）。
   */
  collectSaveData(): Record<string, unknown> | null {
    if (!this._jsonTree || !this._actorJsonMap) return null

    for (const treeNode of this.getActorTree()) {
      const actor = treeNode.actor
      const jsonNode = actor ? this._actorJsonMap.get(actor) : undefined
      if (!actor || !jsonNode) continue
      jsonNode.position = [actor.position.x, actor.position.y, actor.position.z]
      jsonNode.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
      jsonNode.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
    }

    return JSON.parse(JSON.stringify(this._jsonTree)) as Record<string, unknown>
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
      if (this.gizmo.visible) this.gizmo.syncTransform()
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
    select(null)
    this.gizmo.dispose()
    this.world.DestroyAllActors()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this._actorJsonMap = null
    this._jsonTree = null
    this.previewRoot = null
    this._actorTreeCache = null
    this._currentBlueprintPath = null
  }

  // ═══════════════════════════════════
  //  选中 & 聚焦
  // ═══════════════════════════════════

  selectActor(actor: Actor | null) {
    if (actor) {
      select(actor)
      this.gizmo.attach(actor.root)
    } else {
      select(null)
      this.gizmo.detach()
    }
  }

  /**
   * 将本实例登记为全局活动实例（供 Outline/Inspector 读取），并通知 UI 刷新。
   *
   * 背景：所有蓝图页签常驻挂载（display:none 切换），每个 BlueprintEditor 各持一个
   * BlueprintPreviewManager。若仅靠构造函数写 _activeInstance，活动实例会停留在
   * 「最后构造」的页签而非「当前激活」的页签。故切到某页签时需显式 activate。
   */
  activate(assetPath?: string): void {
    if (assetPath) AssetPreviewManager.setActive(assetPath)
    this.notifyChange()
    notifySelectionChange()
  }

  focusActor(actor: Actor) {
    this.selectActor(actor)
    this.fitToActor(actor.root)
  }

  /** 按名称查找并聚焦（供 BlueprintTreeView 回落使用） */
  focusOnActor(actorName: string): boolean {
    const allActors = this.world.GetAllActors()
    for (const actor of allActors) {
      if (actor.name === actorName || actor.root.name === actorName || String(actor.blueprintRef?.id) === actorName) {
        this.focusActor(actor)
        return true
      }
    }
    logger.warn(`[BlueprintPreview] focusOnActor("${actorName}"): 未找到匹配 Actor`)
    return false
  }
}
