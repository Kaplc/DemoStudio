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
import { ObjectRegistry } from '../tools/ObjectRegistry'
import { ThreeObjectFactory } from './ThreeObjectFactory'
import { ThreeObject } from '../rendering/ThreeObject'
import type { OObject } from '../entity/OObject'
import type { PropertyPatch } from '../tools/deepMerge'
import type { SceneAsset } from '../asset/SceneAsset'
import type { Actor } from '../entity/Actor'
import type { Pawn } from '../entity/Pawn'

/**
 * 看门狗检查间隔（ms）：每 100ms 检查一次外部驱动是否停摆。
 * 开销极小（一次时间戳比较），不影响正常帧循环。
 */
const WATCHDOG_CHECK_MS = 100
/**
 * 外部驱动停摆判定阈值（ms）：距上次 manualTick 超过该值即视为 rAF 已暂停
 * （页面 hidden/最小化）。正常 60fps 间隔 ~16ms，低帧率（10fps=100ms）也不误判。
 */
const WATCHDOG_IDLE_MS = 250
/** 看门狗接管时的降频驱动步长（秒）：~30fps，省电且足以支撑逻辑运行 */
const WATCHDOG_FALLBACK_DT = 1 / 30

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
  /**
   * 看门狗：外部驱动（Scene 视口 rAF → GameInstance.tick → manualTick）停摆时
   * 自行降频驱动 tick。页面 hidden（最小化/后台标签/Playwright 隐藏页面）时浏览器
   * 暂停 rAF，若不兜底，游戏逻辑（UI 面板 spawn 提交/BeginPlay/脚本挂载、按钮、
   * 动画、后台模拟）会完全停摆。不依赖 visibilitychange 事件（部分环境不派发），
   * 纯检测实际 tick 间隔：距上次 manualTick 超过阈值即接管。
   */
  private watchdogId: number | null = null
  /** 最近一次外部驱动 tick（manualTick）的时间戳，watchdog 据此判断是否停摆 */
  private lastExternalTickTime = 0
  private _tickCallbacks: Array<(dt: number) => void> = []

  /**
   * THREE 对象工厂（统一创建 + 追踪释放，禁止裸 new THREE.xxx）。
   * 由 World 的 createXxx 工厂方法使用；World.Destroy 时 disposeAll 兜底回收。
   */
  readonly factory = new ThreeObjectFactory()

  /** 创建时的调用栈摘要（泄漏诊断用：精确定位是哪个 Manager/代码创建了本 World） */
  readonly creationStack: string

  constructor(scene: THREE.Scene, gameMode?: GameMode) {
    super()
    this.id = World._nextId++
    // 记录创建调用栈：跳过 Error 帧 + 本构造器帧，从调用方（new World 的 Manager/GameInstance）开始取 3 层
    const stackLines = new Error().stack?.split('\n') ?? []
    this.creationStack = stackLines
      .slice(2, 5)
      .map((s) => s.trim().replace(/^at /, ''))
      .join(' ← ')
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
    this.assertValid('调用 SetGameMode') // 已销毁 World 不应再被驱动（旧实例闭包路径）
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
    this.assertValid('调用 SpawnActor') // 已销毁 World 不应再生成对象
    return this.actorMgr.SpawnActor(actor)
  }

  /**
   * 按类型生成 Actor：组件内自动 new + 入队（无需手动 new + SpawnActor 两步）。
   * 通用机制，不感知具体 Actor 类：如 `world.SpawnActorOfType(PlaceGridActor, 'PlaceGrid', {...})`。
   */
  SpawnActorOfType<T extends Actor, A extends unknown[]>(
    type: new (name: string, ...args: A) => T,
    name: string,
    ...args: A
  ): T {
    this.assertValid('调用 SpawnActorOfType') // 已销毁 World 不应再生成对象
    return this.actorMgr.SpawnActorOfType(type, name, ...args)
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
    this.assertValid('调用 SpawnActorFromBlueprint')
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
    this.stopWatchdog()
  }

  /**
   * 启动看门狗：每 100ms 检查一次外部驱动是否停摆（距上次 manualTick 超过
   * WATCHDOG_IDLE_MS 阈值 → 页面隐藏/最小化，rAF 已暂停），停摆则自行降频
   * （~30fps）驱动 tick；外部驱动恢复后自动静默（manualTick 刷新时间戳）。
   */
  private startWatchdog(): void {
    if (this.watchdogId !== null) return
    this.lastExternalTickTime = performance.now()
    this.watchdogId = window.setInterval(() => {
      if (!this._running) return
      const now = performance.now()
      if (now - this.lastExternalTickTime < WATCHDOG_IDLE_MS) return
      // 外部驱动停摆：自行降频驱动（dt 用固定步长，与外部驱动错开避免双倍速）
      this.lastExternalTickTime = now
      this.tick(WATCHDOG_FALLBACK_DT)
    }, WATCHDOG_CHECK_MS)
    logger.info('[World] tick 看门狗已启动（外部驱动停摆时自动降频兜底）')
  }

  private stopWatchdog(): void {
    if (this.watchdogId === null) return
    clearInterval(this.watchdogId)
    this.watchdogId = null
    logger.info('[World] tick 看门狗已停止')
  }

  private tick(dt: number) {
    // 1. 处理待生成/销毁（ActorManagerComponent）
    this.commitActorChanges()

    // 2. Tick 所有 3D Actor（UI Actor 由 UIManager 独立驱动）
    for (const actor of this.actorMgr.GetAllActors()) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }

    // 3. Tick UI 子系统
    this.ui.tickUI(dt)
    // UI Actor 列表变化（提交/销毁）也通知大纲
    if (this.ui.consumeUiListDirty()) {
      this.notifyActorListChanged()
    }

    // 4. Tick GameMode（内部统一驱动 GameState + Controller + 摄像机）
    this.gameMode?.Tick(dt)

    // 5. 外部回调
    for (const cb of this._tickCallbacks) {
      cb(dt)
    }
  }

  /**
   * 提交待生成/待销毁队列，并在 Actor 列表实际变化时触发 onActorListChanged 通知。
   * （大纲等编辑器 UI 订阅该事件自动刷新；无变化时零开销）
   */
  private commitActorChanges(): void {
    this.actorMgr.commitSpawn()
    this.actorMgr.commitDestroy()
    if (this.actorMgr.consumeActorListDirty()) {
      this.notifyActorListChanged()
    }
  }

  /** 标记运行但不启动自己的 rAF（由外部驱动 render/update 时使用） */
  BeginPlay() {
    logger.info(`[World#${this.id}] BeginPlay: 恢复运行（actorCount=${this.actorMgr.actorCount}, pendingSpawn=${this.actorMgr.pendingSpawnCount}）`)
    this._running = true
    // 先提交等待生成的 Actor（否则 SpawnActorFromBlueprint 生成的 Actor 永远停在
    // pendingSpawn 队列，不进场景、不 BeginPlay，UI/游戏对象不会渲染）
    this.commitActorChanges()
    // UI 子系统恢复运行
    this.ui.beginPlay()
    // UI Actor 列表变化（HUD/UI 提交）也通知大纲
    if (this.ui.consumeUiListDirty()) {
      this.notifyActorListChanged()
    }
    for (const actor of this.actorMgr.GetAllActors()) {
      if (!actor.bHasBegunPlay) actor.BeginPlay()
    }
    // GameMode（其 BeginPlay 内部统一驱动 GameState + Controller）
    if (this.gameMode && !this.gameMode.bHasBegunPlay) this.gameMode.BeginPlay()
    // 看门狗：外部驱动（rAF）停摆时自动兜底驱动 tick（见 startWatchdog）
    this.startWatchdog()
  }

  /** 暂停运行（外部驱动模式） */
  Pause() {
    logger.info('[World] Pause: 暂停运行')
    this._running = false
  }

  /** 销毁所有 3D Actor 与 UI Actor（Controller 由 GameMode.EndPlay 负责） */
  DestroyAllActors() {
    this.actorMgr.DestroyAllActors()
    // 批量销毁后立即通知（无 tick 驱动的场景下大纲也能刷新）
    if (this.actorMgr.consumeActorListDirty()) {
      this.notifyActorListChanged()
    }
  }

  /** 手动触发一次 Tick（由外部渲染循环驱动） */
  manualTick(dt: number) {
    if (!this._running) return
    // 刷新看门狗时间戳：外部驱动正常工作（rAF 未停摆），watchdog 保持静默
    this.lastExternalTickTime = performance.now()
    this.commitActorChanges()
    for (const actor of this.actorMgr.GetAllActors()) {
      if (!actor.bPendingDestroy) actor.Tick(dt)
    }
    // UI 子系统（与 tick() 一致）：运行时 spawnUIActor 生成的 UI Actor 依赖此处
    // 提交（BeginPlay / UIScriptComponent 初始化），否则永远停在待生成队列
    this.ui.tickUI(dt)
    if (this.ui.consumeUiListDirty()) {
      this.notifyActorListChanged()
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
  //  Actor 列表变化监听（编辑器大纲刷新）
  // ═══════════════════════════════════

  /** Actor 列表变化监听（SpawnActor 提交 / 销毁提交时触发，编辑器大纲等订阅自动刷新） */
  private _actorListChangedListeners = new Set<() => void>()

  /**
   * 订阅 Actor 列表变化（Actor 实际生成进世界 / 销毁时触发，无变化时不会触发）。
   * @returns 取消订阅函数
   */
  onActorListChanged(cb: () => void): () => void {
    this._actorListChangedListeners.add(cb)
    return () => {
      this._actorListChangedListeners.delete(cb)
    }
  }

  /** 触发 Actor 列表变化通知（commitActorChanges / DestroyAllActors 在列表实际变化后调用） */
  private notifyActorListChanged(): void {
    for (const cb of this._actorListChangedListeners) {
      cb()
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
  SwitchScene(newMode: GameMode, setup?: () => void, baseline?: ReadonlySet<OObject>): void {
    // 切换前基线：记录当前存活对象（旧场景对象应随切换全部回收）。
    // 传入基线优先（SwitchToScene 在创建 newMode 之前记录）；
    // 直接调用时兜底：排除 newMode 及其从属（调用方在进入本方法前已创建）
    const b = baseline ?? new Set(ObjectRegistry.snapshot().filter((o) => !this.ownedBy(o, newMode)))
    const oldModeName = this.gameMode?.constructor.name ?? '无'
    logger.info(`[World#${this.id}] SwitchScene: 暂停世界 → 销毁旧 Actor → 切换 GameMode(${newMode.constructor.name})`)
    this.Pause()
    this.DestroyAllActors()
    // 强诊断：旧场景 Actor 集合应已清空（在 setup 之前检查，因为 setup 会生成新 Actor）
    const leftover3D = this.actorMgr.actorCount + this.actorMgr.pendingSpawnCount
    const leftoverUI = this.ui.actorCount + this.ui.pendingSpawnCount
    if (leftover3D > 0 || leftoverUI > 0) {
      logger.warn(`[World#${this.id}] SwitchScene 残留诊断：旧场景 Actor 集合未清空（3D=${leftover3D}, UI=${leftoverUI}）`)
    }
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
    // 软诊断：基线中仍存活且归属于本 World 的 BObject = 旧场景对象泄漏
    const residual = ObjectRegistry.aliveGameObjectsOf(b, this)
    if (residual.length > 0) {
      const byClass = new Map<string, number>()
      for (const o of residual) {
        const cls = (o.constructor as { name?: string })?.name ?? 'Unknown'
        byClass.set(cls, (byClass.get(cls) ?? 0) + 1)
      }
      const summary = [...byClass.entries()].map(([c, n]) => `${c}×${n}`).join(', ')
      logger.warn(`[World#${this.id}] SwitchScene 残留诊断：${residual.length} 个旧场景对象未回收（${summary}）`)
      // 按根分组打印归属链（owner/parent 链 → 根），定位泄漏根对象
      const groups = new Map<string, { root: string; items: Array<{ obj: string; chain: string }> }>()
      for (const o of residual) {
        const anyObj = o as { name?: string; uid?: number; owner?: unknown; parent?: unknown }
        const chain: string[] = []
        const seen = new Set<unknown>()
        let cur: unknown = o
        while (cur && !seen.has(cur) && chain.length < 16) {
          seen.add(cur)
          const c = cur as { constructor?: { name?: string }; name?: string; uid?: number; owner?: unknown; parent?: unknown }
          chain.push(`${c.constructor?.name ?? '?'}(${c.name ?? '?'},uid=${c.uid ?? '?'})`)
          // 优先父链（Actor 树），其次 owner 链（组件 → 宿主）→ 根
          cur = (cur as { parent?: unknown }).parent ?? (cur as { owner?: unknown }).owner ?? null
        }
        const root = chain[chain.length - 1] ?? '?'
        const desc = `${(o.constructor as { name?: string })?.name ?? '?'} name=${anyObj.name ?? '?'} uid=${anyObj.uid}`
        const g = groups.get(root) ?? { root, items: [] }
        g.items.push({ obj: desc, chain: chain.join(' ← ') })
        groups.set(root, g)
      }
      for (const [, g] of groups) {
        logger.warn(`[World#${this.id}]   ┌ 根 ${g.root}（该根下 ${g.items.length} 个残留对象）`)
        for (const item of g.items) {
          logger.warn(`[World#${this.id}]   │   ${item.obj}`)
          logger.warn(`[World#${this.id}]   │     链: ${item.chain}`)
        }
        logger.warn(`[World#${this.id}]   └──`)
      }
    } else {
      logger.info(`[World#${this.id}] SwitchScene 残留诊断：旧场景对象全部回收（旧 GameMode=${oldModeName}）`)
    }
    logger.info(`[World#${this.id}] SwitchScene → ${newMode.constructor.name}（完成，actorCount=${this.actorMgr.actorCount}）`)
  }

  /**
   * 判断 obj 是否属于 target 的从属链（obj === target，或沿 owner 链向上到达 target）。
   * 用于 SwitchScene 基线过滤：排除调用方提前创建的新 GameMode 及其组件。
   */
  private ownedBy(obj: OObject, target: OObject): boolean {
    let cur: unknown = obj
    let hops = 0
    while (cur && hops < 32) {
      if (cur === target) return true
      cur = (cur as { owner?: unknown }).owner ?? null
      hops++
    }
    return false
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
    this.assertValid('调用 SwitchToScene') // 已销毁 World 被旧闭包驱动会污染共享场景
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
    // 基线在 GameMode 创建之前记录：newMode 构造期间创建的一切（如 BaseCameraActor）
    // 属于"新场景对象"，不应被 SwitchScene 残留诊断误报为旧场景残留
    const baseline = new Set(ObjectRegistry.snapshot())
    const newMode = GameModeRegistry.create(mode)!
    logger.info(`[World#${this.id}] SwitchToScene: 创建 GameMode "${newMode.constructor.name}"，开始切换...`)
    this.SwitchScene(newMode, () => {
      this.loadSceneAsActors(sceneAsset)
      extraSetup?.()
    }, baseline)
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

  /**
   * 创建一个胶囊体网格（兵种等角色模型；length=0 时为纯球）。
   * 几何体中心在胶囊体中心，贴地偏移由调用方控制（如 position.y = radius + length/2）。
   */
  createCapsuleMesh(radius: number, length: number, color: number, transparent?: boolean, opacity?: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, Math.max(0, length), 4, 12),
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

  /**
   * 创建一个平面网格线框（基础划线工具：仅提供从 min 到 max 每 step 一条线的能力，
   * 具体格子坐标/偏移规则由调用方（游戏）自行计算）。水平面 y=0，含边界。
   * 经工厂统一生成（追踪释放），挂到 LineComponent/GridActor 后随 actor 生命周期释放。
   *
   * 注意：返回的是 ThreeObject（外层包装），调用方应直接传给 LineComponent 等
   * ThreeObjectComponent，避免再次包装导致工厂追踪链断裂（产生 Destroy 时的泄漏告警）。
   * @param min 网格范围最小值（含）
   * @param max 网格范围最大值（含）
   * @param step 线间距
   */
  createGridLines(min: number, max: number, step: number, color: number, transparent?: boolean, opacity?: number): ThreeObject<THREE.LineSegments> {
    return this.factory.createGridLines(min, max, step, color, transparent, opacity)
  }

  // ═══════════════════════════════════
  //  清理
  // ═══════════════════════════════════

  Destroy() {
    this.Stop()
    // 诊断：销毁前遍历场景，找出未被 Actor 跟踪的 THREE 对象（排查泄漏/未生成对象）
    const orphans = this.actorMgr.findOrphanObjects()
    if (orphans.length > 0) {
      logger.warn(`[World#${this.id}] Destroy: ${orphans.length} 个未被 Actor 跟踪的 THREE 对象:`)
      for (const o of orphans) {
        logger.warn(
          `  - [${o.sceneName}] ${o.obj.type} "${o.obj.name || '(无名)'}" 链=${o.chain} ` +
          `pos=(${o.obj.position.x.toFixed(2)}, ${o.obj.position.y.toFixed(2)}, ${o.obj.position.z.toFixed(2)})`,
        )
      }
    } else {
      logger.info(`[World#${this.id}] Destroy: 所有场景对象均被 Actor 跟踪（无孤儿）`)
    }
    // 清理 UI 子系统
    this.ui.destroyAll()
    // GameMode（其 EndPlay 内部统一驱动 GameState + Controller）
    this.gameMode?.EndPlay()
    // 销毁所有 3D Actor（ActorManagerComponent 负责集合与场景移除）
    this.actorMgr.DestroyAllActors()
    this._tickCallbacks = []
    this.gameMode = null
    // 兜底回收：遍历全局对象注册表，回收所有归属于本 World 的对象
    // （GameState / Controller / World 自身组件 / 任何漏网的 BObject 等）
    ObjectRegistry.reclaimForWorld(this)
    // 清理 Game 视口渲染器（由 World 创建，随 World 销毁）
    this.gameRenderer?.dispose()
    // 工厂兜底回收：经本 World 工厂创建但未随 actor 释放的 THREE 对象
    // （正常路径由组件 EndPlay 释放，这里兜底未释放的孤儿）
    const factoryOrphans = this.factory.disposeAll()
    if (factoryOrphans.length > 0) {
      logger.warn(`[World#${this.id}] Destroy: 工厂兜底回收 ${factoryOrphans.length} 个未释放 THREE 对象（组件销毁链路异常或未挂载）`)
    }
  }
}
