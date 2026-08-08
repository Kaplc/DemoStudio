/**
 * FishGameInstance — 捕鱼达人游戏实例
 * 三阶段流程：主菜单 → 海底基地 → 出海捕鱼。
 * 每个阶段使用独立的 GameMode 管理场景和生命周期，
 * 并通过场景资产（JSON）切换海底氛围。
 */
import * as THREE from 'three'
import { GameInstance, World, PhySys, logger, CameraComponent, PlayerController } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { UIButtonComponent } from '@/engine/ui/UIButtonComponent'
import { FishMainMenuGameMode } from './menu/FishMainMenuGameMode'
import { FishBaseGameMode } from './base/FishBaseGameMode'
import { FishGameMode } from './game/FishGameMode'
import { FishPlayerController } from './game/FishPlayerController'
import type { FishCannon } from './game/FishCannon'

type Phase = 'menu' | 'base' | 'game'

export class FishGameInstance extends GameInstance {
  readonly world: World

  /** 各阶段 GameMode 引用（由 SwitchToScene 创建后存入，供 syncCamera 等使用） */
  private _menuGameMode: FishMainMenuGameMode | null = null
  private _baseGameMode: FishBaseGameMode | null = null
  private _gameMode: FishGameMode | null = null

  private _phase: Phase = 'menu'
  private _controller: PlayerController | null = null
  pawn: FishCannon | null = null

  /** 跨阶段持久数据 */
  private _coins = 100
  private _score = 0
  private _lastCannonLevel = 1
  /** 防止手动返回和 GameOver 回调重复触发 */
  private _returningToBase = false

  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null
  /** 防止 stop() 被重复调用 */
  private _stopped = false

  constructor(sharedScene: THREE.Scene) {
    super()
    this.world = new World(sharedScene)
    // GameMode 实例由 start() / SwitchToScene 按需创建
  }

  override get controller(): PlayerController | null {
    return this._controller
  }

  override setCallbacks(cbs: GameInstanceCallbacks) {
    this.callbacks = cbs
  }

  // ════════════════════════════════════════════
  //  Phase 路由：根据 initialMode 决定启动哪个阶段
  // ════════════════════════════════════════════

  override start(): boolean {
    logger.info(`[Fish] 游戏实例启动, initialMode=${this.initialMode ?? '(未设置, 默认 menu)'}`)
    if (this.initialMode === 'base') return this.switchToPhase('base')
    if (this.initialMode === 'game') return this.switchToPhase('game')
    return this.switchToPhase('menu')
  }

  /**
   * 通用阶段切换：通过 World.SwitchToScene(name) 自动从 AssetRegistry 查找场景资产。
   * SwitchToScene 内部：Pause → DestroyAllActors → SetGameMode → loadSceneAsActors → extraSetup → BeginPlay
   */
  private switchToPhase(phase: Phase): boolean {
    this._phase = phase
    const sceneName = phase === 'menu' ? 'FishMenu' : phase === 'base' ? 'FishBaseIsland' : 'FishMaster'
    logger.info(`[Fish] 切换阶段 → ${phase} (场景: ${sceneName})`)

    const ok = this.world.SwitchToScene(sceneName, () => {
      switch (phase) {
        case 'menu': this.setupMenuPhase(); break
        case 'base': this.setupBasePhase(); break
        case 'game': this.setupGamePhase(); break
      }
    })
    if (!ok) logger.error(`[Fish] 切换阶段失败 → ${phase}`)
    return ok
  }

  /** 菜单阶段设置（在 SwitchToScene extraSetup 中执行，世界处于暂停态） */
  private setupMenuPhase(): void {
    logger.info('[Fish] setupMenuPhase: 配置主菜单...')
    const mode = this.world.gameMode as FishMainMenuGameMode
    this._menuGameMode = mode
    mode.onStartGame = () => this.enterBase()
    this.setupCamera(mode.gameCamera, 0, 0, 20)
    mode.cameraManager.RegisterCamera(mode.gameCamera)
    const spawn = mode.SpawnPlayer()
    if (spawn) { spawn.controller.Possess(spawn.pawn); this._controller = spawn.controller }
    else logger.error('[Fish] setupMenuPhase: SpawnPlayer 返回空')

    // UI 点击：初始化 PhySys 射线检测（相机 + 屏幕坐标换算容器）
    if (this.ui?.el) PhySys.setup(mode.gameCamera.camera, this.ui.el)

    // 把 HUD 中所有 UIButtonComponent 的点击接到"开始游戏"
    const uiTree = this.world.ui.hud?.uiActor
    if (uiTree) {
      const bindButtons = (actor: import('@/engine').Actor) => {
        for (const comp of actor.getComponents(UIButtonComponent)) {
          if (comp.onClick) continue
          comp.onClick = () => mode.onStartGame?.()
          logger.info(`[Fish] 菜单按钮绑定 onClick: ${actor.name}`)
        }
        for (const child of actor.getChildren()) bindButtons(child)
      }
      bindButtons(uiTree)
    }
    logger.info('[Fish] setupMenuPhase: 完成（等待玩家点击开始）')
  }

  /** 基地阶段设置 */
  private setupBasePhase(): void {
    logger.info('[Fish] setupBasePhase: 配置部落冲突基地...')
    const mode = this.world.gameMode as FishBaseGameMode
    this._baseGameMode = mode
    mode.onStartFishing = () => this.startGameplay()
    mode.onClaimCoins = () => this.claimCoins()
    // 部落冲突基地：游戏自己的摄像机 actor（BaseCameraActor，每 new 一次都是新摄像机）
    this.setupCamera(mode.baseCamera.cameraComponent, 12, 16, 18)
    mode.cameraManager.RegisterCamera(mode.baseCamera.cameraComponent)
    if (this.ui?.el) PhySys.setup(mode.baseCamera.camera, this.ui.el)
    const spawn = mode.SpawnPlayer()
    if (spawn) {
      spawn.controller.Possess(spawn.pawn)
      this._controller = spawn.controller
      logger.info(`[Fish] setupBasePhase: controller 已切换 → ${spawn.controller.root.name}（pawn=${spawn.pawn.root.name}）`)
    }
    else logger.error('[Fish] setupBasePhase: SpawnPlayer 返回空')

    // 基地 HUD 的建筑菜单按钮绑定由 widget 资产上挂载的 BaseHudScript
    // （UIScriptComponent, script="gameplay/base/BaseHud"）在 BeginPlay 时接管，
    // 这里不再手写遍历 UI 树绑定——UI 结构（资产）与行为（脚本）解耦。
    logger.info('[Fish] setupBasePhase: 完成（已进入基地，HUD 按钮由 BaseHudScript 绑定）')
  }

  /** 游戏阶段设置 */
  private setupGamePhase(): void {
    logger.info('[Fish] setupGamePhase: 配置出海捕鱼...')
    const mode = this.world.gameMode as FishGameMode
    this._gameMode = mode
    mode.coins = this._coins
    mode.cameraManager.RegisterCamera(mode.gameCamera)
    this.setupCamera(mode.gameCamera, 0, 0, 20)

    const spawn = mode.SpawnPlayer()
    if (!spawn) { logger.error('[Fish] SpawnPlayer 返回空'); return }
    const pawn = spawn.pawn as FishCannon
    this.world.SpawnActor(pawn)
    spawn.controller.Possess(pawn)
    this._controller = spawn.controller as FishPlayerController
    this.pawn = pawn

    this.unsubGameState = mode.gameState.subscribe(() => {
      const gs = mode.gameState
      this._score = gs.score
      this._coins = mode.coins as number
      this._lastCannonLevel = this.pawn?.level ?? 1
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
      if (gs.phase === 'gameover' && !this._returningToBase) {
        this.callbacks.onGameOver?.()
        this.returnToBase()
      }
    })

    this.callbacks.onPhaseChange?.('playing')
    logger.info('[Fish] 游戏已启动')
  }

  /** 领取初始金币 */
  private claimCoins() {
    this._coins = 100
    logger.info(`[Fish] 领取初始金币，当前金币: ${this._coins}`)
  }

  // ════════════════════════════════════════════
  //  阶段路由
  // ════════════════════════════════════════════

  /** 切换到菜单阶段 */
  private startMenuMode(): boolean {
    logger.info('[Fish] 显示主菜单...')
    return this.switchToPhase('menu')
  }

  /** 进入基地（从菜单） */
  private enterBase() {
    logger.info('[Fish] 进入基地...')
    this.switchToPhase('base')
  }

  /** 出海捕鱼 */
  private startGameplay(): boolean {
    logger.info('[Fish] 出海捕鱼...')
    this._phase = 'game'
    if (this._controller) { this._controller.Unpossess(); this._controller = null }
    this._baseGameMode?.cameraManager.Clear()
    return this.switchToPhase('game')
  }

  /** 从游戏返回基地（Game Over / 手动返回） */
  private returnToBase() {
    logger.info('[Fish] 返回基地...')
    this._phase = 'base'

    if (this.unsubGameState) { this.unsubGameState(); this.unsubGameState = null }
    if (this._gameMode) { this._gameMode.cameraManager.Clear(); this._gameMode = null }
    if (this._controller) { this._controller.Unpossess(); this._controller = null }
    this.pawn = null
    this._returningToBase = false

    this.switchToPhase('base')
    logger.info(`[Fish] 返回基地，当前金币: ${this._coins}`)
  }

  // ════════════════════════════════════════════
  //  Tick / 渲染
  // ════════════════════════════════════════════

  override tick(dt: number) {
    if (this._phase === 'menu') return

    if (this._phase === 'base') {
      this.world.manualTick(dt)
      return
    }

    if (this._phase === 'game' && this._gameMode) {
      this.world.manualTick(dt)
      const gs = this._gameMode.gameState
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
    }
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number) {
    switch (this._phase) {
      case 'menu':
        this._menuGameMode?.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
      case 'base':
        this._baseGameMode?.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
      case 'game':
        this._gameMode?.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
    }
  }

  /** 渲染器委托：返回当前阶段的主摄像机（游戏自己创建的摄像机 actor） */
  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    switch (this._phase) {
      case 'menu': return this._menuGameMode?.cameraManager.GetActiveCameraObject() ?? null
      case 'base': return this._baseGameMode?.cameraManager.GetActiveCameraObject() ?? null
      case 'game': return this._gameMode?.cameraManager.GetActiveCameraObject() ?? null
      default: return null
    }
  }

  // onPointerDown / onPointerMove 已由各阶段的 PlayerController 处理
  // （FishBasePlayerController / FishMainMenuPlayerController / FishPlayerController）

  /** 设置相机位置和朝向，并同步到 Actor root（避免 SyncFromActor 覆盖） */
  private setupCamera(cameraComp: CameraComponent, x: number, y: number, z: number) {
    const cam = cameraComp.camera
    cam.position.set(x, y, z)
    cam.lookAt(0, 0, 0)
    if ('updateProjectionMatrix' in cam) cam.updateProjectionMatrix()
    // 将相机 transform 写回 Actor root，否则每帧 SyncFromActor 会覆盖
    cameraComp.SyncToActor()
  }

  override stop() {
    if (this._stopped) return
    this._stopped = true
    logger.info('[Fish] 停止游戏...')
    this.world.gameMode?.EndPlay()
    this.world.gameMode = null
    this.world.DestroyAllActors()
    this.world.scene.background = new THREE.Color(0x1a1a2e)
    this.world.Pause()
    this._menuGameMode?.cameraManager.Clear()
    this._baseGameMode?.cameraManager.Clear()
    this._gameMode?.cameraManager.Clear()
    this._controller = null
    this.pawn = null
    this._menuGameMode = null
    this._baseGameMode = null
    this._gameMode = null
    this._phase = 'menu'
  }

  override destroy() {
    this.stop()
    if (this.unsubGameState) {
      this.unsubGameState()
      this.unsubGameState = null
    }
    this.world.Destroy()
  }
}
