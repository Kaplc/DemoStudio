/**
 * ScenePreviewManager — 场景资产 3D 预览
 *
 * 为场景预览编辑器提供专用 3D 视口，自由漫游控制：
 *  - 左键旋转视角 · 右键平移 · 滚轮前进/后退
 *  - WASD 移动 · Q/E 升降
 *
 * 特性：
 *  - 独立的 THREE.Scene（默认光照 + 网格地面）
 *  - 专用 WebGLRenderer
 *  - 通过 loadScene 加载场景资产并将网格生成为 GenericActor + MeshComponent
 *  - 自动清理（dispose）
 */
import * as THREE from 'three'
import { World } from '../../engine'
import { logger } from '../../engine'
import { loadScene } from '../../engine'
import { GenericActor, MeshComponent, Actor } from '../../engine'
import { LightComponent } from '../../engine'
import type { LightComponentOptions } from '../../engine'
import type { SceneAsset } from '../../engine'
import { select, notifySelectionChange } from '../SelectionManager'
import { TransformGizmo } from '../TransformGizmo'
import { AssetPreviewManager } from './AssetPreviewManager'

export class ScenePreviewManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World
  readonly gizmo: TransformGizmo

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0
  private _currentScenePath: string | null = null

  // ─── 场景数据（编辑用） ───
  private _sceneAsset: SceneAsset | null = null
  private _actorTreeCache: SceneTreeNode[] | null = null

  // ─── 树变化回调 ───
  private _onChangeCallbacks: Array<() => void> = []

  onChange(cb: () => void): () => void {
    this._onChangeCallbacks.push(cb)
    return () => {
      const i = this._onChangeCallbacks.indexOf(cb)
      if (i >= 0) this._onChangeCallbacks.splice(i, 1)
    }
  }

  /** 使 Actor 树缓存失效（World Actor 列表变化时由 watchWorldActorChanges 调用，大纲即时反映新增/销毁） */
  invalidateActorTree(): void {
    this._actorTreeCache = null
  }

  private notifyChange() {
    this._actorTreeCache = null
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
  private wasdEnabled = true
  private wasdKeys = new Set<string>()
  private wasdSpeed = 8

  // ─── WebGL 上下文丢失/恢复 ───
  private contextLost = false
  private _onContextLost: ((e: Event) => void) | null = null
  private _onContextRestored: (() => void) | null = null

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

    // ─── Gizmo ───
    this.gizmo = new TransformGizmo()
    this.gizmo.setup(this.scene, this.camera, this.renderer)
    this.scene.add(this.gizmo.group)

    // ─── 输入 ───
    this.initFlyEuler()
    this.setupFlyMouse()

    // ─── World ───
    this.world = new World(this.scene)

    // ─── 默认内容 ───
    this.setupLighting()
    this.setupHelpers()

    // ─── WebGL 上下文丢失/恢复：GPU 重置或内存不足时暂停渲染，恢复后重建纹理继续 ───
    this._onContextLost = (e: Event) => {
      e.preventDefault() // 阻止浏览器永久销毁上下文，允许后续恢复
      this.contextLost = true
      this.stop()
      logger.warn('[ScenePreview] WebGL 上下文丢失，已暂停渲染，等待浏览器恢复…')
    }
    this._onContextRestored = () => {
      logger.info('[ScenePreview] WebGL 上下文已恢复，重建纹理并恢复渲染')
      this.restoreAllTextures()
      this.contextLost = false
      this.start()
    }
    this.renderer.domElement.addEventListener('webglcontextlost', this._onContextLost, false)
    this.renderer.domElement.addEventListener('webglcontextrestored', this._onContextRestored, false)

    // ─── 启动渲染循环 ───
    this.start()
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

  // ════════════════════════════════════════
  //  输入初始化
  // ════════════════════════════════════════

  private initFlyEuler() {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    this.euler.setFromQuaternion(this.camera.quaternion)
    this.euler.order = 'YXZ'
  }

  /** 外部调用：保存后恢复摄像机位姿（含 fly euler 同步，避免下次鼠标移动跳动） */
  restoreCamera(pos: THREE.Vector3, quat: THREE.Quaternion) {
    // logger.debug(`[ScenePreview] restoreCamera pos=${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}`)
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
        // 左键拖拽: 旋转摄像机自身
        this.euler.y -= dx * this.flySensitivity
        this.euler.x -= dy * this.flySensitivity
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

    // 滚轮: 前进/后退
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const dir = new THREE.Vector3()
      this.camera.getWorldDirection(dir)
      this.camera.position.addScaledVector(dir, -e.deltaY * 0.02)
    }, { passive: false })
  }

  // ════════════════════════════════════════
  //  光照 & 辅助
  // ════════════════════════════════════════

  private setupLighting() {
    // 灯光 actor 化：灯光挂到 Actor 上（LightComponent），大纲显示为可选中/可编辑的节点
    // 用 world.SpawnActor 挂载（带生命周期；与场景内 actor 一致）
    const makeLightActor = (name: string, options: LightComponentOptions) => {
      const actor = new GenericActor(name)
      actor.addComponent(new LightComponent(actor, options))
      this.world.SpawnActor(actor)
      return actor
    }

    // 环境光
    makeLightActor('AmbientLight', { type: 'ambient', color: '#ffffff', intensity: 0.7 })
    // 半球光
    makeLightActor('HemisphereLight', { type: 'hemisphere', color: '#87ceeb', intensity: 0.5 })
    // 主方向光（带阴影）
    makeLightActor('KeyLight', {
      type: 'directional', color: '#ffffff', intensity: 1.5,
      position: [10, 15, 8], castShadow: true,
    })
    // 补光
    makeLightActor('FillLight', {
      type: 'directional', color: '#8888ff', intensity: 0.4,
      position: [-5, 10, -8],
    })
  }

  private setupHelpers() {
    const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355)
    grid.position.y = -0.01
    this.scene.add(grid)
  }

  // ════════════════════════════════════════
  //  场景资产加载
  // ════════════════════════════════════════

  /** 加载并预览场景资产（保持与 World.loadSceneAsActors 一致的层级结构） */
  loadSceneAsset(sceneData: SceneAsset): boolean {
    this.clearPreview()
    this._sceneAsset = sceneData

    const result = loadScene(sceneData)

    // 场景根 Actor
    const rootActor = new GenericActor(sceneData.name)
    this.world.SpawnActor(rootActor)

    // 标记已有 actor/ref 节点的 mesh（避免与新格式重复创建 GenericActor）
    const actorRefNames = new Set<string>()
    for (const an of (result.actorNodes ?? [])) { if (an.name) actorRefNames.add(an.name) }
    for (const rn of (result.refNodes ?? [])) { if (rn.name) actorRefNames.add(rn.name) }
    for (const bp of (result.blueprintNodes ?? [])) { if (bp.name) actorRefNames.add(bp.name) }

    // 几何节点 → GenericActor + MeshComponent（跳过已有 actor/ref 的 mesh）
    const meshes: THREE.Mesh[] = []
    result.group.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.push(node)
    })
    for (const mesh of meshes) {
      const ownerName = mesh.name?.split('_mesh')[0] ?? ''
      if (ownerName && actorRefNames.has(ownerName)) continue

      result.group.remove(mesh)
      const actor = new GenericActor(`Preview_${mesh.name || ''}`)
      actor.addComponent(new MeshComponent(actor, mesh))
      actor.attachTo(rootActor)
      this.world.SpawnActor(actor)
    }

    // ref 节点 → SpawnActorFromBlueprint（标记为整体，大纲不展开内部）
    for (const rn of (result.refNodes ?? [])) {
      const overrides: Record<string, unknown> = { ...(rn.overrides ?? {}) }
      overrides.position = rn.position
      overrides.rotation = rn.rotation
      overrides.scale = rn.scale
      const actor = this.world.SpawnActorFromBlueprint(rn.ref, overrides)
      if (actor) { actor.isRefInstance = true; actor.attachTo(rootActor) }
    }

    // blueprint 节点（旧格式兼容，标记为整体）
    for (const bp of (result.blueprintNodes ?? [])) {
      const overrides: Record<string, unknown> = { ...(bp.overrides ?? {}) }
      if (bp.pos) overrides.position = bp.pos
      if (bp.rot) overrides.rotation = bp.rot
      if (bp.scale) overrides.scale = bp.scale
      const actor = this.world.SpawnActorFromBlueprint(bp.blueprint, overrides)
      if (actor) { actor.isRefInstance = true; actor.attachTo(rootActor) }
    }

    // 内联 Actor 节点 → spawnInlineActor（含递归子级）
    for (const an of (result.actorNodes ?? [])) {
      const actor = this.world.spawnInlineActor(an)
      if (actor) actor.attachTo(rootActor)
    }

    // 应用 skybox
    if (result.skybox) {
      if (result.skybox.backgroundColor) {
        this.scene.background = new THREE.Color(result.skybox.backgroundColor)
      }
    }

    this.world.BeginPlay()
    this.world.manualTick(0)

    this.notifyChange()

    // 聚焦
    this.fitToScene(result.group)

    // 通知 UI 刷新（Outline 依赖 selectionKey 重建树）
    logger.debug(`[OutlinerTrace] loadSceneAsset 完成, 调用 notifySelectionChange, currentScenePath=${this._currentScenePath}, actorCount=${this.world.actorCount}`)
    notifySelectionChange()

    const actorCount = this.world.actorCount
    logger.info(`[ScenePreview] 加载场景预览: ${sceneData.name}, ${actorCount} 个 Actor（网格=${meshes.length}, ref=${(result.refNodes ?? []).length}, actor=${(result.actorNodes ?? []).length}）`)
    return true
  }

  clearPreview() {
    logger.debug(`[OutlinerTrace] clearPreview → select(null) → _selectionKey++, currentScenePath 将变 null`)
    select(null)
    this.gizmo.detach()
    this.world.DestroyAllActors()
    this._sceneAsset = null
    this._currentScenePath = null
    this._actorTreeCache = null
    this.notifyChange()
    logger.debug(`[OutlinerTrace] clearPreview 完成, currentScenePath=${this._currentScenePath}, actorCount=${this.world.actorCount}`)
  }

  private fitToScene(group: THREE.Group) {
    const box = new THREE.Box3().setFromObject(group)
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

  get currentScenePath(): string | null {
    return this._currentScenePath
  }

  /**
   * 将本实例登记为全局活动实例（供 Outline/Inspector 读取），并通知 UI 刷新。
   */
  activate(assetPath?: string): void {
    logger.debug(`[OutlinerTrace] activate(${assetPath}) → _currentScenePath=${assetPath}, 调用 notifySelectionChange`)
    if (assetPath) {
      this._currentScenePath = assetPath
      AssetPreviewManager.setActive(assetPath)
    }
    this.notifyChange()
    notifySelectionChange()
  }

  // ════════════════════════════════════════
  //  选中 & 聚焦（同 BlueprintPreviewManager）
  // ════════════════════════════════════════

  selectActor(actor: Actor | null) {
    if (actor) {
      select(actor)
      this.gizmo.attach(actor.root)
    } else {
      select(null)
      this.gizmo.detach()
    }
  }

  focusActor(actor: Actor) {
    this.selectActor(actor)
    const box = new THREE.Box3().setFromObject(actor.root)
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

  getActorTree(): SceneTreeNode[] {
    if (this._actorTreeCache) return this._actorTreeCache

    const result: SceneTreeNode[] = []

    function walk(obj: THREE.Object3D, depth: number) {
      // 可见性过滤：无 actor 的纯渲染对象不可见时跳过；有 actor 的节点始终保留显示
      // （含被 canvas active 隐藏 / 大纲眼睛 previewHidden 隐藏的节点，便于恢复选择）
      const refActor = (obj as any).userData?.actorRef as Actor | undefined
      if (!obj.visible && !refActor && obj.type !== 'Scene') return
      if (obj.type === 'GridHelper' || obj.type === 'AxesHelper' || obj.type === 'AmbientLight' || obj.type === 'HemisphereLight') return
      if (obj.name === 'TransformGizmo') return

      const isRoot = obj.type === 'Scene'
      if (!isRoot) {
        const actorRef = (obj as any).userData?.actorRef as Actor | undefined
        if (!actorRef) return
        result.push({ depth, name: obj.name || obj.type, actor: actorRef })
        if (actorRef.isRefInstance) return
      }

      const nextDepth = isRoot ? depth : depth + 1
      for (const child of obj.children) walk(child, nextDepth)
    }

    walk(this.scene, 0)
    this._actorTreeCache = result
    return result
  }

  /**
   * 收集保存数据：遍历大纲 Actor，将实时 transform 回写到 _sceneAsset.objects 对应的节点。
   * 只更新 position，因为旧格式节点无 rotation/scale（除 blueprint 外）。
   */
  collectSaveData(): Record<string, unknown> | null {
    if (!this._sceneAsset) return null

    const objects = this._sceneAsset.objects as unknown as Array<Record<string, unknown>>
    const actors = this.world.GetAllActors()

    // 按名称建立 Actor → JSON 节点索引
    for (const obj of objects) {
      const name = obj.name as string | undefined
      if (!name) continue

      // 匹配场景中的 Actor（根 Actor 跳过）
      for (const actor of actors) {
        if (actor.root.name === name || actor.name === name) {
          // 统一用 position/rotation/scale（新格式）
          if (obj.type === 'actor' || obj.type === 'ref') {
            obj.position = [actor.position.x, actor.position.y, actor.position.z]
            obj.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
            obj.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
          } else {
            // 旧格式：只更新 pos
            obj.pos = [actor.position.x, actor.position.y, actor.position.z]
          }
          break
        }
      }
    }

    return JSON.parse(JSON.stringify(this._sceneAsset)) as Record<string, unknown>
  }

  // ════════════════════════════════════════
  //  生命周期
  // ════════════════════════════════════════

  resize() {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private start() {
    this.lastTime = performance.now()
    const animate = (time: number) => {
      // 上下文丢失期间跳过渲染，避免对失效 GL 上下文上传纹理报错
      if (this.contextLost) {
        this.animationId = requestAnimationFrame(animate)
        return
      }
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      // WASD 漫游
      this.updateWASD(dt)

      // Gizmo 同步
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
    select(null)
    this.gizmo.detach()
    this.gizmo.dispose()
    // 彻底销毁预览 World（含 UIManager/ActorManagerComponent 三件套自身的 reclaimForWorld），
    // 避免 tab 切换/工程切换累积泄漏 World 三件套（编辑器 lifetime 内只有一份 World）。
    // clearPreview 走 DestroyAllActors 是容器复用语义（保留 World 实例）；这是 manager 终局销毁。
    this.world.Destroy()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this._sceneAsset = null
    this._actorTreeCache = null
    this._onChangeCallbacks = []
  }

  // ════════════════════════════════════════
  //  WASD 漫游
  // ════════════════════════════════════════

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
}

/** 大纲树节点（同 SelectionManager.SceneTreeNode） */
export interface SceneTreeNode {
  depth: number
  name: string
  actor: Actor | null
}
