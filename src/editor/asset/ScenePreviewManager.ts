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
 *  - 通过 loadScene 归集场景节点，ref/actor 节点实例化为 Actor（预览经 PreviewObjectFactoryComponent）
 *  - 自动清理（dispose）
 */
import * as THREE from 'three'
import { World, ActorComponent, EditorActorComponent } from '../../engine'
import { PreviewObjectFactoryComponent } from '../../engine'
import { logger } from '../../engine'
import { loadScene } from '../../engine'
import { GenericActor, Actor } from '../../engine'
import { LightComponent } from '../../engine'
import type { LightComponentOptions } from '../../engine'
import type { SceneAsset } from '../../engine'
import type { BlueprintChildDef } from '../../engine'
import { select, notifySelectionChange } from '../SelectionManager'
import { TransformGizmo } from '../TransformGizmo'
import { AssetPreviewManager } from './AssetPreviewManager'
import { UndoManager } from '../blueprintEdit/UndoManager'
import { uniqueNodeName, cloneTemplateComponents } from '../blueprintEdit/nodeTemplates'
import type { NodeTemplate } from '../blueprintEdit/nodeTemplates'
import { editorBus } from '../EditorEvents'
import { EditorEvent } from '../EditorEventNames'

/** 磁盘路径（src/projects/...）→ 撤销栈 key（asset/...），与蓝图/UI 资产同粒度 */
function diskPathToAssetKey(diskPath: string): string {
  const idx = diskPath.indexOf('/asset/')
  return idx >= 0 ? diskPath.slice(idx + 1) : diskPath
}

export class ScenePreviewManager {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly world: World
  readonly gizmo: TransformGizmo
  /** 预览对象工厂（编辑器预览独立 THREE 创建器，无 GameInstance 依赖；EndPlay 统一释放） */
  readonly previewFactory: PreviewObjectFactoryComponent

  private container: HTMLElement
  private animationId: number | null = null
  private lastTime = 0
  private _currentScenePath: string | null = null

  // ─── 场景数据（编辑用） ───
  private _sceneAsset: SceneAsset | null = null
  private _actorTreeCache: SceneTreeNode[] | null = null
  /** Actor → 场景 JSON 节点映射（loadSceneAsset 构建；ref 实例名 ≠ 场景节点名，名称匹配会失败） */
  private _actorJsonMap = new Map<Actor, Record<string, unknown>>()
  /** Actor → JSON 节点路径（从 objects 顶层开始的 name 链，供嵌套定位/重绑/原地回滚） */
  private _actorJsonPath = new Map<Actor, string[]>()

  // ─── 撤回系统（与蓝图/UI 资产预览同语义：拖拽松手 = 一个撤销点，不写盘） ───
  /** 撤销栈 key（asset/...，由资产磁盘路径推导）；activate 时建立 */
  private _undoKey: string | null = null
  /** 最后一次已提交（= 进入撤销栈）的场景快照；null = 尚未建立基准（首次加载/保存后由外部刷新） */
  private _lastCommitted: Record<string, unknown> | null = null

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

    // ─── World（EditorActorComponent 由 World 构造时自动添加）───
    // 必须先建 World：SceneComponent 持有 actor 挂载场景，预览场景直接复用 world.scene，
    // 保证渲染/大纲遍历与 actor 挂载在同一个 THREE.Scene（否则大纲看不到节点、预览渲染为空）
    this.world = new World()

    // ─── 预览对象工厂：编辑器预览独立 THREE 创建器（不依赖 GameInstance）───
    // 组件工厂（Mesh 组件等）经 ThreeObjectUtils 自动分流到本工厂，对象由本组件追踪，
    // World.Destroy → EndPlay 统一释放。每次 spawn 前置位 setCurrent（见 loadSceneAsset）。
    this.previewFactory = this.world.addComponent(PreviewObjectFactoryComponent)
    PreviewObjectFactoryComponent.setCurrent(this.previewFactory)

    // ─── 场景（复用 World 的 SceneComponent 场景：actor 挂载点 = 渲染场景 = 大纲遍历场景）───
    this.scene = this.world.scene
    this.scene.background = new THREE.Color(0x1a1a2e)

    // ─── 摄像机 ───
    const aspect = w / h
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
    // 用 world.Spawn 挂载（带生命周期；与场景内 actor 一致）
    const makeLightActor = (name: string, options: LightComponentOptions) => {
      const actor = new GenericActor(name)
      actor.addComponent(LightComponent, options)
      this.world.getComponent(EditorActorComponent)!.Spawn(actor)
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
    // 本次 spawn 全程使用本管理器的预览工厂（多页签并发时覆盖 current）
    PreviewObjectFactoryComponent.setCurrent(this.previewFactory)
    this.clearPreview()
    this._sceneAsset = sceneData

    const result = loadScene(sceneData)

    // 场景根 Actor
    const rootActor = new GenericActor(sceneData.name)
    this.world.getComponent(EditorActorComponent)!.Spawn(rootActor)

    // ref 节点 → Instantiate（标记为整体，实例级 children 递归挂载）
    for (const rn of (result.refNodes ?? [])) {
      const overrides: Record<string, unknown> = { ...(rn.overrides ?? {}) }
      overrides.position = rn.position
      overrides.rotation = rn.rotation
      overrides.scale = rn.scale
      const actor = this.world.getComponent(EditorActorComponent)!.Instantiate(rn.ref, overrides, rn.components)
      if (actor) {
        actor.isRefInstance = true
        actor.attachTo(rootActor)
        // refNodes 是 loadScene 新建对象（非原引用），按 name 反查 objects 原始节点建立映射
        const jsonNode = (sceneData.objects ?? []).find((o) => o.name === rn.name)
        if (jsonNode) {
          this._actorJsonMap.set(actor, jsonNode as unknown as Record<string, unknown>)
          if (rn.name) this._actorJsonPath.set(actor, [rn.name])
          // 实例级子对象：递归 spawn，经 onSpawn 回调按深度优先先序构建精确映射
          if (rn.children?.length) {
            const pathStack: string[] = rn.name ? [rn.name] : []
            this.world.spawnSceneChildren(rn.children, actor, (def, childActor, depth) => {
              this.bindSpawnedChild(def, childActor, pathStack, depth)
            })
          }
        }
      }
    }

    // 内联 Actor 节点 → spawnInlineActor（含递归子级，onSpawn 构建嵌套映射）
    for (const an of (result.actorNodes ?? [])) {
      const pathStack: string[] = an.name ? [an.name] : []
      const actor = this.world.spawnInlineActor(an, (def, childActor, depth) => {
        this.bindSpawnedChild(def, childActor, pathStack, depth)
      })
      if (actor) {
        actor.attachTo(rootActor)
        // actorNodes 是 objects 原始引用，直接建映射
        this._actorJsonMap.set(actor, an as unknown as Record<string, unknown>)
        if (an.name) this._actorJsonPath.set(actor, [an.name])
      }
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
    this.fitToScene()

    // 通知 UI 刷新（Outline 依赖 selectionKey 重建树）
    logger.debug(`[OutlinerTrace] loadSceneAsset 完成, 调用 notifySelectionChange, currentScenePath=${this._currentScenePath}, actorCount=${this.world.actorCount}`)
    notifySelectionChange()

    const actorCount = this.world.actorCount
    logger.info(`[ScenePreview] 加载场景预览: ${sceneData.name}, ${actorCount} 个 Actor（ref=${(result.refNodes ?? []).length}, actor=${(result.actorNodes ?? []).length}）`)
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
    this._actorJsonMap.clear()
    this._actorJsonPath.clear()
    this.notifyChange()
    logger.debug(`[OutlinerTrace] clearPreview 完成, currentScenePath=${this._currentScenePath}, actorCount=${this.world.actorCount}`)
  }

  /**
   * spawnInlineChildren/spawnSceneChildren 的 onSpawn 回调：
   * 维护路径栈（深度优先先序，栈即祖先链）并登记 Actor→JSON 节点 + 路径映射。
   */
  private bindSpawnedChild(
    def: BlueprintChildDef,
    actor: Actor,
    pathStack: string[],
    depth: number,
  ): void {
    if (!def.name) return
    // 截断到 [顶层名, ...depth 级祖先]，再压入当前节点名
    pathStack.length = depth + 1
    pathStack.push(def.name)
    this._actorJsonMap.set(actor, def as unknown as Record<string, unknown>)
    this._actorJsonPath.set(actor, [...pathStack])
  }

  /** 按 spawn 后的 Actor 集合计算包围盒并聚焦相机（loadScene 不再产出 mesh，group 为空壳） */
  private fitToScene() {
    const box = new THREE.Box3()
    for (const actor of this.world.actorMgr.GetAllActors()) {
      box.expandByObject(actor.root)
    }
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

  /** 该 Actor 是否对应场景 JSON 中的节点（false = 根/代码生成节点，无法做资产级结构编辑） */
  hasJsonNode(actor: Actor): boolean {
    return this._actorJsonMap.has(actor)
  }

  /**
   * 将本实例登记为全局活动实例（供 Outline/Inspector 读取），并通知 UI 刷新。
   * 首次激活时建立撤销栈 key，并以当前场景状态为撤回基准（之后拖拽松手 push 的
   * 动作前快照都以此为基准）。
   */
  activate(assetPath?: string): void {
    logger.debug(`[OutlinerTrace] activate(${assetPath}) → _currentScenePath=${assetPath}, 调用 notifySelectionChange`)
    if (assetPath) {
      this._currentScenePath = assetPath
      this._undoKey = diskPathToAssetKey(assetPath)
      // 首次激活：建立撤回基准（加载后的未编辑状态）。注意基准必须是独立深拷贝，
      // 不能直接引用 _sceneAsset（collectSaveData 会原地写回污染它）。
      const base = this.collectSaveData()
      if (this._lastCommitted === null && base) {
        this._lastCommitted = JSON.parse(JSON.stringify(base))
        logger.info(`[ScenePreview] 撤回基准建立: ${this._undoKey}`)
      }
      AssetPreviewManager.setActive(assetPath)
    }
    this.notifyChange()
    notifySelectionChange()
  }

  // ════════════════════════════════════════
  //  撤回系统（拖拽松手提交 / undo / redo，与蓝图/UI 资产预览一致）
  // ════════════════════════════════════════

  /** 撤销/重做按钮可用状态 */
  canUndo(): boolean {
    return this._undoKey !== null && UndoManager.canUndo(this._undoKey)
  }

  canRedo(): boolean {
    return this._undoKey !== null && UndoManager.canRedo(this._undoKey)
  }

  /**
   * 拖拽松手后调用：把本次编辑结果作为"当前已提交状态"。
   *  - 对比基准（_lastCommitted）：内容有变化 → 把基准作为动作前快照 push 进撤销栈，
   *    再更新基准为当前状态；无变化（未拖动/拖回原位）→ 不产生撤销点
   *  - 更新 _sceneAsset 工作副本（后续 collectSaveData 基于最新状态）
   *  - 不写盘（保存按钮才落盘）
   */
  commitPreviewEdit(): void {
    const key = this._undoKey
    if (!key) {
      logger.warn(`[ScenePreview] 拖拽提交跳过（无撤销 key，activate 未调用）`)
      return
    }
    const cur = this.collectSaveData()
    if (!cur) {
      logger.warn(`[ScenePreview] 拖拽提交跳过（collectSaveData 返回 null）: ${key}`)
      return
    }
    if (this._lastCommitted === null) {
      // 无基准（理论上 activate 已建立）：以当前为基准（独立拷贝），不产生撤销点
      this._lastCommitted = JSON.parse(JSON.stringify(cur))
      logger.info(`[ScenePreview] 拖拽提交（首帧基准）: ${key}`)
      return
    }
    // 内容无变化（拖动后松手位置与基准一致）→ 跳过，避免空撤销点
    if (JSON.stringify(cur) === JSON.stringify(this._lastCommitted)) {
      logger.info(`[ScenePreview] 拖拽提交跳过（内容无变化）: ${key}`)
      return
    }
    UndoManager.push(key, this._lastCommitted)
    // 注意：cur 与 _sceneAsset 必须是两个对象——collectSaveData 会把实时 transform
    // 原地写回 _sceneAsset 的 JSON 节点，若基准(_lastCommitted)与 _sceneAsset 同引用，
    // 下次编辑时基准被污染，对比恒"无变化"，第二次起所有编辑都进不了撤销栈。
    this._lastCommitted = JSON.parse(JSON.stringify(cur))
    this._sceneAsset = cur as unknown as SceneAsset
    this._rebindJsonMap()
    logger.info(`[ScenePreview] 松手提交（= 一个撤销点）: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
  }

  /**
   * 保存成功后调用：内存/磁盘已一致，把保存的数据作为新基准
   * （之后拖拽 push 的动作前快照 = 保存后的状态，撤销点干净）。
   */
  markCommitted(data: Record<string, unknown>): void {
    // 基准独立深拷贝（防与 _sceneAsset 同引用被后续写回污染，语义同 commitPreviewEdit）
    this._lastCommitted = JSON.parse(JSON.stringify(data))
    this._sceneAsset = JSON.parse(JSON.stringify(data)) as unknown as SceneAsset
    this._rebindJsonMap()
  }

  /**
   * Inspector 直接修改属性后调用：运行时组件已被 prop.set 直改（预览即时反馈），
   * 此处把最新状态收集为"已提交状态"并进撤回系统。
   *  - 对比基准（_lastCommitted）：内容有变化 → 基准作为动作前快照 push 进撤销栈，
   *    再更新基准为当前状态；无变化（改回原值）→ 不产生撤销点
   *  - 不重建预览（运行时已生效）、不写盘；emit BLUEPRINT_TRANSFORM_DIRTY 刷新撤销按钮
   */
  commitPropertyEdit(): void {
    const key = this._undoKey
    if (!key) {
      logger.warn(`[ScenePreview] 属性提交跳过（无撤销 key，activate 未调用）`)
      return
    }
    const cur = this.collectSaveData()
    if (!cur) return
    if (this._lastCommitted === null) {
      this._lastCommitted = JSON.parse(JSON.stringify(cur))
      logger.info(`[ScenePreview] 属性提交（首帧基准）: ${key}`)
      return
    }
    if (JSON.stringify(cur) === JSON.stringify(this._lastCommitted)) {
      logger.debug(`[ScenePreview] 属性提交跳过（内容无变化）: ${key}`)
      return
    }
    UndoManager.push(key, this._lastCommitted)
    // 同 commitPreviewEdit：基准必须独立于 _sceneAsset（防原地写回污染基准）
    this._lastCommitted = JSON.parse(JSON.stringify(cur))
    this._sceneAsset = cur as unknown as SceneAsset
    this._rebindJsonMap()
    logger.info(`[ScenePreview] 属性提交（= 一个撤销点）: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
    // 双保险刷新撤销按钮可用状态（ScenePreviewEditor 监听该事件）
    editorBus.emit(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, this._currentScenePath ?? '')
  }

  /**
   * _sceneAsset 被深拷贝替换后，把 _actorJsonMap 节点重新指向新树中的同路径节点。
   * 否则后续 collectSaveData 的写回仍落在旧对象上，导致拖拽/属性改动被判定为
   * "内容无变化"而不进撤销栈（第一次提交后所有编辑都会失效）。
   * undo/redo 走 loadSceneAsset（clearPreview 清空 map 后重建），无需调用。
   */
  private _rebindJsonMap(): void {
    if (!this._sceneAsset) {
      logger.warn(`[ScenePreview] _rebindJsonMap 跳过（_sceneAsset 为空）`)
      return
    }
    const objs = (this._sceneAsset.objects ?? []) as unknown as Array<Record<string, unknown>>
    let rebound = 0
    let missing = 0
    for (const [actor, node] of this._actorJsonMap) {
      const path = this._actorJsonPath.get(actor)
      let fresh: Record<string, unknown> | null = null
      if (path && path.length) {
        fresh = this._findNodeByPath(objs, path)
      } else {
        const name = (node as { name?: string }).name
        if (name) fresh = objs.find((o) => (o as { name?: string }).name === name) ?? null
      }
      if (fresh) {
        this._actorJsonMap.set(actor, fresh)
        rebound++
      } else {
        missing++
      }
    }
    logger.info(`[ScenePreview] _rebindJsonMap: 重绑 ${rebound} 个节点, 未找到 ${missing} 个`)
  }

  /** 按 name 路径在 objects 树中递归定位节点（同父内 name 唯一） */
  private _findNodeByPath(
    objs: Array<Record<string, unknown>>,
    path: string[],
  ): Record<string, unknown> | null {
    let cur: Array<Record<string, unknown>> = objs
    for (let i = 0; i < path.length; i++) {
      const hit = cur.find((o) => (o as { name?: string }).name === path[i])
      if (!hit) return null
      if (i === path.length - 1) return hit
      cur = (hit.children as Array<Record<string, unknown>> | undefined) ?? []
    }
    return null
  }

  /** 撤销：从内存栈取动作前快照 → 原地回滚（不重建预览，actor 引用/选中/相机保持）；
   *  结构变更（增删节点/重命名）时原地回滚无法处理 → 全量重建预览。无可撤历史返回 false */
  undo(): boolean {
    const key = this._undoKey
    if (!key || !this.canUndo()) {
      logger.warn(`[ScenePreview] undo 无历史可撤: ${key ?? '无 key'}`)
      return false
    }
    const cur = this.collectSaveData() ?? this._lastCommitted
    const snap = UndoManager.undo(key, cur)
    if (snap == null) return false
    // snap 作为新基准；传入 _applySnapshotInPlace 的必须是深拷贝——原地回滚内部
    // 会把 _sceneAsset 指向深拷贝快照，若与基准同引用，下次 collectSaveData
    // 原地写回又会污染基准（undo → 新编辑 → 被判"无变化"不进栈的残余路径）。
    this._lastCommitted = snap as Record<string, unknown>
    const applied = this._applySnapshotInPlace(JSON.parse(JSON.stringify(snap)) as Record<string, unknown>)
    if (!applied) {
      // 结构变更：全量重建预览
      logger.info(`[ScenePreview] undo 结构变更 → 重建预览: ${key}`)
      this.reloadFromSnapshot(snap as Record<string, unknown>)
    }
    logger.info(`[ScenePreview] undo: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
    return true
  }

  /** 重做：从内存栈取 redo 快照 → 原地回滚（不重建预览）；结构变更时全量重建。无重做历史返回 false */
  redo(): boolean {
    const key = this._undoKey
    if (!key || !this.canRedo()) {
      logger.warn(`[ScenePreview] redo 无历史可重做: ${key ?? '无 key'}`)
      return false
    }
    const cur = this.collectSaveData() ?? this._lastCommitted
    const snap = UndoManager.redo(key, cur)
    if (snap == null) return false
    // 同 undo：基准与原地回滚输入必须分离（防同引用污染）
    this._lastCommitted = snap as Record<string, unknown>
    const applied = this._applySnapshotInPlace(JSON.parse(JSON.stringify(snap)) as Record<string, unknown>)
    if (!applied) {
      logger.info(`[ScenePreview] redo 结构变更 → 重建预览: ${key}`)
      this.reloadFromSnapshot(snap as Record<string, unknown>)
    }
    logger.info(`[ScenePreview] redo: ${key}（redo 栈 ${UndoManager.depth(key).redo}）`)
    return true
  }

  /** 结构变更时的快照应用路径：全量重建预览（快照独立深拷贝防与基准同引用） */
  private reloadFromSnapshot(snap: Record<string, unknown>): void {
    const path = this._currentScenePath
    this.loadSceneAsset(JSON.parse(JSON.stringify(snap)) as unknown as SceneAsset)
    if (path) this.activate(path)
  }

  /**
   * 原地回滚（纯内存）：把快照 diff 逐个应用到现有 actor
   * （不销毁、不重建，actor 引用保持 → 选中/gizmo/相机零丢失）。
   *  - 遍历 _actorJsonMap（actor → JSON 节点），按路径在快照 objects 树里定位对应节点
   *  - 组件可编辑属性：按 persistType 找快照组件，遍历 getEditableProperties() set 回写
   *  - transform：写回 position/rotation/scale（组件 TransformComponent properties 优先）
   *  - 结构不一致（节点数/路径对不上，如增删节点）→ 返回 false，由调用方全量重建
   */
  private _applySnapshotInPlace(snap: Record<string, unknown>): boolean {
    const snapObjs = ((snap as { objects?: unknown[] }).objects ?? []) as Array<Record<string, unknown>>
    const entries = Array.from(this._actorJsonMap.entries())
    // 结构一致性检查：节点总数一致
    if (this.countJsonNodes(snapObjs) !== entries.length) {
      logger.warn(`[ScenePreview] 原地回滚跳过（节点数不一致 ${entries.length}→${this.countJsonNodes(snapObjs)}，结构变更需重建）`)
      return false
    }
    // 逐个定位（按路径），全部可定位才回滚
    const applied: Array<{ actor: Actor; jsonNode: Record<string, unknown> }> = []
    for (const [actor, node] of entries) {
      const path = this._actorJsonPath.get(actor)
      let jsonNode: Record<string, unknown> | null = null
      if (path && path.length) {
        jsonNode = this._findNodeByPath(snapObjs, path)
      } else {
        const name = (node as { name?: string }).name
        if (name) {
          const matches = snapObjs.filter((o) => (o as { name?: string }).name === name)
          if (matches.length === 1) jsonNode = matches[0]
        }
      }
      if (!jsonNode) {
        logger.warn(`[ScenePreview] 原地回滚跳过（节点 "${(node as { name?: string }).name ?? '?'}" 在快照中缺失）`)
        return false
      }
      applied.push({ actor, jsonNode })
    }
    // 逐个应用
    for (const { actor, jsonNode } of applied) {

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
              logger.warn(`[ScenePreview] 原地回滚属性失败 ${comp.persistType}.${p.key}: ${e}`)
            }
          }
        }
      }

      // ─── transform 回写：组件 TransformComponent properties 优先，否则顶层 position/rotation/scale ───
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
    // 同步工作副本：_sceneAsset 与快照分离深拷贝（防后续 collectSaveData 原地写回污染基准）
    this._sceneAsset = JSON.parse(JSON.stringify(snap)) as unknown as SceneAsset
    this._rebindJsonMap()
    // gizmo 坐标轴强制刷新（hidden 页 rAF 停摆时 matrixWorld 陈旧）：重算矩阵 + 重新同步 + 立即渲染一帧
    this.scene.updateMatrixWorld(true)
    if (this.gizmo.visible) this.gizmo.syncTransform()
    this.renderer.render(this.scene, this.camera)
    logger.info(`[ScenePreview] 原地回滚完成: ${this._undoKey}（${entries.length} 个节点）`)
    return true
  }

  /** 递归统计 objects 树节点总数（结构一致性检查用） */
  private countJsonNodes(objs: Array<Record<string, unknown>>): number {
    let n = 0
    const walk = (arr: Array<Record<string, unknown>>) => {
      for (const o of arr) {
        n++
        const children = (o as { children?: unknown }).children as Array<Record<string, unknown>> | undefined
        if (children?.length) walk(children)
      }
    }
    walk(objs)
    return n
  }

  // ════════════════════════════════════════
  //  大纲右键结构编辑（添加/删除/复制/重命名，复用快照撤销 + 全量重建预览）
  // ════════════════════════════════════════

  /**
   * 在目标节点下添加预定义模板节点（追加到其 children 末尾；
   * targetActor 为根/无映射 → 追加到顶层 objects 末尾）。
   * 返回新节点名；失败返回 null。一个撤销点 + 预览重建 + 自动选中新节点。
   */
  addSceneObject(targetActor: Actor | null, tpl: NodeTemplate): string | null {
    if (!this._sceneAsset) {
      logger.warn('[ScenePreview] addSceneObject 跳过（_sceneAsset 为空）')
      return null
    }
    const targetNode = targetActor ? this._actorJsonMap.get(targetActor) : null
    const siblings: string[] = []
    if (targetNode) {
      for (const c of (targetNode.children as Array<Record<string, unknown>> | undefined) ?? []) {
        const n = (c as { name?: string }).name
        if (n) siblings.push(n)
      }
    } else {
      for (const o of this._sceneAsset.objects) {
        const n = (o as { name?: string }).name
        if (n) siblings.push(n)
      }
    }
    const name = uniqueNodeName(tpl.baseName, siblings)
    const node: Record<string, unknown> = {
      type: 'actor',
      name,
      baseClass: tpl.baseClass,
      components: cloneTemplateComponents(tpl),
    }
    // 模板子节点（如按钮的 Frame 视觉）——场景子对象不强制 id（lint 同父唯一即合法）
    if (tpl.children?.length) {
      node.children = JSON.parse(JSON.stringify(tpl.children))
    }
    if (targetNode) {
      const children = (Array.isArray(targetNode.children) ? targetNode.children.slice() : []) as Array<Record<string, unknown>>
      children.push(node)
      targetNode.children = children
    } else {
      this._sceneAsset.objects.push(node as never)
    }
    this.commitStructuralEdit(name)
    logger.info(`[ScenePreview] 添加场景对象: ${name}（${tpl.label}，子对象 ${(node.children as unknown[] | undefined)?.length ?? 0} 个）`)
    return name
  }

  /** 删除节点（顶层或嵌套；无确认，删除后清空选中）。一个撤销点。 */
  removeSceneObject(actor: Actor): boolean {
    const node = this._actorJsonMap.get(actor)
    if (!node) {
      logger.warn(`[ScenePreview] removeSceneObject 跳过（节点无 JSON 映射）: ${actor.name}`)
      return false
    }
    const parentArr = this._childrenArrayOf(this._actorJsonPath.get(actor))
    if (!parentArr) {
      logger.warn(`[ScenePreview] removeSceneObject 跳过（找不到父数组）: ${actor.name}`)
      return false
    }
    const idx = parentArr.indexOf(node)
    if (idx < 0) return false
    parentArr.splice(idx, 1)
    this.commitStructuralEdit(null)
    logger.info(`[ScenePreview] 删除场景对象: ${actor.name}`)
    return true
  }

  /** 深拷贝节点到其父 children 末尾（顶层 → objects 末尾），名称自动加序号。返回新节点名。 */
  duplicateSceneObject(actor: Actor): string | null {
    const node = this._actorJsonMap.get(actor)
    const path = this._actorJsonPath.get(actor)
    if (!node || !path) {
      logger.warn(`[ScenePreview] duplicateSceneObject 跳过（无映射）: ${actor.name}`)
      return null
    }
    const parentArr = this._childrenArrayOf(path)
    if (!parentArr) return null
    const clone = JSON.parse(JSON.stringify(node)) as Record<string, unknown>
    const siblings = parentArr.map((o) => (o as { name?: string }).name).filter((n): n is string => !!n)
    const newName = uniqueNodeName(((node as { name?: string }).name) || 'Copy', siblings)
    clone.name = newName
    parentArr.push(clone)
    this.commitStructuralEdit(newName)
    logger.info(`[ScenePreview] 复制场景对象: ${actor.name} → ${newName}`)
    return newName
  }

  /** 重命名节点（同父重名自动追加序号）。返回是否成功。 */
  renameSceneObject(actor: Actor, newName: string): boolean {
    const node = this._actorJsonMap.get(actor)
    const path = this._actorJsonPath.get(actor)
    if (!node || !path) {
      logger.warn(`[ScenePreview] renameSceneObject 跳过（无映射）: ${actor.name}`)
      return false
    }
    const parentArr = this._childrenArrayOf(path)
    const siblings = (parentArr ?? [])
      .filter((o) => o !== node)
      .map((o) => (o as { name?: string }).name)
      .filter((n): n is string => !!n)
    const finalName = uniqueNodeName(newName, siblings)
    node.name = finalName
    this.commitStructuralEdit(finalName)
    logger.info(`[ScenePreview] 重命名场景对象: ${actor.name} → ${finalName}`)
    return true
  }

  /** 返回路径节点的父 children 数组（顶层 → objects 数组；找不到返回 null） */
  private _childrenArrayOf(path: string[] | undefined): Array<Record<string, unknown>> | null {
    if (!this._sceneAsset) return null
    const objs = this._sceneAsset.objects as unknown as Array<Record<string, unknown>>
    if (!path || path.length <= 1) return objs
    let cur: Record<string, unknown> | undefined = objs.find((o) => (o as { name?: string }).name === path[0])
    for (let i = 1; i < path.length - 1 && cur; i++) {
      const children = (cur.children as Array<Record<string, unknown>> | undefined) ?? []
      cur = children.find((c) => (c as { name?: string }).name === path[i])
    }
    if (!cur) return null
    return (cur.children as Array<Record<string, unknown>> | undefined) ?? null
  }

  /**
   * 结构编辑提交：收集当前状态 → 对比基准 push 撤销点 → 全量重建预览
   * （增删节点/重命名无法原地回滚）。
   * @param selectName 重建后要选中的节点名（null = 不选中）
   */
  private commitStructuralEdit(selectName: string | null): void {
    const key = this._undoKey
    if (!key) {
      logger.warn('[ScenePreview] 结构编辑提交跳过（无撤销 key，activate 未调用）')
      return
    }
    const cur = this.collectSaveData()
    if (!cur) return
    if (this._lastCommitted === null) {
      this._lastCommitted = JSON.parse(JSON.stringify(cur))
      logger.info(`[ScenePreview] 结构编辑（首帧基准）: ${key}`)
    } else if (JSON.stringify(cur) === JSON.stringify(this._lastCommitted)) {
      logger.info(`[ScenePreview] 结构编辑提交跳过（内容无变化）: ${key}`)
    } else {
      UndoManager.push(key, this._lastCommitted)
      this._lastCommitted = JSON.parse(JSON.stringify(cur))
      logger.info(`[ScenePreview] 结构编辑提交（= 一个撤销点）: ${key}（undo 栈 ${UndoManager.depth(key).undo}）`)
    }
    // 全量重建预览（结构变更）
    const path = this._currentScenePath
    this.loadSceneAsset(JSON.parse(JSON.stringify(cur)) as unknown as SceneAsset)
    if (path) this.activate(path)
    if (selectName) {
      const tree = this.getActorTree()
      const node = tree.find((n) => n.name === selectName && n.actor)
      if (node?.actor) this.selectActor(node.actor)
    }
    editorBus.emit(EditorEvent.BLUEPRINT_TRANSFORM_DIRTY, path ?? '')
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
    const mapped = this._actorJsonMap

    const walk = (obj: THREE.Object3D, depth: number, insideRef: boolean): void => {
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
        // ref 实例内部：只显示本场景资产拥有的子对象（_actorJsonMap 登记），
        // 蓝图内部子节点跳过整棵子树（保持「ref 不展开内部」约定）
        if (insideRef && !mapped.has(actorRef)) return
        result.push({ depth, name: obj.name || obj.type, actor: actorRef })
      }

      const nextInsideRef =
        insideRef ||
        (!isRoot && ((obj as any).userData?.actorRef as Actor | undefined)?.isRefInstance === true)
      const nextDepth = isRoot ? depth : depth + 1
      for (const child of obj.children) walk(child, nextDepth, nextInsideRef)
    }

    walk(this.scene, 0, false)
    this._actorTreeCache = result
    return result
  }

  /**
   * 收集保存数据：遍历大纲 Actor（含嵌套子级），通过 _actorJsonMap 把实时 transform
   * 与组件持久化属性回写到各 Actor 对应的 JSON 节点，返回干净的深拷贝供写入磁盘。
   *
   * 相比按名称匹配 Actor→JSON 节点：O(1) 直查、零歧义，且覆盖 ref 实例
   * （spawn 后 actor 名为蓝图名，如 "Townhall"，而场景节点名为 "Townhall_1"，
   * 名称匹配必然失败——撤回系统依赖此处正确回写，否则拖拽被判定为"无变化"）。
   */
  collectSaveData(): Record<string, unknown> | null {
    if (!this._sceneAsset) return null

    for (const treeNode of this.getActorTree()) {
      const actor = treeNode.actor
      const jsonNode = actor ? this._actorJsonMap.get(actor) : undefined
      if (!actor || !jsonNode) continue
      const isActorRef = jsonNode.type === 'actor' || jsonNode.type === 'ref'

      // ─── 通用组件属性持久化：扫描每个组件可编辑属性写回 JSON（Inspector 直改后撤回需要）───
      const jsonComps = (jsonNode.components as Array<Record<string, any>> | undefined) ?? []
      for (const comp of actor.getAllComponents() as ActorComponent[]) {
        if (!comp.persistType) continue
        // 跳过运行时自动生成的内部组件（如 UIButton 透明点击层 UIImageComponent，isClickOnly=true）：
        // 不写进资产，避免保存后出现重复 image 组件
        if ((comp as unknown as { isClickOnly?: boolean }).isClickOnly) continue
        // 场景节点（ref/actor）的 JSON 可能没有该组件（组件由蓝图/代码生成，
        // 如 Goldmine 的 MeshComponent）——找不到 target 时新增 JSON 组件节点，
        // 否则组件属性（size/color 等）永远写不进 _sceneAsset，Inspector 直改
        // 被判定"内容无变化"而不进撤销栈。
        let target = jsonComps.find((c) => c.baseClass === comp.persistType)
        if (!target) {
          target = { baseClass: comp.persistType, properties: {} }
          jsonComps.push(target)
          ;(jsonNode.components as Array<Record<string, any>> | undefined) = jsonComps
        }
        const props = (target.properties ?? {}) as Record<string, unknown>
        const persist = comp.getPersistentProps()
        // 合入（不删除现有键，避免丢失 JSON 中只读/代码配置的属性）
        for (const [k, v] of Object.entries(persist)) {
          props[k] = v
        }
      }

      // 组件优先：内联 actor 的位置写在 components 的 TransformComponent properties
      // （组件为权威，顶层 position/rotation/scale 是废弃冗余，写入后删除）
      const comps = (jsonNode.components as Array<Record<string, any>> | undefined) ?? []
      const tf = comps.find(
        (c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent',
      )
      if (tf) {
        const props = (tf.properties ?? {}) as Record<string, unknown>
        props.position = [actor.position.x, actor.position.y, actor.position.z]
        props.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
        props.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
        delete jsonNode.position
        delete jsonNode.rotation
        delete jsonNode.scale
      } else if (isActorRef) {
        // ref 节点无 components：overrides 语义走顶层
        jsonNode.position = [actor.position.x, actor.position.y, actor.position.z]
        jsonNode.rotation = [actor.rotation.x, actor.rotation.y, actor.rotation.z]
        jsonNode.scale = [actor.scale.x, actor.scale.y, actor.scale.z]
      } else {
        // 旧格式：只更新 pos
        jsonNode.pos = [actor.position.x, actor.position.y, actor.position.z]
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
      const dt = (time - this.lastTime) / 1000
      this.lastTime = time

      // WASD 漫游
      this.updateWASD(dt)

      // Gizmo 同步
      if (this.gizmo.visible) this.gizmo.syncTransform()

      // 调试 gizmos（含碰撞盒线框：预览 World 无 body，组件回退属性中心绘制；V 键开关）
      this.world.drawGizmos()

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
    // 页签关闭：清空本资产的撤销栈（重新打开回到干净状态，不残留旧历史）
    if (this._undoKey) UndoManager.clear(this._undoKey)
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
    // 预览对象工厂：释放全部追踪对象 + 自清 current（幂等）
    this.previewFactory.disposeAll()
    this.world.Destroy()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    this._sceneAsset = null
    this._actorTreeCache = null
    this._lastCommitted = null
    this._actorJsonMap.clear()
    this._actorJsonPath.clear()
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
