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
import { World, EditorActorComponent } from '../../engine'
import { getAllActors } from '../../engine'
import { logger } from '../../engine'
import { BlueprintRegistry } from '../../engine'
import { GenericActor, LightComponent } from '../../engine'
import type { LightComponentOptions } from '../../engine'
import type { Actor } from '../../engine/entity/Actor'
import type { ActorComponent } from '../../engine/entity/ActorComponent'
import { TransformComponent } from '../../engine/entity/TransformComponent'
import { select, notifySelectionChange } from '../SelectionManager'
import { TransformGizmo } from '../TransformGizmo'
import { AssetPreviewManager } from './AssetPreviewManager'
import { BlueprintEditorService } from '../blueprintEdit/BlueprintEditorService'
import { UndoManager } from '../blueprintEdit/UndoManager'
import { editorBus } from '../EditorEvents'
import { EditorEvent } from '../EditorEventNames'
import type { BlueprintAsset, BlueprintComponentDef, BlueprintChildDef } from '../../engine'
import { ColliderDebugDrawer } from './ColliderDebugDrawer'
import type { SceneTreeNode } from '../SelectionManager'
import { uniqueNodeName, nextChildId, reassignChildIds } from '../blueprintEdit/nodeTemplates'
import { useEditorStore } from '../../stores/editorStore'

/** 磁盘路径（src/projects/...）→ 蓝图注册 key（asset/...） */
function diskPathToAssetKey(diskPath: string): string {
  const idx = diskPath.indexOf('/asset/')
  return idx >= 0 ? diskPath.slice(idx + 1) : diskPath
}

export class BlueprintPreviewManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0
  /** 当前蓝图注册 key（asset/...，loadBlueprint 传入，供 Outline 查询） */
  private _currentBlueprintKey: string | null = null
  /** 当前蓝图磁盘路径（src/projects/...，BlueprintEditor 传入，供服务层读盘/写盘） */
  private _currentBlueprintDiskPath: string | null = null

  /**
   * 当前预览蓝图 JSON 的可变深拷贝。loadBlueprint 时建立，
   * collectSaveData 据此生成保存数据。
   */
  private _jsonTree: Record<string, unknown> | null = null

  /** Actor → JSON 节点映射（以对象引用为 key），由 loadBlueprint 在 spawn 后构建 */
  private _actorJsonMap: Map<Actor, Record<string, unknown>> | null = null

  // ─── 撤回系统（与 ScenePreviewManager 同构：内存栈 + 原地回滚，不重建预览）───
  /** 撤销栈 key（asset/...，activate 时建立；UndoManager 全局共享） */
  private _undoKey: string | null = null
  /** 撤回基准：最近一次已提交状态（独立深拷贝，防与 _jsonTree 同引用被写回污染） */
  private _lastCommitted: Record<string, unknown> | null = null

  /** 当前预览的 Actor 根节点缓存，用于快速重建 */
  private previewRoot: THREE.Object3D | null = null

  /** 大纲树缓存：结构不变时复用，避免每次 render 都遍历场景 */
  private _actorTreeCache: SceneTreeNode[] | null = null

  /** 变换 Gizmo */
  readonly gizmo: TransformGizmo

  /** 碰撞盒线框绘制器（预览模式从组件属性解析几何，V 键开关） */
  private colliderDrawer: ColliderDebugDrawer | null = null

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
    // 0 尺寸防御：隐藏页签（display:none）重建时容器尺寸为 0，
    // setSize(0,0) 会生成 0x0 canvas 且 aspect NaN → 切回后渲染失效。
    // 用兜底 1 尺寸创建，切回页签时 ResizeObserver/resize() 恢复真实尺寸。
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    // ─── 场景 ───
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)

    // ─── 摄像机 ───
    const aspect = w / h
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200)
    this.camera.position.set(5, 4, 5)
    this.camera.lookAt(0, 0, 0)

    // ─── 输入 ───
    this.initFlyEuler()
    this.setupFlyMouse()

    // ─── TransformGizmo ───
    this.gizmo = new TransformGizmo()
    this.gizmo.setup(this.scene, this.camera, this.renderer)

    // ─── World（EditorActorComponent 由 World 构造时自动添加）───
    this.world = new World()

    // ─── 碰撞盒线框绘制器（预览模式从组件属性解析几何）───
    this.colliderDrawer = new ColliderDebugDrawer(this.scene)

    // ─── 默认内容 ───
    this.setupLighting()
    this.setupHelpers()

    // ─── WebGL 上下文丢失/恢复：GPU 重置或内存不足时暂停渲染，恢复后重建纹理继续 ───
    this._onContextLost = (e: Event) => {
      e.preventDefault() // 阻止浏览器永久销毁上下文，允许后续恢复
      this.contextLost = true
      this.stop()
      logger.warn('[BlueprintPreview] WebGL 上下文丢失，已暂停渲染，等待浏览器恢复…')
    }
    this._onContextRestored = () => {
      logger.info('[BlueprintPreview] WebGL 上下文已恢复，重建纹理并恢复渲染')
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
    // 灯光 actor 化：灯光挂到 Actor（LightComponent），大纲显示为可选中/可编辑的节点
    const makeLightActor = (name: string, options: LightComponentOptions): void => {
      const actor = new GenericActor(name)
      actor.addComponent(LightComponent, options)
      this.scene.add(actor.root)
    }
    makeLightActor('AmbientLight', { type: 'ambient', color: '#ffffff', intensity: 0.7 })
    makeLightActor('HemisphereLight', { type: 'hemisphere', color: '#87ceeb', intensity: 0.5 })
    makeLightActor('KeyLight', {
      type: 'directional', color: '#ffffff', intensity: 1.5,
      position: [10, 15, 8], castShadow: true,
    })
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

  // ═══════════════════════════════════
  //  蓝图加载
  // ═══════════════════════════════════

  /**
   * 加载蓝图到预览场景。
   * @param path     蓝图注册 key（asset/...）
   * @param diskPath 磁盘路径（src/projects/...，可选；提交/保存经服务层时必需）
   */
  loadBlueprint(path: string, diskPath?: string): boolean {
    // logger.debug(`[BlueprintPreview] loadBlueprint 开始 path=${path} 摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    this.clearPreview()
    // logger.debug(`[BlueprintPreview] clearPreview 后摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)

    // 持有蓝图 JSON 的可变深拷贝
    const asset = BlueprintRegistry.get(path)
    this._jsonTree = asset ? (JSON.parse(JSON.stringify(asset)) as Record<string, unknown>) : null

    const actor = this.world.getComponent(EditorActorComponent)!.Instantiate(path, undefined)
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

    this._currentBlueprintKey = path
    this._currentBlueprintDiskPath = diskPath ?? null

    // logger.debug(`[BlueprintPreview] fitToActor 前摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    this.fitToActor(actor.root)
    // logger.debug(`[BlueprintPreview] fitToActor 后摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    this.notifyChange()

    logger.info(`[BlueprintPreview] 加载蓝图预览: ${path}${this._currentBlueprintDiskPath ? `（磁盘 ${this._currentBlueprintDiskPath}）` : ''}`)
    return true
  }

  clearPreview() {
    // logger.debug(`[BlueprintPreview] clearPreview 开始 摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
    select(null)
    this.gizmo.detach()
    this.world.DestroyAllActors()
    this._currentBlueprintKey = null
    this._currentBlueprintDiskPath = null
    this.previewRoot = null
    this._jsonTree = null
    this._actorJsonMap = null
    this._actorTreeCache = null
    this.notifyChange()
    // logger.debug(`[BlueprintPreview] clearPreview 结束 摄像机=${this.camera.position.x.toFixed(3)},${this.camera.position.y.toFixed(3)},${this.camera.position.z.toFixed(3)}`)
  }

  /** 使 Actor 树缓存失效（World Actor 列表变化时由 watchWorldActorChanges 调用，大纲即时反映新增/销毁） */
  invalidateActorTree(): void {
    this._actorTreeCache = null
  }

  get currentBlueprintId(): string | null {
    return this._currentBlueprintKey
  }

  /** 该 Actor 是否对应资产 JSON 中的节点（false = 代码生成的子节点，无法做资产级结构编辑） */
  hasJsonNode(actor: Actor): boolean {
    return this._actorJsonMap?.has(actor) ?? false
  }

  /** 返回该 Actor 对应的资产 JSON 节点（根节点/代码生成节点返回 null）。
   *  蓝图子节点必有全资产唯一 id，Outline 按引用定位父节点时读取它。 */
  getJsonNodeForActor(actor: Actor): Record<string, unknown> | null {
    return this._actorJsonMap?.get(actor) ?? null
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

      // ─── 通用组件属性持久化：扫描每个组件可编辑属性写回 JSON ───
      const jsonComps = (jsonNode.components as Array<Record<string, any>> | undefined) ?? []
      for (const comp of actor.getAllComponents() as ActorComponent[]) {
        if (!comp.persistType) continue
        // 跳过运行时自动生成的内部组件（如 UIButton 透明点击层 UIImageComponent，isClickOnly=true）：
        // 不写进资产，避免保存后出现重复 image 组件
        if ((comp as unknown as { isClickOnly?: boolean }).isClickOnly) continue
        const target = jsonComps.find((c) => c.baseClass === comp.persistType)
        if (!target) continue
        const props = (target.properties ?? {}) as Record<string, unknown>
        const persist = comp.getPersistentProps()
        // 合入（不删除现有键，避免丢失 JSON 中只读/代码配置的属性）
        for (const [k, v] of Object.entries(persist)) {
          props[k] = v
        }
      }

      // 组件优先：含 transform/uitransform 组件的节点，位置/旋转/缩放只写在组件 properties，
      // 顶层 position/rotation/scale 冗余字段直接删除（引擎加载时组件为权威，无需兜底）
      const tf = actor.getComponent(TransformComponent)
      if (!tf) {
        jsonNode.position = [actor.position.x, actor.position.y, actor.position.z]
        jsonNode.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
        jsonNode.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
        continue
      }
      delete jsonNode.position
      delete jsonNode.rotation
      delete jsonNode.scale
      const target = jsonComps.find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
      if (target) {
        const props = (target.properties ?? {}) as Record<string, unknown>
        // tsf.properties 里的 position/rotation/scale 是最终权威：重载时 TransformComponent 构造会读取
        props.position = [actor.position.x, actor.position.y, actor.position.z]
        props.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
        props.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
      }
    }

    return JSON.parse(JSON.stringify(this._jsonTree)) as Record<string, unknown>
  }

  /**
   * 3D gizmo 拖动松手统一提交：把本次拖拽目标节点变换组件的属性变化通过 apply 链路提交。
   * 撤回点（动作前快照）在 apply 内部 push = 松手才进撤回系统（拖动中每帧不产生撤销点）。
   * @param target 本次被 gizmo 拖动的 Actor（通常为当前选中节点）
   */
  async commitPreviewEdit(target: Actor | null): Promise<void> {
    const key = this._undoKey
    if (!key) {
      logger.warn(`[BlueprintPreview] 拖拽提交跳过（无撤销 key，activate 未调用）`)
      return
    }
    if (!target) return
    // 先把 actor 实时 transform 回写进 jsonTree（collectSaveData 原地回写），后续对比才能取到拖拽后的值
    const data = this.collectSaveData()
    if (!data) return
    if (this._lastCommitted === null) {
      // 无基准（理论上 activate 已建立）：以当前为基准（独立拷贝），不产生撤销点
      this._lastCommitted = JSON.parse(JSON.stringify(data))
      logger.info(`[BlueprintPreview] 拖拽提交（首帧基准）: ${key}`)
      return
    }
    // 内容无变化（拖动后松手位置与基准一致）→ 跳过，避免空撤销点
    if (JSON.stringify(data) === JSON.stringify(this._lastCommitted)) {
      logger.info(`[BlueprintPreview] 拖拽提交跳过（内容无变化）: ${key}`)
      return
    }
    UndoManager.push(key, this._lastCommitted)
    // 注意：基准必须独立深拷贝（防与 _jsonTree 同引用被 collectSaveData 写回污染）
    this._lastCommitted = JSON.parse(JSON.stringify(data))
    // 同步工作副本（不 bump：预览已是内存最新，重建只会浪费并丢引用）
    const diskPath = this._currentBlueprintDiskPath
    if (diskPath) {
      await BlueprintEditorService.updateFromPreview(diskPath, data as unknown as BlueprintAsset)
    }
    editorBus.emit(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, diskPath ?? '')
    logger.info(`[BlueprintPreview] 松手提交（= 一个撤销点）: "${target.name}" → ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
  }

  // ════════════════════════════════════════
  //  撤回系统（拖拽提交 / undo / redo，与 ScenePreviewManager 同构：内存栈 + 原地回滚）
  // ════════════════════════════════════════

  /** 撤销/重做按钮可用状态 */
  canUndo(): boolean {
    return this._undoKey !== null && UndoManager.canUndo(this._undoKey)
  }

  canRedo(): boolean {
    return this._undoKey !== null && UndoManager.canRedo(this._undoKey)
  }

  /** 撤销：从内存栈取动作前快照 → 原地回滚（不重建预览，actor 引用/选中/相机保持）；无可撤历史返回 false */
  undo(): boolean {
    const key = this._undoKey
    if (!key || !this.canUndo()) {
      logger.warn(`[BlueprintPreview] undo 无历史可撤: ${key ?? '无 key'}`)
      return false
    }
    const cur = this.collectSaveData() ?? this._lastCommitted
    const snap = UndoManager.undo(key, cur)
    if (snap == null) return false
    // snap 作为新基准；传入 _applySnapshotInPlace 的必须是深拷贝——原地回滚内部
    // 会把 _jsonTree 指向深拷贝快照，若与基准同引用，下次 collectSaveData
    // 原地写回又会污染基准（undo → 新编辑 → 被判"无变化"不进栈的残余路径）。
    this._lastCommitted = snap as Record<string, unknown>
    const applied = this._applySnapshotInPlace(JSON.parse(JSON.stringify(snap)) as Record<string, unknown>)
    if (!applied) {
      // 结构变更（增删节点/重命名）：注册表回滚 + 全量重建预览
      logger.info(`[BlueprintPreview] undo 结构变更 → 重建预览: ${key}`)
      BlueprintRegistry.loadFromJson(key, snap as unknown as BlueprintAsset)
      this.loadBlueprint(key, this._currentBlueprintDiskPath ?? undefined)
    }
    // 同步工作副本（不 bump）：保证服务层与预览一致（Inspector 后续 apply 不会基于旧值覆盖回滚结果）
    void this.syncWorkingCopy()
    logger.info(`[BlueprintPreview] undo: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
    return true
  }

  /** 重做：从内存栈取 redo 快照 → 原地回滚（不重建预览）；无重做历史返回 false */
  redo(): boolean {
    const key = this._undoKey
    if (!key || !this.canRedo()) {
      logger.warn(`[BlueprintPreview] redo 无历史可重做: ${key ?? '无 key'}`)
      return false
    }
    const cur = this.collectSaveData() ?? this._lastCommitted
    const snap = UndoManager.redo(key, cur)
    if (snap == null) return false
    // 同 undo：基准与原地回滚输入必须分离（防同引用污染）
    this._lastCommitted = snap as Record<string, unknown>
    const applied = this._applySnapshotInPlace(JSON.parse(JSON.stringify(snap)) as Record<string, unknown>)
    if (!applied) {
      logger.info(`[BlueprintPreview] redo 结构变更 → 重建预览: ${key}`)
      BlueprintRegistry.loadFromJson(key, snap as unknown as BlueprintAsset)
      this.loadBlueprint(key, this._currentBlueprintDiskPath ?? undefined)
    }
    void this.syncWorkingCopy()
    logger.info(`[BlueprintPreview] redo: ${key}（redo 栈 ${UndoManager.depth(key).redo}）`)
    return true
  }

  /** 把预览当前内存态同步进服务层工作副本（不写盘、不产生撤销点、不 bump） */
  private async syncWorkingCopy(): Promise<void> {
    const diskPath = this._currentBlueprintDiskPath
    if (!diskPath) return
    const data = this.collectSaveData()
    if (!data) return
    await BlueprintEditorService.updateFromPreview(diskPath, data as unknown as BlueprintAsset)
  }

  // ════════════════════════════════════════
  //  大纲右键结构编辑（按 Actor 引用定位父节点，复用快照撤销 + bump 重建预览）
  // ════════════════════════════════════════

  /**
   * 在目标节点下添加子 Actor（追加到其 children 末尾）。
   * parentActor 为根节点/代码生成节点 → 追加到根 children 末尾。
   * 直接按 Actor 引用定位 JSON 节点（不走 name/id 二次定位，同名节点不拦截）。
   * 返回新节点名；失败返回 null。一个撤销点 + bump 重建 + 自动选中新节点。
   */
  async addChildNode(
    parentActor: Actor | null,
    def: { baseName: string; baseClass: string; components: BlueprintComponentDef[]; children?: BlueprintChildDef[] },
  ): Promise<string | null> {
    if (!this._jsonTree) {
      logger.warn(`[BlueprintPreview] addChildNode 跳过（_jsonTree 为空）`)
      return null
    }
    // 父节点 JSON 引用：根/代码生成节点 → null（追加到根 children 末尾）
    const parentNode = parentActor ? this._actorJsonMap?.get(parentActor) ?? null : null
    const siblings: string[] = []
    if (parentNode) {
      for (const c of (parentNode.children as Array<Record<string, unknown>> | undefined) ?? []) {
        const n = (c as { name?: string }).name
        if (n) siblings.push(n)
      }
    } else {
      for (const c of ((this._jsonTree.children as Array<Record<string, unknown>> | undefined) ?? [])) {
        const n = (c as { name?: string }).name
        if (n) siblings.push(n)
      }
    }
    const name = uniqueNodeName(def.baseName, siblings)
    // 全资产唯一 id：新节点自身 + 模板子节点（如按钮的 Frame）递归分配
    let idGen = nextChildId(this._jsonTree.children as BlueprintChildDef[] | undefined)
    const assignIds = (defs: BlueprintChildDef[] | undefined): void => {
      if (!defs) return
      for (const d of defs) {
        d.id = idGen++
        assignIds(d.children)
      }
    }
    const child: BlueprintChildDef = {
      name,
      baseClass: def.baseClass,
      id: idGen++,
      components: JSON.parse(JSON.stringify(def.components)) as BlueprintComponentDef[],
    }
    if (def.children?.length) {
      child.children = JSON.parse(JSON.stringify(def.children)) as BlueprintChildDef[]
      assignIds(child.children)
    }
    if (parentNode) {
      const children = (Array.isArray(parentNode.children) ? parentNode.children.slice() : []) as Array<Record<string, unknown>>
      children.push(child as unknown as Record<string, unknown>)
      parentNode.children = children
    } else {
      const children = (Array.isArray(this._jsonTree.children) ? this._jsonTree.children.slice() : []) as Array<Record<string, unknown>>
      children.push(child as unknown as Record<string, unknown>)
      this._jsonTree.children = children
    }
    await this.commitStructureEdit(name)
    logger.info(`[BlueprintPreview] 添加子节点: ${parentNode ? (parentNode as { name?: string }).name ?? '?' : '(根)'} → ${name}（子节点 ${child.children?.length ?? 0} 个）`)
    return name
  }

  /** 删除节点（按 Actor 引用定位，无确认，删除后清空选中）。一个撤销点。 */
  async removeChildNode(actor: Actor): Promise<boolean> {
    const node = this._actorJsonMap?.get(actor)
    if (!node) {
      logger.warn(`[BlueprintPreview] removeChildNode 跳过（节点无 JSON 映射）: ${actor.name}`)
      return false
    }
    if (!this._removeJsonChild(node)) {
      logger.warn(`[BlueprintPreview] removeChildNode 跳过（找不到父数组）: ${actor.name}`)
      return false
    }
    await this.commitStructureEdit(null)
    logger.info(`[BlueprintPreview] 删除子节点: ${(node as { name?: string }).name ?? '?'}`)
    return true
  }

  /** 深拷贝节点到其父 children 末尾（根 → 根 children 末尾），名称自动加序号。返回新节点名。 */
  async duplicateChildNode(actor: Actor): Promise<string | null> {
    const node = this._actorJsonMap?.get(actor)
    if (!node) {
      logger.warn(`[BlueprintPreview] duplicateChildNode 跳过（节点无 JSON 映射）: ${actor.name}`)
      return null
    }
    const parentArr = this._parentChildrenArray(node)
    if (!parentArr) return null
    const clone = JSON.parse(JSON.stringify(node)) as Record<string, unknown>
    const siblings = parentArr.map((o) => (o as { name?: string }).name).filter((n): n is string => !!n)
    const newName = uniqueNodeName(((node as { name?: string }).name) || 'Copy', siblings)
    clone.name = newName
    // id 重分配（全资产唯一）；组件 id 清除
    let idGen = nextChildId(this._jsonTree?.children as BlueprintChildDef[] | undefined)
    reassignChildIds(clone as unknown as BlueprintChildDef, () => idGen++)
    parentArr.push(clone)
    await this.commitStructureEdit(newName)
    logger.info(`[BlueprintPreview] 复制子节点: ${(node as { name?: string }).name ?? '?'} → ${newName}`)
    return newName
  }

  /** 重命名节点（按 Actor 引用定位，同父重名自动追加序号）。返回是否成功。 */
  async renameChildNode(actor: Actor, newName: string): Promise<boolean> {
    const node = this._actorJsonMap?.get(actor)
    if (!node) {
      logger.warn(`[BlueprintPreview] renameChildNode 跳过（节点无 JSON 映射）: ${actor.name}`)
      return false
    }
    const parentArr = this._parentChildrenArray(node)
    if (!parentArr) return false
    const siblings = parentArr
      .filter((o) => o !== node)
      .map((o) => (o as { name?: string }).name)
      .filter((n): n is string => !!n)
    const finalName = uniqueNodeName(newName, siblings)
    node.name = finalName
    await this.commitStructureEdit(finalName)
    logger.info(`[BlueprintPreview] 重命名子节点: ${(node as { name?: string }).name ?? '?'} → ${finalName}`)
    return true
  }

  /** 返回节点所在的 children 数组（根 → 根 children；找不到返回 null） */
  private _parentChildrenArray(node: Record<string, unknown>): Array<Record<string, unknown>> | null {
    if (!this._jsonTree) return null
    const rootChildren = (this._jsonTree.children as Array<Record<string, unknown>> | undefined) ?? []
    if (rootChildren.includes(node)) return rootChildren
    const find = (arr: Array<Record<string, unknown>>): Array<Record<string, unknown>> | null => {
      for (const c of arr) {
        const children = (c.children as Array<Record<string, unknown>> | undefined) ?? []
        if (children.includes(node)) return children
        const hit = find(children)
        if (hit) return hit
      }
      return null
    }
    return find(rootChildren)
  }

  /** 从所在 children 数组移除节点（返回是否找到并移除） */
  private _removeJsonChild(node: Record<string, unknown>): boolean {
    const arr = this._parentChildrenArray(node)
    if (!arr) return false
    const idx = arr.indexOf(node)
    if (idx < 0) return false
    arr.splice(idx, 1)
    return true
  }

  /**
   * 结构编辑提交：收集当前状态 → 对比基准 push 撤销点 → 同步服务层工作副本
   * （不写盘、不 bump 前撤销按钮刷新由 bump 触发）→ bump 重建预览。
   * @param selectName 重建后要选中的节点名（null = 不选中；bump 后 BlueprintEditor 消费）
   */
  private async commitStructureEdit(selectName: string | null): Promise<void> {
    const key = this._undoKey
    if (!key) {
      logger.warn(`[BlueprintPreview] 结构编辑提交跳过（无撤销 key，activate 未调用）`)
      return
    }
    const data = this.collectSaveData()
    if (!data) return
    if (this._lastCommitted === null) {
      this._lastCommitted = JSON.parse(JSON.stringify(data))
      logger.info(`[BlueprintPreview] 结构编辑（首帧基准）: ${key}`)
    } else if (JSON.stringify(data) === JSON.stringify(this._lastCommitted)) {
      logger.info(`[BlueprintPreview] 结构编辑提交跳过（内容无变化）: ${key}`)
      return
    } else {
      UndoManager.push(key, this._lastCommitted)
      this._lastCommitted = JSON.parse(JSON.stringify(data))
      logger.info(`[BlueprintPreview] 结构编辑提交（= 一个撤销点）: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
    }
    const diskPath = this._currentBlueprintDiskPath
    if (diskPath) {
      // 同步服务层工作副本（注册表随之更新）→ bump 触发 BlueprintEditor 重建预览并消费选中
      await BlueprintEditorService.updateFromPreview(diskPath, data as unknown as BlueprintAsset)
      if (selectName) AssetPreviewManager.setPendingSelection(diskPath, selectName)
      useEditorStore.getState().bumpBlueprintEdit(diskPath)
    }
    editorBus.emit(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, diskPath ?? '')
  }

  /**
   * 原地回滚（纯内存，唯一应用路径）：把快照 diff 逐个应用到现有 actor
   * （不销毁、不重建，actor 引用保持 → 选中/gizmo/相机零丢失）。
   *  - 遍历 _actorJsonMap（actor → JSON 节点），按节点名在快照树里找对应节点
   *  - 组件可编辑属性：按 persistType 找快照组件，遍历 getEditableProperties() set 回写
   *  - transform：写回 position/rotation/scale（组件 TransformComponent/UITransformComponent properties 优先）
   *  - 结构不一致（节点数/节点名对不上，当前场景仅 transform/属性编辑不会触发）→ 警告，不重建
   */
  private _applySnapshotInPlace(snap: Record<string, unknown>): boolean {
    const entries = Array.from(this._actorJsonMap?.entries() ?? [])
    // 结构一致性检查：节点数一致且每个 map 节点名都能在快照树中找到唯一对应
    const snapByName = new Map<string, Record<string, unknown>>()
    const walkSnap = (node: Record<string, unknown>): boolean => {
      const name = node.name as string | undefined
      if (name) {
        if (snapByName.has(name)) return false
        snapByName.set(name, node)
      }
      const children = (node.children as Array<Record<string, unknown>> | undefined) ?? []
      for (const c of children) {
        if (!walkSnap(c)) return false
      }
      return true
    }
    if (!walkSnap(snap)) {
      logger.warn(`[BlueprintPreview] 原地回滚跳过（快照节点名缺失/重复）`)
      return false
    }
    // 每个 map 节点名必须能在快照中找到唯一对应（结构与 map 一致时才回滚）
    for (const [, node] of entries) {
      const name = (node as { name?: string }).name
      if (!name || !snapByName.has(name)) {
        logger.warn(`[BlueprintPreview] 原地回滚跳过（节点 "${name}" 在快照中缺失）`)
        return false
      }
    }
    // 逐个应用
    for (const [actor, node] of entries) {
      const jsonNode = snapByName.get((node as { name?: string }).name as string)!

      // ─── 组件可编辑属性回写：按 persistType 找快照组件，set 回写（Inspector 直改的镜像） ───
      const jsonComps = (jsonNode.components as Array<Record<string, unknown>> | undefined) ?? []
      for (const comp of actor.getAllComponents() as ActorComponent[]) {
        if (!comp.persistType) continue
        // 运行时自动生成的内部组件（透明点击层）不参与回滚
        if ((comp as unknown as { isClickOnly?: boolean }).isClickOnly) continue
        const target = jsonComps.find((c) => (c.baseClass as string | undefined) === comp.persistType)
        if (!target) continue
        const props = (target.properties ?? {}) as Record<string, unknown>
        for (const p of comp.getEditableProperties()) {
          if (p.key in props && !p.readonly) {
            try {
              p.set(props[p.key] as never)
            } catch (e) {
              logger.warn(`[BlueprintPreview] 原地回滚属性失败 ${comp.persistType}.${p.key}: ${e}`)
            }
          }
        }
      }

      // ─── transform 回写：组件 TransformComponent/UITransformComponent properties 优先，否则顶层 position/rotation/scale ───
      const tf = jsonComps.find(
        (c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent',
      )
      const tfProps = (tf?.properties ?? {}) as Record<string, unknown>
      if (tfProps.position) {
        const pos = tfProps.position as number[]
        actor.setPosition(pos[0], pos[1], pos[2])
        const rot = tfProps.rotation as number[] | undefined
        if (rot) actor.setRotation(rot[0], rot[1], rot[2])
        const scale = tfProps.scale as number[] | undefined
        if (scale) actor.setScale(scale[0], scale[1], scale[2])
      } else if (Array.isArray(jsonNode.position)) {
        const pos = jsonNode.position as number[]
        actor.setPosition(pos[0], pos[1], pos[2])
        if (Array.isArray(jsonNode.rotation)) actor.setRotation((jsonNode.rotation as number[])[0], (jsonNode.rotation as number[])[1], (jsonNode.rotation as number[])[2])
        if (Array.isArray(jsonNode.scale)) actor.setScale((jsonNode.scale as number[])[0], (jsonNode.scale as number[])[1], (jsonNode.scale as number[])[2])
      } else if (Array.isArray(jsonNode.pos)) {
        // 旧格式：只回写 pos
        const pos = jsonNode.pos as number[]
        actor.setPosition(pos[0], pos[1], pos[2])
      }
    }
    // 同步工作副本：_jsonTree 与快照分离深拷贝（防后续 collectSaveData 原地写回污染基准）
    this._jsonTree = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>
    this._rebindJsonMap()
    // gizmo 坐标轴强制刷新（hidden 页 rAF 停摆时 matrixWorld 陈旧）：重算矩阵 + 重新同步 + 立即渲染一帧
    this.scene.updateMatrixWorld(true)
    if (this.gizmo.visible) this.gizmo.syncTransform()
    this.renderer.render(this.scene, this.camera)
    logger.info(`[BlueprintPreview] 原地回滚完成: ${this._undoKey}（${entries.length} 个节点）`)
    return true
  }

  /**
   * _jsonTree 被深拷贝替换后，把 _actorJsonMap 节点重新指向新树中的同名单节点。
   * 否则后续 collectSaveData 的写回仍落在旧对象上，导致拖拽/属性改动被判定为
   * "内容无变化"而不进撤销栈（第一次提交后所有编辑都会失效）。
   */
  private _rebindJsonMap(): void {
    if (!this._jsonTree || !this._actorJsonMap) {
      logger.warn(`[BlueprintPreview] _rebindJsonMap 跳过（_jsonTree/_actorJsonMap 为空）`)
      return
    }
    let rebound = 0
    let missing = 0
    for (const [actor, node] of this._actorJsonMap) {
      const name = (node as { name?: string }).name
      if (!name) continue
      const fresh = this._findNodeByName(this._jsonTree, name)
      if (fresh) {
        this._actorJsonMap.set(actor, fresh)
        rebound++
      } else {
        missing++
      }
    }
    logger.info(`[BlueprintPreview] _rebindJsonMap: 重绑 ${rebound} 个节点, 未找到 ${missing} 个`)
  }

  /** 在 JSON 树中按节点名查找（递归 children；name 唯一，找到即返回） */
  private _findNodeByName(node: Record<string, unknown>, name: string): Record<string, unknown> | null {
    if ((node as { name?: string }).name === name) return node
    const children = (node.children as Array<Record<string, unknown>> | undefined) ?? []
    for (const c of children) {
      const hit = this._findNodeByName(c, name)
      if (hit) return hit
    }
    return null
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
      // 上下文丢失期间跳过渲染，避免对失效 GL 上下文上传纹理报错
      if (this.contextLost) {
        this.animationId = requestAnimationFrame(animate)
        return
      }
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      this.updateWASD(dt)
      if (this.gizmo.visible) this.gizmo.syncTransform()
      // 碰撞盒线框（预览 World 组件属性解析；V 键开关）
      this.colliderDrawer?.update(getAllActors(this.world))
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
    this.gizmo.dispose()
    // 碰撞盒线框绘制器：移除线框对象 + 释放几何/材质
    this.colliderDrawer?.dispose()
    this.colliderDrawer = null
    // 彻底销毁预览 World（含 UIManager/ActorManagerComponent 三件套自身的 reclaimForWorld），
    // 避免 tab 切换/工程切换累积泄漏 11+ 个 World 三件套（编辑器 lifetime 内只有一份 World）。
    // clearPreview 走 DestroyAllActors 是容器复用语义（保留 World 实例）；这是 manager 终局销毁。
    this.world.Destroy()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this._actorJsonMap = null
    this._jsonTree = null
    this.previewRoot = null
    this._actorTreeCache = null
    this._currentBlueprintKey = null
    this._currentBlueprintDiskPath = null
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
    if (assetPath) {
      this._undoKey = diskPathToAssetKey(assetPath)
      // 首次激活：建立撤回基准（加载后的未编辑状态）。基准必须是独立深拷贝，
      // 不能直接引用 _jsonTree（collectSaveData 会原地写回污染它）。
      const base = this.collectSaveData()
      if (this._lastCommitted === null && base) {
        this._lastCommitted = JSON.parse(JSON.stringify(base))
        logger.info(`[BlueprintPreview] 撤回基准建立: ${this._undoKey}`)
      }
      AssetPreviewManager.setActive(assetPath)
    }
    this.notifyChange()
    notifySelectionChange()
  }

  focusActor(actor: Actor) {
    this.selectActor(actor)
    this.fitToActor(actor.root)
  }

  /** 按名称查找并聚焦（供 BlueprintTreeView 回落使用） */
  focusOnActor(actorName: string): boolean {
    const allActors = getAllActors(this.world)
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
