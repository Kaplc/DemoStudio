/**
 * World — 核心世界管理
 * 模仿 UE World，管理 Actor 注册、生命周期、Tick 循环
 *
 * Actor 的生成/创建/销毁/查询由 ActorManagerComponent 组件承载，
 * 本类保留同名转发方法（外部 API 兼容）。
 */
import * as THREE from 'three'
import { GenericActor } from '../entity/GenericActor'
import { AObject } from '../entity/AObject'
import { SceneRendererComponent } from './SceneRendererComponent'
import { ActorManagerComponent } from './ActorManagerComponent'
import { GameMode } from './GameMode'
import { GameInstance } from './GameInstance'
import { gizmos } from '../tools/Gizmos'
import { logger } from '../Logger'
import { UIManager } from '../ui/UIManager'
import { MeshComponent } from '../rendering/MeshComponent'
import { loadScene } from '../asset/SceneLoader'
import { GameModeRegistry } from '../tools/GameModeRegistry'
import { AssetRegistry } from '../asset/AssetRegistry'
import type { PropertyPatch } from '../tools/deepMerge'
import type { SceneAsset } from '../asset/SceneAsset'
import type { Actor } from '../entity/Actor'
import type { Pawn } from '../entity/Pawn'

export class World extends AObject {
  /** 静态实例计数器（日志区分多个 World 实例用） */
  private static _nextId = 1
  /** 本实例 ID */
  readonly id: number

  public readonly scene: THREE.Scene
  public gameMode: GameMode | null = null

  /**
   * UI 统一管理器组件（负责 HUD / UI Actor 的创建与管理，并持有 UI 独立场景 uiScene）。
   * 由 World 构造时创建并挂载。
   */
  get ui(): UIManager {
    return this.getComponent(UIManager)!
  }

  /**
   * Game 视口渲染器组件（由 Game 启动时从 instance.renderContainer 取 DOM 创建并挂到 World；
   * 未启动游戏时为 null）
   */
  get gameRenderer(): SceneRendererComponent | null {
    return this.getComponent(SceneRendererComponent) ?? null
  }

  /**
   * 确保 Game 视口渲染器组件存在（无则创建并挂载到本 World）。
   * DOM 容器由组件内部自行从当前活跃实例（GameInstance.current.renderContainer）获取；
   * 无活跃实例/无渲染容器时返回 null（不创建）。
   */
  ensureGameRenderer(): SceneRendererComponent | null {
    const existing = this.getComponent(SceneRendererComponent)
    if (existing) return existing
    if (!GameInstance.current?.renderContainer) return null
    const mgr = new SceneRendererComponent(this, { sharedScene: this.scene })
    this.addComponent(mgr)
    logger.info('[World] SceneRendererComponent 已创建并挂到 World（DOM 来自 GameInstance.current.renderContainer）')
    return mgr
  }


  /**
   * Actor 生成与管理组件（SpawnActor / SpawnActorFromBlueprint / 销毁 / 查询）。
   * 由 World 构造时创建并挂载。
   */
  get actorMgr(): ActorManagerComponent {
    return this.getComponent(ActorManagerComponent)!
  }

  private animationId: number | null = null
  private lastTime = 0
  private _running = false
  private _tickCallbacks: Array<(dt: number) => void> = []

  constructor(scene: THREE.Scene, gameMode?: GameMode) {
    super()
    this.id = World._nextId++
    this.scene = scene
    // UI 管理器组件：持有独立 UI 场景（透明背景，叠加渲染时保留主画面）
    this.addComponent(new UIManager(this))
    // Actor 管理组件：Actor 生成/销毁/查询
    this.addComponent(new ActorManagerComponent(this))
    // Game 视口渲染器组件：DOM 保存在 instance.renderContainer，由 Game 启动时取出创建
    if (gameMode) {
      this.SetGameMode(gameMode)
    }
  }

  // ═══════════════════════════════════
  //  GameMode
  // ═══════════════════════════════════

  SetGameMode(gm: GameMode) {
    logger.info(`[World#${this.id}] SetGameMode: ${gm.constructor.name}`)
    // 先清理旧 GameMode
    if (this.gameMode) {
      this.gameMode.EndPlay()
    }
    // GameMode 是 Actor，手动设置 world 引用但不加入 allActors（由 World 显式管理其生命周期）
    gm.world = this
    this.gameMode = gm
    gm.InitGame()
    gm.StartPlay()
    if (this._running) {
      gm.BeginPlay()
    }
  }

  get gameState() {
    return this.gameMode?.gameState ?? null
  }

  // ═══════════════════════════════════
  //  Actor 管理（转发到 ActorManagerComponent）
  // ═══════════════════════════════════

  /** 生成 Actor（进待生成队列，tick 时提交：进场景 + BeginPlay） */
  SpawnActor<T extends Actor>(actor: T): T {
    return this.actorMgr.SpawnActor(actor)
  }

  /**
   * 生成 Pawn 到世界：进入待生成队列，commitSpawn 实际生成后调用 onSpawned 回调。
   * 用于 GameMode.SpawnPlayer → World 生成 → 通知 Controller（Possess）的完整链路。
   */
  SpawnPawn(pawn: Pawn, onSpawned?: (pawn: Pawn) => void): Pawn {
    return this.actorMgr.SpawnPawn(pawn, onSpawned)
  }

  DestroyActor(actor: Actor) {
    this.actorMgr.DestroyActor(actor)
  }

  /**
   * 通用对象销毁入口（Object.destroy 调用）。
   * 场景对象（Actor）走 pendingDestroy 队列（tick 时提交清理）；
   * 非场景对象（GameMode/GameState/Controller 等）立即 EndPlay。
   */
  DestroyObject(obj: import('../entity/BObject').BObject): void {
    this.actorMgr.DestroyObject(obj)
  }

  FindActor<T extends Actor>(type: new (...args: any[]) => T): T | null {
    return this.actorMgr.FindActor(type)
  }

  FindActors<T extends Actor>(type: new (...args: any[]) => T): T[] {
    return this.actorMgr.FindActors(type)
  }

  GetAllActors(): Actor[] {
    return this.actorMgr.GetAllActors()
  }

  /** 在世界中查找所有挂载了指定 Component 类型的 Actor 及其实例 */
  getAllActorComponents<T extends import('../entity/Component').Component>(
    type: new (...args: any[]) => T,
  ): T[] {
    return this.actorMgr.getAllActorComponents(type)
  }

  /**
   * 从 Blueprint 实例化一个 Actor 到世界（统一 Unity Prefab / UE Blueprint Class）。
   * 完整实例化逻辑见 ActorManagerComponent.SpawnActorFromBlueprint。
   * @param path      Blueprint id
   * @param overrides 实例级覆盖（position/rotation/scale/自定义参数）
   * @returns 生成的 Actor；解析或构造失败返回 null
   */
  SpawnActorFromBlueprint(path: string, overrides?: PropertyPatch): Actor | null {
    return this.actorMgr.SpawnActorFromBlueprint(path, overrides)
  }

  // ═══════════════════════════════════
  //  Tick 循环
  // ═══════════════════════════════════

  get running() { return this._running }

  /** 当前等待生成和已生成的 Actor 总数（用于日志/调试） */
  get actorCount(): number { return this.actorMgr.actorCount }
  get pendingSpawnCount(): number { return this.actorMgr.pendingSpawnCount }
  get pendingDestroyCount(): number { return this.actorMgr.pendingDestroyCount }

  Start() {
    if (this._running) return
    this._running = true
    this.lastTime = performance.now()

    // 为所有已生成的 Actor 调用 BeginPlay
    for (const actor of this.actorMgr.GetAllActors()) {
      if (!actor.bHasBegunPlay) actor.BeginPlay()
    }

    const animate = (time: number) => {
      if (!this._running) return
      const dt = Math.min((time - this.lastTime) / 1000, 0.05)
      this.lastTime = time

      this.tick(dt)

      this.animationId = requestAnimationFrame(animate)
    }
    this.animationId = requestAnimationFrame(animate)
  }

  Stop() {
    this._running = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  private tick(dt: number) {
    // 1. 处理待生成/销毁（ActorManagerComponent）
    this.actorMgr.commitSpawn()
    this.actorMgr.commitDestroy()

    // 2. Tick 所有 3D Actor（UI Actor 由 UIManager 独立驱动）
    for (const actor of this.actorMgr.GetAllActors()) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }

    // 3. Tick UI 子系统
    this.ui.tickUI(dt)

    // 4. Tick GameMode（内部统一驱动 GameState + Controller + 摄像机）
    this.gameMode?.Tick(dt)

    // 5. 外部回调
    for (const cb of this._tickCallbacks) {
      cb(dt)
    }
  }

  /** 标记运行但不启动自己的 rAF（由外部驱动 render/update 时使用） */
  BeginPlay() {
    logger.info(`[World#${this.id}] BeginPlay: 恢复运行（actorCount=${this.actorMgr.actorCount}, pendingSpawn=${this.actorMgr.pendingSpawnCount}）`)
    this._running = true
    // 先提交等待生成的 Actor（否则 SpawnActorFromBlueprint 生成的 Actor 永远停在
    // pendingSpawn 队列，不进场景、不 BeginPlay，UI/游戏对象不会渲染）
    this.actorMgr.commitSpawn()
    this.actorMgr.commitDestroy()
    // UI 子系统恢复运行
    this.ui.beginPlay()
    for (const actor of this.actorMgr.GetAllActors()) {
      if (!actor.bHasBegunPlay) actor.BeginPlay()
    }
    // GameMode（其 BeginPlay 内部统一驱动 GameState + Controller）
    if (this.gameMode && !this.gameMode.bHasBegunPlay) this.gameMode.BeginPlay()
  }

  /** 暂停运行（外部驱动模式） */
  Pause() {
    logger.info('[World] Pause: 暂停运行')
    this._running = false
  }

  /** 销毁所有 3D Actor 与 UI Actor（Controller 由 GameMode.EndPlay 负责） */
  DestroyAllActors() {
    this.actorMgr.DestroyAllActors()
  }

  /** 手动触发一次 Tick（由外部渲染循环驱动） */
  manualTick(dt: number) {
    if (!this._running) return
    this.actorMgr.commitSpawn()
    this.actorMgr.commitDestroy()
    for (const actor of this.actorMgr.GetAllActors()) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }
    // GameMode 统一驱动 GameState + Controller + 摄像机
    this.gameMode?.Tick(dt)
    for (const cb of this._tickCallbacks) {
      cb(dt)
    }
  }

  /** 注册外部 Tick 回调 */
  onTick(cb: (dt: number) => void): () => void {
    this._tickCallbacks.push(cb)
    return () => {
      this._tickCallbacks = this._tickCallbacks.filter((c) => c !== cb)
    }
  }

  // ═══════════════════════════════════
  //  Gizmos 调试绘制
  // ═══════════════════════════════════

  /**
   * 绘制一帧的调试 Gizmos（由外部渲染循环每帧调用）。
   * 始终执行 beginFrame/flush，保证停止或关闭时画面被清空，不留残影。
   */
  drawGizmos() {
    gizmos.beginFrame()
    if (gizmos.enabled) {
      // GameMode（及其 Component，如 SpawnComponent）不在 Actor 集合中，单独绘制
      this.gameMode?.drawGizmos()
      for (const actor of this.actorMgr.GetAllActors()) {
        if (actor.bPendingDestroy) continue
        actor.drawGizmos()
      }
    }
    gizmos.flush()
  }

  // ═══════════════════════════════════
  //  场景切换
  // ═══════════════════════════════════

  /**
   * 切换场景阶段：暂停世界 → 销毁所有 Actor → 替换 GameMode → 执行 setup → 恢复运行。
   *
   * 封装了阶段性场景切换的通用流程（如 menu→base→game）：
   * 1. Pause() 暂停 Tick 循环
   * 2. DestroyAllActors() 销毁并释放所有 Actor
   * 3. SetGameMode(newMode) 切换 GameMode（InitGame + StartPlay，因 _running=false 不触发 BeginPlay）
   * 4. 创建 HUD（若 newMode.HUDClass 声明）— UI 对象创建由 World 统一管理
   * 5. 执行可选的 setup 回调（加载场景资产、设置相机、生成玩家等）
   * 6. BeginPlay() 恢复世界运行，触发新 GameMode.BeginPlay + commitSpawn
   *
   * @param newMode  目标 GameMode
   * @param setup    在 BeginPlay 之前执行的设置回调（场景加载、相机、Controller 等）
   */
  SwitchScene(newMode: GameMode, setup?: () => void): void {
    logger.info(`[World#${this.id}] SwitchScene: 暂停世界 → 销毁旧 Actor → 切换 GameMode(${newMode.constructor.name})`)
    this.Pause()
    this.DestroyAllActors()
    this.SetGameMode(newMode)
    // 创建 HUD（模仿 UE：GameMode.HUDClass → UIManager 统一创建 UI）
    if (newMode.HUDClass) {
      this.ui.createHUD(newMode.HUDClass)
    } else {
      logger.info('[World] SwitchScene: GameMode 未声明 HUDClass，跳过 HUD 创建')
    }
    logger.info('[World] SwitchScene: 执行 setup 回调（加载场景资产 / 项目专属设置）...')
    setup?.()
    this.BeginPlay()
    logger.info(`[World#${this.id}] SwitchScene → ${newMode.constructor.name}（完成，actorCount=${this.actorMgr.actorCount}）`)
  }

  /**
   * 加载场景资产数据，将其中所有对象创建为 Actor 并生成到世界。
   * 新格式（actor/ref 节点）保持 BlueprintChildDef 风格层级；
   * 旧格式（box/plane 等几何捷径）降级为 GenericActor + MeshComponent。
   * 所有顶层 Actor 挂载到场景根 Actor 下，供 Outline 展示统一树形结构。
   * 同时应用场景的 skybox 配置（背景色 + 雾效）。
   * 返回生成的 Actor 数量。
   */
  loadSceneAsActors(sceneAsset: SceneAsset): number {
    logger.info(`[World] loadSceneAsActors: 加载场景资产 "${sceneAsset.name}" (objects=${sceneAsset.objects?.length ?? 0})`)
    const asset = loadScene(sceneAsset)
    let count = 0

    // 场景根 Actor（Outline 中作为树的根节点展示，统一名为 "Root"，
    // 区别于编辑器默认内容根 "Default"）
    const rootActor = new GenericActor('Root')
    this.SpawnActor(rootActor)
    count++

    // 几何节点 → GenericActor + MeshComponent（旧格式兼容）
    // 仅处理没有对应 actor/ref 节点的 mesh（避免与新格式重复）
    const actorRefPaths = new Set<string>()
    for (const an of (asset.actorNodes ?? [])) {
      // actor 节点的 mesh 会在 spawnInlineActor 中创建，这里标记跳过
      if (an.name) actorRefPaths.add(an.name)
    }
    for (const rn of (asset.refNodes ?? [])) {
      if (rn.name) actorRefPaths.add(rn.name)
    }
    for (const bp of (asset.blueprintNodes ?? [])) {
      if (bp.name) actorRefPaths.add(bp.name)
    }

    const meshes: THREE.Mesh[] = []
    asset.group.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.push(node)
    })
    for (const mesh of meshes) {
      // 跳过已有 actor/ref 节点的 mesh（它们在后面会作为正式 Actor 创建）
      const ownerName = mesh.name?.split('_mesh')[0] ?? ''
      if (ownerName && actorRefPaths.has(ownerName)) continue

      asset.group.remove(mesh)
      const actor = new GenericActor(`Scene_${sceneAsset.name}_${mesh.name || ''}`)
      actor.addComponent(new MeshComponent(actor, mesh))
      actor.attachTo(rootActor)
      this.SpawnActor(actor)
      count++
    }

    // blueprint 节点（旧格式兼容）→ SpawnActorFromBlueprint（标记为整体，大纲不展开内部） */
    const bpNodes = asset.blueprintNodes ?? []
    for (const bp of bpNodes) {
      const overrides: PropertyPatch = { ...(bp.overrides ?? {}) }
      if (bp.pos) overrides.position = bp.pos
      if (bp.rot) overrides.rotation = bp.rot
      if (bp.scale) overrides.scale = bp.scale
      const actor = this.SpawnActorFromBlueprint(bp.blueprint, overrides)
      if (actor) { actor.isRefInstance = true; actor.attachTo(rootActor); count++ }
    }

    // ref 节点（新格式）→ SpawnActorFromBlueprint（标记为整体） */
    const refNodes = asset.refNodes ?? []
    for (const rn of refNodes) {
      const overrides: PropertyPatch = { ...(rn.overrides ?? {}) }
      overrides.position = rn.position
      overrides.rotation = rn.rotation
      overrides.scale = rn.scale
      const actor = this.SpawnActorFromBlueprint(rn.ref, overrides)
      if (actor) { actor.isRefInstance = true; actor.attachTo(rootActor); count++ }
    }

    // 内联 Actor 节点 → spawnInlineActor（已内置 attachTo 子级层级）
    const actorNodes = asset.actorNodes ?? []
    for (const an of actorNodes) {
      const actor = this.spawnInlineActor(an)
      if (actor) { actor.attachTo(rootActor); count++ }
    }

    // 应用 skybox（背景色）
    if (asset.skybox) {
      if (asset.skybox.backgroundColor) {
        this.scene.background = new THREE.Color(asset.skybox.backgroundColor)
      }
    }
    logger.debug(
      `[World] loadSceneAsActors(${sceneAsset.name}): 生成 ${count} 个 Actor（根=${1}, mesh=${meshes.length}, blueprint=${bpNodes.length}, ref=${refNodes.length}, actor=${actorNodes.length}）`,
    )
    return count
  }

  /**
   * 从 ActorNode spawn 一个内联 Actor（含递归子节点）。
   * 与 SpawnActorFromBlueprint 的子节点逻辑一致。
   * 完整实现见 ActorManagerComponent.spawnInlineActor。
   * 供外部调用（ScenePreviewManager 等）。
   */
  spawnInlineActor(node: import('../asset/SceneAsset').ActorNode): Actor | null {
    return this.actorMgr.spawnInlineActor(node)
  }

  /**
   * 根据场景资产自动切换场景阶段。
   *
   * 流程：
   * 1. 读取 SceneAsset.mode，从 GameModeRegistry 查找对应的 GameMode 构造函数
   * 2. SwitchScene(newMode, () => {
   *      loadSceneAsActors(sceneAsset) — 将场景资产加载为 Actor
   *      extraSetup?() — 项目专属设置（相机、Controller、UI 等）
   *    })
   *
   * @param sceneAsset  场景资产数据
   * @param extraSetup  可选的项目专属设置回调（在暂停态、加载场景后执行）
   * @returns 是否成功切换（false = mode 未注册）
   */
  SwitchToScene(sceneAsset: SceneAsset, extraSetup?: () => void): boolean;

  /**
   * 按场景名称切换（自动从 AssetRegistry 查找场景资产）。
   *
   * @param sceneName  场景资产名称（SceneAsset.name）
   * @param extraSetup  可选的项目专属设置回调
   * @returns 是否成功切换（false = 场景未找到或 mode 未注册）
   */
  SwitchToScene(sceneName: string, extraSetup?: () => void): boolean;

  SwitchToScene(sceneOrName: SceneAsset | string, extraSetup?: () => void): boolean {
    // 字符串 → 从 AssetRegistry 查找
    if (typeof sceneOrName === 'string') {
      logger.info(`[World#${this.id}] SwitchToScene: 按名称查找场景 "${sceneOrName}"`)
      const asset = AssetRegistry.getScene(sceneOrName)
      if (!asset) {
        logger.error(`[World] SwitchToScene: 场景 "${sceneOrName}" 未在 AssetRegistry 中注册`)
        return false
      }
      return this.SwitchToScene(asset, extraSetup)
    }

    const sceneAsset = sceneOrName
    const mode = sceneAsset.mode
    logger.info(`[World#${this.id}] SwitchToScene: 加载场景 "${sceneAsset.name}" (mode=${mode}, objects=${sceneAsset.objects?.length ?? 0})`)
    if (!mode || !GameModeRegistry.has(mode)) {
      logger.error(`[World] SwitchToScene: mode "${mode}" 未注册，无法切换`)
      return false
    }
    const newMode = GameModeRegistry.create(mode)!
    logger.info(`[World#${this.id}] SwitchToScene: 创建 GameMode "${newMode.constructor.name}"，开始切换...`)
    this.SwitchScene(newMode, () => {
      this.loadSceneAsActors(sceneAsset)
      extraSetup?.()
    })
    return true
  }

  // ═══════════════════════════════════
  //  Mesh 工厂方法（程序化生成基础图元，隐藏 THREE 构造细节）
  // ═══════════════════════════════════

  /** 创建一个空 Group（用于构建组合体） */
  createGroup(): THREE.Group {
    return new THREE.Group()
  }

  /** 创建一个 Box 网格（用于构建组合体） */
  createBoxMesh(w: number, h: number, d: number, color: number, transparent?: boolean, opacity?: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color, ...(transparent ? { transparent, opacity, depthWrite: false } : {}) }),
    )
  }

  /** 创建一个球体网格 */
  createSphereMesh(radius: number, color: number, segments = 6, transparent?: boolean, opacity?: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, segments, segments),
      new THREE.MeshBasicMaterial({ color, ...(transparent ? { transparent, opacity, depthWrite: false } : {}) }),
    )
  }

  /** 创建一个平面网格（用于鸟/精灵等） */
  createPlaneMesh(
    w: number,
    h: number,
    color: number,
    transparent = false,
    opacity = 1,
    side: THREE.Side = THREE.FrontSide,
  ): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, transparent, opacity, depthWrite: !transparent, side }),
    )
  }

  /** 创建一个不可见的 Box 网格（用于点击碰撞体） */
  createInvisibleBox(w: number, h: number, d: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false, depthWrite: false }),
    )
  }

  /** 创建一个 Box 边框线框（用于悬停高亮等） */
  createEdgesBox(w: number, h: number, d: number, color: number, transparent?: boolean, opacity?: number): THREE.LineSegments {
    return new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color, ...(transparent ? { transparent, opacity } : {}) }),
    )
  }

  // ═══════════════════════════════════
  //  清理
  // ═══════════════════════════════════

  Destroy() {
    this.Stop()
    // 清理 UI 子系统
    this.ui.destroyAll()
    // GameMode（其 EndPlay 内部统一驱动 GameState + Controller）
    this.gameMode?.EndPlay()
    // 销毁所有 3D Actor（ActorManagerComponent 负责集合与场景移除）
    this.actorMgr.DestroyAllActors()
    this._tickCallbacks = []
    this.gameMode = null
    // 清理 Game 视口渲染器（由 World 创建，随 World 销毁）
    this.gameRenderer?.dispose()
  }
}
