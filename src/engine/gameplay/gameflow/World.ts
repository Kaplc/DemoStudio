/**
 * World — 核心世界管理
 * 模仿 UE World，管理 Actor 注册、生命周期、Tick 循环
 */
import * as THREE from 'three'
import { Actor } from '../entity/Actor'
import { GenericActor } from '../entity/GenericActor'
import { GameMode } from './GameMode'
import { gizmos } from '../tools/Gizmos'
import { logger } from '../../Logger'
import { StaticMeshActor } from '../entity/StaticMeshActor'
import { loadScene } from '../scene/SceneLoader'
import { GameModeRegistry } from '../tools/GameModeRegistry'
import { ActorRegistry } from '../tools/ActorRegistry'
import { ComponentRegistry } from '../tools/ComponentRegistry'
import { BlueprintRegistry } from '../blueprint/BlueprintRegistry'
import { AssetRegistry } from '../tools/AssetRegistry'
import type { PropertyPatch } from '../tools/deepMerge'
import type { SceneAsset } from '../scene/SceneAsset'
import type { Pawn } from '../entity/Pawn'
import type { PlayerController } from '../input/PlayerController'

export class World {
  public readonly scene: THREE.Scene
  public gameMode: GameMode | null = null

  private allActors = new Set<Actor>()
  private pendingSpawn: Actor[] = []
  private pendingDestroy: Actor[] = []
  private animationId: number | null = null
  private lastTime = 0
  private _running = false
  private _tickCallbacks: Array<(dt: number) => void> = []

  constructor(scene: THREE.Scene, gameMode?: GameMode) {
    this.scene = scene
    if (gameMode) {
      this.SetGameMode(gameMode)
    }
  }

  // ═══════════════════════════════════
  //  GameMode
  // ═══════════════════════════════════

  SetGameMode(gm: GameMode) {
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
      if (gm.gameState) gm.gameState.BeginPlay()
    }
  }

  get gameState() {
    return this.gameMode?.gameState ?? null
  }

  // ═══════════════════════════════════
  //  Actor 管理
  // ═══════════════════════════════════

  SpawnActor<T extends Actor>(actor: T): T {
    actor.world = this
    this.pendingSpawn.push(actor)
    return actor
  }

  private commitSpawn() {
    for (const actor of this.pendingSpawn) {
      this.allActors.add(actor)
      // 仅顶层 Actor 加到场景；已 attachTo 父的子 Actor 已在父 root 下，
      // scene.add 会把它从父节点拆出，故跳过。
      if (!actor.parent) {
        this.scene.add(actor.root)
      }
      if (this._running) {
        actor.BeginPlay()
      }
    }
    this.pendingSpawn = []
  }

  DestroyActor(actor: Actor) {
    if (actor.bPendingDestroy && !this.allActors.has(actor)) return
    actor.bPendingDestroy = true
    this.pendingDestroy.push(actor)
  }

  private commitDestroy() {
    for (const actor of this.pendingDestroy) {
      if (this.allActors.has(actor)) {
        actor.EndPlay()
        this.scene.remove(actor.root)
        this.allActors.delete(actor)
      }
    }
    this.pendingDestroy = []
  }

  FindActor<T extends Actor>(type: new (...args: any[]) => T): T | null {
    for (const actor of this.allActors) {
      if (actor instanceof type) return actor
    }
    for (const actor of this.pendingSpawn) {
      if (actor instanceof type) return actor
    }
    return null
  }

  FindActors<T extends Actor>(type: new (...args: any[]) => T): T[] {
    const result: T[] = []
    for (const actor of this.allActors) {
      if (actor instanceof type) result.push(actor)
    }
    return result
  }

  GetAllActors(): Actor[] {
    return [...this.allActors]
  }

  /** 在世界中查找所有挂载了指定 Component 类型的 Actor 及其实例 */
  getAllComponents<T extends import('../entity/Component').Component>(
    type: new (...args: any[]) => T,
  ): T[] {
    const result: T[] = []
    for (const actor of this.allActors) {
      const comps = actor.getComponents(type)
      result.push(...comps)
    }
    return result
  }

  SpawnPlayer(
    controller: PlayerController,
    pawn: Pawn,
  ) {
    this.SpawnActor(pawn)
    controller.Possess(pawn)
    return { controller, pawn }
  }

  /**
   * 从 Blueprint 实例化一个 Actor 到世界（统一 Unity Prefab / UE Blueprint Class）。
   *
   * 注入时序（关键，全部在 SpawnActor / BeginPlay 之前完成）：
   *   1. resolve(id) → 扁平 CDO（继承链已合并）
   *   2. ActorRegistry.create(baseClass) 构造
   *   3. applyPatch(defaults) 注入 CDO 默认属性
   *   4. 挂 Component（ComponentRegistry.create + addComponent）
   *   5. 递归子 Actor（各自 SpawnActorFromBlueprint 或 ActorRegistry.create + attachTo）
   *   6. applyPatch(overrides) 应用调用方覆盖
   *   7. 设 blueprintRef 元数据
   *   8. SpawnActor（进 pendingSpawn，后续 commitSpawn → BeginPlay）
   *
   * @param id        Blueprint id
   * @param overrides 实例级覆盖（position/rotation/scale/自定义参数），叠加在 CDO 之上
   * @returns 生成的 Actor；解析或构造失败返回 null
   */
  SpawnActorFromBlueprint(id: string, overrides?: PropertyPatch): Actor | null {
    let resolved
    try {
      resolved = BlueprintRegistry.resolve(id)
    } catch (e) {
      logger.warn(`[World] SpawnActorFromBlueprint("${id}") 解析失败: ${(e as Error).message}`)
      return null
    }

    const actor = ActorRegistry.create(resolved.baseClass)
    if (!actor) {
      logger.warn(`[World] SpawnActorFromBlueprint("${id}"): baseClass "${resolved.baseClass}" 未在 ActorRegistry 注册`)
      return null
    }

    // 1. CDO 默认属性（仅赋值字段，不碰 world/几何）
    if (resolved.defaults && Object.keys(resolved.defaults).length > 0) {
      actor.applyPatch(resolved.defaults)
    }

    // 2. Component（SpawnActor 前挂完，随 BeginPlay 一起激活）
    for (const cdef of resolved.components) {
      const comp = ComponentRegistry.create(actor, cdef.type, cdef.props)
      if (comp) {
        actor.addComponent(comp)
      } else {
        logger.warn(`[World] SpawnActorFromBlueprint("${id}"): Component 类型 "${cdef.type}" 未注册，已跳过`)
      }
    }

    // 3. 子 Actor（attachTo 父；blueprint 子自带 overrides，actor 子在此应用 overrides）
    //    每个子 Actor 还可能包含内联 objects + 递归 children，统一在此展开
    const spawnChildObjects = (childDefs: typeof resolved.children, parentActor: Actor) => {
      for (const child of childDefs) {
        let childActor: Actor | null = null
        if (child.blueprint) {
          childActor = this.SpawnActorFromBlueprint(child.blueprint, child.overrides)
        } else if (child.actor) {
          childActor = ActorRegistry.create(child.actor)
          if (childActor && child.overrides && Object.keys(child.overrides).length > 0) {
            childActor.applyPatch(child.overrides)
          }
        }
        // 纯容器节点（无 blueprint/actor，仅用来承载 objects 或嵌套 children）
        if (!childActor && (child.objects?.length || child.children?.length)) {
          childActor = new GenericActor(child.name ?? `Container_${parentActor.name}`)
        }
        if (!childActor) {
          logger.warn(
            `[World] SpawnActorFromBlueprint("${id}"): 子节点生成失败 (blueprint=${child.blueprint ?? '-'}, actor=${child.actor ?? '-'})`,
          )
          continue
        }
        childActor.attachTo(parentActor)

        // 把 child.name 设置到 root 上（供 Outline 按名称查找）
        if (child.name) {
          childActor.root.name = child.name
        }

        // 展开此子节点的内联网格
        if (child.objects && child.objects.length > 0) {
          this.spawnInlineObjects(child.objects, childActor)
        }

        // 递归展开此子节点的嵌套 children
        if (child.children && child.children.length > 0) {
          spawnChildObjects(child.children, childActor)
        }
      }
    }

    // 根级内联网格 → 直接挂到 actor 上
    if (resolved.objects && resolved.objects.length > 0) {
      this.spawnInlineObjects(resolved.objects, actor)
    }

    // 展开所有子 Actor 树
    if (resolved.children.length > 0) {
      spawnChildObjects(resolved.children, actor)
    }

    // 3b. (已弃用) 场景子对象 — 保留兼容，优先使用内联 objects
    if (resolved.scene) {
      const sceneAsset = AssetRegistry.getScene(resolved.scene)
      if (sceneAsset) {
        const sceneGroup = loadScene(sceneAsset)
        const meshes: THREE.Mesh[] = []
        sceneGroup.group.traverse((node) => {
          if (node instanceof THREE.Mesh) meshes.push(node)
        })
        for (const mesh of meshes) {
          sceneGroup.group.remove(mesh)
          const childActor = new StaticMeshActor(mesh, `Scene_${sceneAsset.name}_${mesh.name || ''}`)
          childActor.attachTo(actor)
          this.SpawnActor(childActor)
        }
        logger.debug(`[World] SpawnActorFromBlueprint("${id}"): 加载场景 "${resolved.scene}"，生成 ${meshes.length} 个 StaticMeshActor`)
      } else {
        logger.warn(`[World] SpawnActorFromBlueprint("${id}"): 场景 "${resolved.scene}" 未在 AssetRegistry 注册`)
      }
    }

    // 4. 调用方实例覆盖
    if (overrides && Object.keys(overrides).length > 0) {
      actor.applyPatch(overrides)
    }

    // 5. 蓝图元数据（供编辑器 Outline/Inspector 识别）
    actor.blueprintRef = { id, overrides }

    // 6. 进 World
    this.SpawnActor(actor)
    return actor
  }

  /**
   * 将 SceneNode[] 展开为 StaticMeshActor 并挂到 parentActor 下。
   * 内部复用 loadScene 的网格创建逻辑（不关心 skybox/背景）。
   */
  private spawnInlineObjects(nodes: import('../scene/SceneAsset').SceneNode[], parentActor: Actor): void {
    const sceneGroup = loadScene({ name: '_inline', objects: nodes })
    const meshes: THREE.Mesh[] = []
    sceneGroup.group.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.push(node)
    })
    for (const mesh of meshes) {
      sceneGroup.group.remove(mesh)
      const childActor = new StaticMeshActor(mesh, `Mesh_${mesh.name || mesh.uuid.substring(0, 8)}`)
      childActor.attachTo(parentActor)
      this.SpawnActor(childActor)
    }
    // 清理空 group（几何体已移走，无需 dispose）
    sceneGroup.group.clear()
  }

  // ═══════════════════════════════════
  //  Tick 循环
  // ═══════════════════════════════════

  get running() { return this._running }

  /** 当前等待生成和已生成的 Actor 总数（用于日志/调试） */
  get actorCount(): number { return this.allActors.size }
  get pendingSpawnCount(): number { return this.pendingSpawn.length }
  get pendingDestroyCount(): number { return this.pendingDestroy.length }

  Start() {
    if (this._running) return
    this._running = true
    this.lastTime = performance.now()

    // 为所有已生成的 Actor 调用 BeginPlay
    for (const actor of this.allActors) {
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
    // 1. 处理待生成/销毁
    this.commitSpawn()
    this.commitDestroy()

    // 2. Tick 所有 Actor
    for (const actor of this.allActors) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }

    // 3. Tick GameMode + GameState
    this.gameMode?.Tick(dt)
    this.gameMode?.gameState?.Tick(dt)

    // 4. 更新摄像机
    this.gameMode?.cameraManager.UpdateCamera()

    // 5. 外部回调
    for (const cb of this._tickCallbacks) {
      cb(dt)
    }
  }

  /** 标记运行但不启动自己的 rAF（由外部驱动 render/update 时使用） */
  BeginPlay() {
    this._running = true
    for (const actor of this.allActors) {
      if (!actor.bHasBegunPlay) actor.BeginPlay()
    }
    // 非 allActors 的 Actor（GameMode/GameState）
    if (this.gameMode && !this.gameMode.bHasBegunPlay) this.gameMode.BeginPlay()
    if (this.gameMode?.gameState && !this.gameMode.gameState.bHasBegunPlay) this.gameMode.gameState.BeginPlay()
  }

  /** 暂停运行（外部驱动模式） */
  Pause() {
    this._running = false
  }

  /** 销毁所有 Actor（立即执行，不等待 tick） */
  DestroyAllActors() {
    let count = this.allActors.size + this.pendingSpawn.length
    // 清理已提交的 Actor
    for (const actor of [...this.allActors]) {
      actor.EndPlay()
      this.scene.remove(actor.root)
    }
    this.allActors.clear()
    this.pendingDestroy = []
    // 清理等待生成的 Actor（从未进入场景，仍需释放 GPU 资源）
    for (const actor of this.pendingSpawn) {
      actor.EndPlay()
    }
    this.pendingSpawn = []
    logger.debug(`[World] DestroyAllActors: 销毁 ${count} 个 Actor`)
  }

  /** 手动触发一次 Tick（由外部渲染循环驱动） */
  manualTick(dt: number) {
    if (!this._running) return
    this.commitSpawn()
    this.commitDestroy()
    for (const actor of this.allActors) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }
    // GameMode 的 Tick（包含其 Component 的 Tick）
    this.gameMode?.Tick(dt)
    // GameState 的 Tick
    this.gameMode?.gameState?.Tick(dt)
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
      // GameMode（及其 Component，如 SpawnComponent）不在 allActors 中，单独绘制
      this.gameMode?.drawGizmos()
      for (const actor of this.allActors) {
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
   * 4. 执行可选的 setup 回调（加载场景资产、设置相机、生成玩家等）
   * 5. BeginPlay() 恢复世界运行，触发新 GameMode.BeginPlay + commitSpawn
   *
   * @param newMode  目标 GameMode
   * @param setup    在 BeginPlay 之前执行的设置回调（场景加载、相机、Controller 等）
   */
  SwitchScene(newMode: GameMode, setup?: () => void): void {
    this.Pause()
    this.DestroyAllActors()
    this.SetGameMode(newMode)
    setup?.()
    this.BeginPlay()
    logger.info(`[World] SwitchScene → ${newMode.constructor.name}`)
  }

  /**
   * 加载场景资产数据，将其中所有 Mesh 创建为 StaticMeshActor 并生成到世界。
   * 同时应用场景的 skybox 配置（背景色 + 雾效）。
   * 返回生成的 Actor 数量。
   */
  loadSceneAsActors(sceneAsset: SceneAsset): number {
    const asset = loadScene(sceneAsset)
    let count = 0

    // 几何节点 → StaticMeshActor
    const meshes: THREE.Mesh[] = []
    asset.group.traverse((node) => {
      if (node instanceof THREE.Mesh) meshes.push(node)
    })
    for (const mesh of meshes) {
      asset.group.remove(mesh)
      const actor = new StaticMeshActor(mesh, `Scene_${sceneAsset.name}_${mesh.name || ''}`)
      this.SpawnActor(actor)
      count++
    }

    // blueprint 节点 → SpawnActorFromBlueprint（pos/rot/scale 转为实例覆盖）
    const bpNodes = asset.blueprintNodes ?? []
    for (const bp of bpNodes) {
      const overrides: PropertyPatch = { ...(bp.overrides ?? {}) }
      if (bp.pos) overrides.position = bp.pos
      if (bp.rot) overrides.rotation = bp.rot
      if (bp.scale) overrides.scale = bp.scale
      const actor = this.SpawnActorFromBlueprint(bp.blueprint, overrides)
      if (actor) count++
    }

    // 应用 skybox（背景色 + 雾效）
    if (asset.skybox) {
      if (asset.skybox.backgroundColor) {
        this.scene.background = new THREE.Color(asset.skybox.backgroundColor)
      }
      if (asset.skybox.fogColor) {
        this.scene.fog = new THREE.Fog(
          asset.skybox.fogColor,
          asset.skybox.fogNear ?? 30,
          asset.skybox.fogFar ?? 60,
        )
      }
    }
    logger.debug(
      `[World] loadSceneAsActors(${sceneAsset.name}): 生成 ${count} 个 Actor（mesh=${meshes.length}, blueprint=${bpNodes.length}）`,
    )
    return count
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
      const asset = AssetRegistry.getScene(sceneOrName)
      if (!asset) {
        logger.warn(`[World] SwitchToScene: 场景 "${sceneOrName}" 未在 AssetRegistry 中注册`)
        return false
      }
      return this.SwitchToScene(asset, extraSetup)
    }

    const sceneAsset = sceneOrName
    const mode = sceneAsset.mode
    if (!mode || !GameModeRegistry.has(mode)) {
      logger.warn(`[World] SwitchToScene: mode "${mode}" 未注册，无法切换`)
      return false
    }
    const newMode = GameModeRegistry.create(mode)!
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
    // 清理 GameMode/GameState
    this.gameMode?.gameState?.EndPlay()
    this.gameMode?.EndPlay()
    // 从后往前销毁所有 Actor
    const all = [...this.allActors]
    for (let i = all.length - 1; i >= 0; i--) {
      all[i].EndPlay()
      this.scene.remove(all[i].root)
    }
    this.allActors.clear()
    this.pendingSpawn = []
    this.pendingDestroy = []
    this._tickCallbacks = []
    this.gameMode = null
  }
}
