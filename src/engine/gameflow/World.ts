/**
 * World — 核心世界管理
 * 模仿 UE World，管理 Actor 注册、生命周期、Tick 循环
 */
import * as THREE from 'three'
import { Actor } from '../entity/Actor'
import { GenericActor } from '../entity/GenericActor'
import { ensureTransformForActor } from '../ui/UITransformComponent'
import { AObject } from '../entity/AObject'
import { GameMode } from './GameMode'
import { gizmos } from '../tools/Gizmos'
import { logger } from '../Logger'
import { UIManager } from '../ui/UIManager'
import { MeshComponent } from '../rendering/MeshComponent'
import { loadScene } from '../asset/SceneLoader'
import { GameModeRegistry } from '../tools/GameModeRegistry'
import { ActorRegistry } from '../tools/ActorRegistry'
import { ComponentRegistry } from '../tools/ComponentRegistry'
import { BlueprintRegistry } from '../asset/BlueprintRegistry'
import { AssetRegistry } from '../asset/AssetRegistry'
import type { PropertyPatch } from '../tools/deepMerge'
import type { SceneAsset } from '../asset/SceneAsset'
import type { Pawn } from '../entity/Pawn'
import type { PlayerController } from '../input/PlayerController'

/**
 * 严格模式校验子节点 transform 数据（组件优先）：
 * 顶层 position/rotation/scale 字段已废弃（无论是否声明变换组件）—— 存在即报错，不应用顶层值；
 * 位置/旋转/缩放一律由 transform/uitransform 组件的 properties 承载。
 */
function childTransformViolation(child: {
  name?: string
  components?: Array<{ baseClass?: string }>
  position?: unknown
  rotation?: unknown
  scale?: unknown
} | null | undefined): string | null {
  if (!child) return null
  const hasTop = ['position', 'rotation', 'scale'].some((k) => (child as Record<string, unknown>)[k] !== undefined)
  if (hasTop) {
    return `节点 "${child.name ?? '-'}" 声明了废弃的顶层 position/rotation/scale：位置必须写在 transform/uitransform 组件（组件优先约定）`
  }
  return null
}

export class World extends AObject {
  /** 静态实例计数器（日志区分多个 World 实例用） */
  private static _nextId = 1
  /** 本实例 ID */
  readonly id: number

  public readonly scene: THREE.Scene
  public gameMode: GameMode | null = null

  /** UI 统一管理器（负责 HUD / UI Actor 的创建与管理，并持有 UI 独立场景 uiScene） */
  public readonly ui: UIManager

  private allActors = new Set<Actor>()
  private pendingSpawn: Actor[] = []
  private pendingDestroy: Actor[] = []
  /** Pawn 生成完成回调（commitSpawn 时触发，用于 GameMode 通知 Controller Possess） */
  private _pawnSpawnCallbacks: Array<{ pawn: Pawn; cb: (pawn: Pawn) => void }> = []
  private animationId: number | null = null
  private lastTime = 0
  private _running = false
  private _tickCallbacks: Array<(dt: number) => void> = []

  constructor(scene: THREE.Scene, gameMode?: GameMode) {
    super()
    this.id = World._nextId++
    this.scene = scene
    // UI 管理器：持有独立 UI 场景（透明背景，叠加渲染时保留主画面）
    this.ui = new UIManager(this)
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
  //  Actor 管理
  // ═══════════════════════════════════

  SpawnActor<T extends Actor>(actor: T): T {
    actor.world = this
    this.pendingSpawn.push(actor)
    return actor
  }

  private commitSpawn() {
    for (const actor of this.pendingSpawn) {
      // UI Actor 交给 UIManager 独立管理（不进 allActors）
      if (this.ui.isUIActor(actor)) {
        this.ui.addUIActor(actor)
      } else {
        this.allActors.add(actor)
        // 仅顶层 3D Actor 加到场景；已 attachTo 父的子 Actor 已在父 root 下
        if (!actor.parent) {
          this.scene.add(actor.root)
        }
        if (this._running) {
          actor.BeginPlay()
        }
      }
    }
    this.pendingSpawn = []
    // Pawn 生成完成回调（生成进世界后经 GameMode 通知 Controller Possess）
    if (this._pawnSpawnCallbacks.length > 0) {
      const callbacks = this._pawnSpawnCallbacks
      this._pawnSpawnCallbacks = []
      for (const { pawn, cb } of callbacks) {
        cb(pawn)
      }
    }
  }

  /**
   * 生成 Pawn 到世界：进入待生成队列，commitSpawn 实际生成后调用 onSpawned 回调。
   * 用于 GameMode.SpawnPlayer → World 生成 → 通知 Controller（Possess）的完整链路。
   */
  SpawnPawn(pawn: Pawn, onSpawned?: (pawn: Pawn) => void): Pawn {
    this.SpawnActor(pawn)
    if (onSpawned) {
      this._pawnSpawnCallbacks.push({ pawn, cb: onSpawned })
    }
    return pawn
  }

  DestroyActor(actor: Actor) {
    if (actor.bPendingDestroy) return
    // UI Actor 交给 UIManager 独立销毁
    if (this.ui.isUIActor(actor)) {
      this.ui.destroyUIActor(actor)
      return
    }
    if (!this.allActors.has(actor)) return
    actor.bPendingDestroy = true
    this.pendingDestroy.push(actor)
  }

  /**
   * 通用对象销毁入口（Object.destroy 调用）。
   * 场景对象（Actor）走 pendingDestroy 队列（tick 时提交清理）；
   * 非场景对象（GameMode/GameState/Controller 等）立即 EndPlay。
   */
  DestroyObject(obj: import('../entity/BObject').BObject): void {
    if (obj instanceof Actor) {
      this.DestroyActor(obj)
      return
    }
    if (obj.bPendingDestroy) return
    obj.bPendingDestroy = true
    obj.EndPlay()
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
  getAllActorComponents<T extends import('../entity/Component').Component>(
    type: new (...args: any[]) => T,
  ): T[] {
    const result: T[] = []
    for (const actor of this.allActors) {
      const comps = actor.getComponents(type)
      result.push(...comps)
    }
    return result
  }

  /**
   * 从 Blueprint 实例化一个 Actor 到世界（统一 Unity Prefab / UE Blueprint Class）。
   *
   * 注入时序（关键，全部在 SpawnActor / BeginPlay 之前完成）：
   *   1. resolve(id) → 扁平 CDO（继承链已合并）
   *   2. ActorRegistry.create(baseClass) 构造
   *   3. 应用继承链合并后的 position/rotation/scale
   *   4. 挂 Component（ComponentRegistry.create + addComponent）
   *   5. 递归子 Actor（各自 SpawnActorFromBlueprint 或 ActorRegistry.create + attachTo）
   *   6. applyPatch(overrides) 应用调用方覆盖
   *   7. 设 blueprintRef 元数据
   *   8. SpawnActor（进 pendingSpawn，后续 commitSpawn → BeginPlay）
   *
   * @param id        Blueprint id
   * @param overrides 实例级覆盖（position/rotation/scale/自定义参数）
   * @returns 生成的 Actor；解析或构造失败返回 null
   */
  SpawnActorFromBlueprint(path: string, overrides?: PropertyPatch): Actor | null {
    logger.info(`[World] SpawnActorFromBlueprint: 实例化 "${path}"`)
    let resolved
    try {
      resolved = BlueprintRegistry.resolve(path)
    } catch (e) {
      logger.error(`[World] SpawnActorFromBlueprint("${path}") 解析失败: ${(e as Error).message}`)
      return null
    }

    const actor = ActorRegistry.create(resolved.baseClass)
    if (!actor) {
      logger.error(`[World] SpawnActorFromBlueprint("${path}"): baseClass "${resolved.baseClass}" 未在 ActorRegistry 注册`)
      return null
    }
    logger.info(`[World] SpawnActorFromBlueprint("${path}"): baseClass="${resolved.baseClass}"，组件数=${resolved.components.length}，子节点数=${resolved.children.length}`)

    // 严格模式（组件优先）：蓝图根位置必须写在 transform/uitransform 组件。
    // 根级顶层 position/rotation/scale 是旧格式兜底，已废弃 —— 存在即报错
    const rootViolation = childTransformViolation({
      name: resolved.name,
      components: resolved.components,
      position: resolved.position,
      rotation: resolved.rotation,
      scale: resolved.scale,
    })
    if (rootViolation) {
      logger.error(`[World] SpawnActorFromBlueprint("${path}"): 根节点${rootViolation.slice(rootViolation.indexOf('：'))}`)
    }

    // 1. Transform（仅当蓝图根声明了变换组件时应用其 properties 值）
    const rootTsf = resolved.components.find((c) => c.baseClass === 'TransformComponent' || c.baseClass === 'UITransformComponent')
    if (rootTsf) {
      const p = rootTsf.properties ?? {}
      if (Array.isArray(p.position)) actor.setPosition(p.position[0], p.position[1], p.position[2])
      if (Array.isArray(p.rotation)) actor.setRotation(p.rotation[0], p.rotation[1], p.rotation[2])
      if (Array.isArray(p.scale)) actor.setScale(p.scale[0], p.scale[1], p.scale[2])
    }

    // 2. Component
    for (const cdef of resolved.components) {
      // [flow log] 根级组件 properties 入参（含 CanvasUIComponent.active）
      if (cdef.baseClass === 'CanvasUIComponent') {
        logger.info(`[World]   ┌ 根组件 "${cdef.baseClass}" properties=${JSON.stringify(cdef.properties ?? {})}`)
      }
      const comp = ComponentRegistry.create(actor, cdef.baseClass, cdef.properties)
      if (comp) {
        if (cdef.name) comp.name = cdef.name
        actor.addComponent(comp)
        logger.info(`[World]   └ 组件: "${cdef.baseClass}" name="${comp.name}"`)
      } else {
        logger.error(`[World] SpawnActorFromBlueprint("${path}"): Component 类型 "${cdef.baseClass}" 未注册，已跳过`)
      }
    }

    // 2.5 Transform 组件化约定：数据未显式配置时自动补挂（UI Actor 挂 UITransformComponent 含锚点能力）
    ensureTransformForActor(actor)

    // 3. 子 Actor
    const spawnChildObjects = (
      childDefs: typeof resolved.children,
      parentActor: Actor,
    ) => {
      for (let i = 0; i < childDefs.length; i++) {
        const child = childDefs[i]
        let childActor: Actor | null = null
        let isRefChild = false
        if (child.ref) {
          isRefChild = true
          // ref 引用：作为独立子 Actor 生成（类似 Unity 预制体）。
          // 严格模式（组件优先）：位置只写在被引用蓝图的 transform/uitransform 组件，
          // 子节点顶层 position/rotation/scale 不再注入 overrides（旧格式兜底已废弃，直接报错）
          const violation = childTransformViolation(child)
          if (violation) {
            logger.error(`[World] SpawnActorFromBlueprint("${path}"): ${violation}（ref 子节点）`)
          }
          const refOverrides: PropertyPatch = { ...(child.overrides ?? {}) }
          childActor = this.SpawnActorFromBlueprint(child.ref, refOverrides)
          if (childActor) childActor.isRefInstance = true
        } else if (child.baseClass) {
          childActor = ActorRegistry.create(child.baseClass)
          if (childActor) {
            if (child.overrides && Object.keys(child.overrides).length > 0) {
              childActor.applyPatch(child.overrides)
            }
            if (child.components) {
              const childName = child.name ?? `<inline#${i}>`
              for (const cdef of child.components) {
                // [flow log] 子节点组件 properties 入参（含 CanvasUIComponent.active）
                if (cdef.baseClass === 'CanvasUIComponent') {
                  logger.info(`[World]   ┌ 子节点 ${childName} 组件 "${cdef.baseClass}" properties=${JSON.stringify(cdef.properties ?? {})}`)
                }
                const comp = ComponentRegistry.create(childActor, cdef.baseClass, cdef.properties)
                if (comp) {
                  if (cdef.name) comp.name = cdef.name
                  childActor.addComponent(comp)
                } else {
                  logger.warn(`[World] SpawnActorFromBlueprint("${path}"): 子节点组件 "${cdef.baseClass}" 未注册，已跳过`)
                }
              }
            }
            // Transform 组件化约定：内联子 Actor 未显式配置时自动补挂
            ensureTransformForActor(childActor)
          }
        }
        // 纯容器节点（仅用来承载嵌套 children）
        if (!childActor && child.children?.length) {
          childActor = new GenericActor(child.name ?? `Container_${parentActor.name}`)
        }
        if (!childActor) {
          logger.warn(
            `[World] SpawnActorFromBlueprint("${path}"): 子节点生成失败 (baseClass=${child.baseClass ?? '-'})`,
          )
          continue
        }

        // Transform 组件化约定：容器节点也补挂变换组件
        ensureTransformForActor(childActor)

        childActor.attachTo(parentActor)

        // ref 子节点的 transform 已由被引用蓝图的 transform 组件负责。
        // 严格模式（组件优先）：内联子节点不再应用顶层 position/rotation/scale，
        // 缺组件却声明顶层字段的节点已在上方报错
        if (!isRefChild) {
          const violation = childTransformViolation(child)
          if (violation) {
            logger.error(`[World] SpawnActorFromBlueprint("${path}"): ${violation}`)
          }
        }

        if (child.name) {
          childActor.root.name = child.name
        }

        if (child.children && child.children.length > 0) {
          spawnChildObjects(child.children, childActor)
        }
      }
    }

    if (resolved.children.length > 0) {
      spawnChildObjects(resolved.children, actor)
    }

    // 4. 调用方实例覆盖
    if (overrides && Object.keys(overrides).length > 0) {
      actor.applyPatch(overrides)
    }

    // 5. 蓝图元数据
    actor.blueprintRef = { id: path, overrides }

    // 6. 进 World
    this.SpawnActor(actor)
    logger.info(`[World] SpawnActorFromBlueprint("${path}"): Actor "${actor.name}" 已生成（uid=${actor.uid}）`)
    return actor
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

    // 2. Tick 所有 3D Actor（UI Actor 由 UIManager 独立驱动）
    for (const actor of this.allActors) {
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
    logger.info(`[World#${this.id}] BeginPlay: 恢复运行（actorCount=${this.allActors.size}, pendingSpawn=${this.pendingSpawn.length}）`)
    this._running = true
    // 先提交等待生成的 Actor（否则 SpawnActorFromBlueprint 生成的 Actor 永远停在
    // pendingSpawn 队列，不进场景、不 BeginPlay，UI/游戏对象不会渲染）
    this.commitSpawn()
    this.commitDestroy()
    // UI 子系统恢复运行
    this.ui.beginPlay()
    for (const actor of this.allActors) {
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
    let count = this.allActors.size + this.pendingSpawn.length
    // 先清 UI 子系统
    const uiCount = this.ui.actorCount + this.ui.pendingSpawnCount
    this.ui.destroyAll()
    count += uiCount
    // 清理已提交的 3D Actor
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
    // 清理未触发的 Pawn 生成回调（世界已销毁，不再通知 Controller）
    this._pawnSpawnCallbacks = []
    logger.debug(`[World#${this.id}] DestroyAllActors: 销毁 ${count} 个 Actor`)
  }

  /** 手动触发一次 Tick（由外部渲染循环驱动） */
  manualTick(dt: number) {
    if (!this._running) return
    this.commitSpawn()
    this.commitDestroy()
    for (const actor of this.allActors) {
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
    logger.info(`[World#${this.id}] SwitchScene → ${newMode.constructor.name}（完成，actorCount=${this.allActors.size}）`)
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
   * 供外部调用（ScenePreviewManager 等）。
   */
  spawnInlineActor(node: import('../asset/SceneAsset').ActorNode): Actor | null {
    const actor = ActorRegistry.create(node.baseClass)
    if (!actor) {
      logger.warn(`[World] spawnInlineActor: baseClass "${node.baseClass}" 未注册`)
      return null
    }

    if (node.name) actor.root.name = node.name

    // 严格模式（组件优先）：内联 Actor 位置只写在 transform/uitransform 组件，
    // 顶层 position/rotation/scale 是旧格式兜底，存在即报错
    const violation = childTransformViolation({
      name: node.name,
      components: node.components,
      position: node.position,
      rotation: node.rotation,
      scale: node.scale,
    })
    if (violation) {
      logger.error(`[World] spawnInlineActor: ${violation}`)
    }

    // 挂 Component
    for (const cdef of (node.components ?? [])) {
      const comp = ComponentRegistry.create(actor, cdef.baseClass, cdef.properties)
      if (comp) {
        if (cdef.name) comp.name = cdef.name
        actor.addComponent(comp)
      } else {
        logger.warn(`[World] spawnInlineActor: Component "${cdef.baseClass}" 未注册，已跳过`)
      }
    }

    // Transform 组件化约定：内联 Actor 未显式配置时自动补挂
    ensureTransformForActor(actor)

    // 递归子节点
    this.spawnInlineChildren(node.children ?? [], actor)

    this.SpawnActor(actor)
    return actor
  }

  /** 递归 spawn 内联 ActorNode 的子节点 */
  private spawnInlineChildren(
    children: import('../asset/BlueprintAsset').BlueprintChildDef[],
    parentActor: Actor,
  ): void {
    for (const child of children) {
      let childActor: Actor | null = null
      let isRefChild = false

      if (child.ref) {
        // ref 引用 → 递归 SpawnActorFromBlueprint。
        // 严格模式（组件优先）：位置只写在被引用蓝图的 transform 组件，顶层字段不再注入 overrides
        isRefChild = true
        const violation = childTransformViolation(child)
        if (violation) {
          logger.error(`[World] spawnInlineChildren: ${violation}（ref 子节点）`)
        }
        const refOverrides: PropertyPatch = { ...(child.overrides ?? {}) }
        childActor = this.SpawnActorFromBlueprint(child.ref, refOverrides)
        if (childActor) childActor.isRefInstance = true
      } else if (child.baseClass) {
        // 内联 baseClass → 直接创建（位置由子节点 transform 组件负责，不再应用顶层字段）
        const violation = childTransformViolation(child)
        if (violation) {
          logger.error(`[World] spawnInlineChildren: ${violation}`)
        }
        childActor = ActorRegistry.create(child.baseClass)
        if (childActor) {
          if (child.overrides && Object.keys(child.overrides).length > 0) {
            childActor.applyPatch(child.overrides)
          }
          if (child.name) childActor.root.name = child.name
          // 挂组件
          for (const cdef of (child.components ?? [])) {
            const comp = ComponentRegistry.create(childActor, cdef.baseClass, cdef.properties)
            if (comp) {
              if (cdef.name) comp.name = cdef.name
              childActor.addComponent(comp)
            }
          }
          // Transform 组件化约定：内联子 Actor 未显式配置时自动补挂
          ensureTransformForActor(childActor)
        }
      }

      // 纯容器节点（只有 children，没有 baseClass / ref）
      if (!childActor && (child.children?.length ?? 0) > 0) {
        childActor = new GenericActor(child.name ?? `Container_${parentActor.name}`)
      }

      if (!childActor) {
        logger.warn(`[World] spawnInlineChildren: 子节点生成失败 (ref=${child.ref ?? '-'}, baseClass=${child.baseClass ?? '-'})`)
        continue
      }

      // Transform 组件化约定：容器节点也补挂变换组件
      ensureTransformForActor(childActor)

      childActor.attachTo(parentActor)
      if (child.children?.length) {
        this.spawnInlineChildren(child.children, childActor)
      }
    }
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
    // 从后往前销毁所有 3D Actor
    const all = [...this.allActors]
    for (let i = all.length - 1; i >= 0; i--) {
      all[i].EndPlay()
      this.scene.remove(all[i].root)
    }
    this.allActors.clear()
    this.pendingSpawn = []
    this.pendingDestroy = []
    this._tickCallbacks = []
    this._pawnSpawnCallbacks = []
    this.gameMode = null
  }
}
