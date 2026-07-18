/**
 * FishGameInstance — 捕鱼达人游戏实例
 * 三阶段流程：主菜单 → 海底基地 → 出海捕鱼。
 * 每个阶段使用独立的 GameMode 管理场景和生命周期，
 * 并通过场景资产（JSON）切换海底氛围。
 */
import * as THREE from 'three'
import React from 'react'
import { GameInstance, World, PhySys, logger, loadScene, CameraComponent, PlayerController } from '@/engine'
import type { GameInstanceCallbacks, WorldAsset, SceneAsset } from '@/engine'
import { FishMainMenuGameMode } from './menu/FishMainMenuGameMode'
import { FishBaseGameMode } from './base/FishBaseGameMode'
import { FishGameMode } from './game/FishGameMode'
import { FishPlayerController } from './game/FishPlayerController'
import type { FishCannon } from './game/FishCannon'
import { GameHud } from './game/hud/GameHud'
import { FishMainMenuUI } from './menu/hud/FishMainMenuUI'
import { FishBaseUI } from './base/hud/FishBaseUI'
import type { GameHudProps } from './game/hud/GameHud'
import menuSceneData from '../asset/fish_menu.scene.json'
import baseSceneData from '../asset/fish_base.scene.json'

type Phase = 'menu' | 'base' | 'game'

export class FishGameInstance extends GameInstance {
  readonly world: World
  readonly mainMenuGameMode: FishMainMenuGameMode
  readonly baseGameMode: FishBaseGameMode
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

  private _hudProps: GameHudProps = { coins: 100, score: 0, level: 1, bossActive: false, bossName: '', bossHp: 0, bossMaxHp: 0, phase: 'waiting' }
  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null
  /** 当前阶段的场景资产组 */
  private _sceneAsset: WorldAsset | null = null
  /** 竞技场（fish.scene.json）的 THREE.Group，由 Viewport 加载到共享场景中 */
  private _arenaGroup: THREE.Group | null = null

  constructor(sharedScene: THREE.Scene) {
    super()
    this.world = new World(sharedScene)

    // 在共享场景中查找竞技场 group（由 Viewport 加载的 fish.scene.json）
    for (const child of sharedScene.children) {
      if (child instanceof THREE.Group && child.name === 'FishMaster') {
        this._arenaGroup = child
        break
      }
    }

    // 主菜单 GameMode（初始）
    this.mainMenuGameMode = new FishMainMenuGameMode()
    this.world.SetGameMode(this.mainMenuGameMode)
    this.world.Stop()
    this.world.Pause()
    this.mainMenuGameMode.onStartGame = () => this.enterBase()

    // 基地 GameMode（预创建，不激活）
    this.baseGameMode = new FishBaseGameMode()
    this.baseGameMode.onStartFishing = () => this.startGameplay()
    this.baseGameMode.onClaimCoins = () => this.claimCoins()
  }

  override get controller(): PlayerController | null {
    return this._controller
  }

  override setCallbacks(cbs: GameInstanceCallbacks) {
    this.callbacks = cbs
  }

  // ════════════════════════════════════════════
  //  Phase: 主菜单
  // ════════════════════════════════════════════

  override start(): boolean {
    logger.info('[Fish] 显示主菜单...')
    this._phase = 'menu'
    this.world.Pause()
    this.world.BeginPlay()
    // 加载主菜单场景资产
    this.loadPhaseScene('menu')

    // 菜单相机
    this.setupCamera(this.mainMenuGameMode.gameCamera, 0, 0, 20)
    this.mainMenuGameMode.cameraManager.RegisterCamera(this.mainMenuGameMode.gameCamera)

    // ─── 创建菜单 Controller ───
    const menuSpawn = this.mainMenuGameMode.SpawnPlayer()
    if (menuSpawn) {
      menuSpawn.controller.Possess(menuSpawn.pawn)
      this._controller = menuSpawn.controller
    }

    this.ui?.renderReact(React.createElement(FishMainMenuUI, {
      onStartGame: () => this.mainMenuGameMode.startGame(),
    }))

    // 菜单阶段：隐藏竞技场（水下背景/水草等只属于 game 阶段）
    if (this._arenaGroup) this._arenaGroup.visible = false

    logger.info('[Fish] 等待玩家点击开始')
    return true
  }

  // ════════════════════════════════════════════
  //  Phase: 基地
  // ════════════════════════════════════════════

  private enterBase() {
    logger.info('[Fish] 进入基地...')
    this._phase = 'base'

    // 清理菜单残留
    this.world.DestroyAllActors()
    this.mainMenuGameMode.cameraManager.Clear()

    // 切换至基地 GameMode（會自動調用 InitGame + StartPlay + BeginPlay）
    this.world.SetGameMode(this.baseGameMode)

    // 加载基地场景资产
    this.loadPhaseScene('base')

    // 统计场景对象
    const sceneChildren = this.world.scene.children.length
    logger.debug(`[Fish] 进入基地后场景子对象数: ${sceneChildren}`)

    // 3D 基地相机
    this.setupCamera(this.baseGameMode.gameCamera, 8, 6, 10)
    this.baseGameMode.cameraManager.RegisterCamera(this.baseGameMode.gameCamera)
    const cam = this.baseGameMode.gameCamera.camera
    logger.debug(`[Fish] 基地相机位置: (${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)})`)

    // 物理系统绑定相机
    if (this.ui?.el) {
      PhySys.setup(this.baseGameMode.gameCamera.camera, this.ui.el)
    }

    // ─── 创建基地 Controller ───
    const baseSpawn = this.baseGameMode.SpawnPlayer()
    if (baseSpawn) {
      baseSpawn.controller.Possess(baseSpawn.pawn)
      this._controller = baseSpawn.controller
    }

    // 渲染基地 UI
    this.ui?.renderReact(React.createElement(FishBaseUI, {
      coins: this._coins,
      score: this._score,
      cannonLevel: this._lastCannonLevel,
      onStartFishing: () => this.baseGameMode.startFishing(),
    }))

    logger.info('[Fish] 已进入基地')
  }

  /** 领取初始金币 */
  private claimCoins() {
    this._coins = 100
    // 刷新基地 UI 显示
    this.ui?.renderReact(React.createElement(FishBaseUI, {
      coins: this._coins,
      score: this._score,
      cannonLevel: this._lastCannonLevel,
      onStartFishing: () => this.baseGameMode.startFishing(),
    }))
    logger.info(`[Fish] 领取初始金币，当前金币: ${this._coins}`)
  }

  // ════════════════════════════════════════════
  //  Phase: 出海捕鱼
  // ════════════════════════════════════════════

  private startGameplay(): boolean {
    logger.info('[Fish] 出海捕鱼...')
    this._phase = 'game'

    // 清理基地 Controller
    if (this._controller) {
      this._controller.Unpossess()
    }
    this._controller = null

    // 清理基地装饰
    this.baseGameMode.cameraManager.Clear()
    this.world.DestroyAllActors()

    // 创建并设置游戏 GameMode（SetGameMode 会自动 EndPlay baseGameMode）
    this._gameMode = new FishGameMode()
    this.world.SetGameMode(this._gameMode)

    // 恢复世界运行（returnToBase 中调用了 Pause，_running=false 导致后续 Actor 不 BeginPlay）
    this.world.BeginPlay()

    // 进入游戏阶段：移除菜单/基地场景（游戏使用 Viewport 加载的 arena 场景）
    this.unloadScene()

    // 显示竞技场（fish.scene.json 的水下场景）
    if (this._arenaGroup) this._arenaGroup.visible = true

    // 应用游戏场景氛围（fish.scene.json 的 skybox，由 Viewport 作为 arena 加载，
    // 但 arena 的 skybox 仅在项目加载时应用一次，此处显式设置以覆盖上一阶段）
    const scene = this.world.scene
    scene.background = new THREE.Color(0x0a2a4a)
    scene.fog = new THREE.Fog(0x0a2a4a, 20, 50)

    // 游戏相机
    this._gameMode.cameraManager.RegisterCamera(this._gameMode.gameCamera)
    this.setupCamera(this._gameMode.gameCamera, 0, 0, 20)

    // 同步持久数据
    this._gameMode.coins = this._coins

    // 生成玩家
    const spawn = this._gameMode.SpawnPlayer()
    if (!spawn) {
      logger.error('[Fish] SpawnPlayer 返回空')
      return false
    }
    const pawn = spawn.pawn as FishCannon
    this.world.SpawnActor(pawn)
    spawn.controller.Possess(pawn)
    this._controller = spawn.controller as FishPlayerController
    this.pawn = pawn

    // 监听 GameOver / 得分
    this.unsubGameState = this._gameMode.gameState.subscribe(() => {
      const gs = this._gameMode!.gameState
      this._score = gs.score
      this._coins = this._gameMode!.coins
      this._lastCannonLevel = this.pawn?.level ?? 1
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
      if (gs.phase === 'gameover' && !this._returningToBase) {
        this.callbacks.onGameOver?.()
        // Game Over 后返回基地
        this.returnToBase()
      }
    })

    this._hudProps = {
      coins: this._coins,
      score: this._score,
      level: pawn.level,
      bossActive: false,
      bossName: '',
      bossHp: 0,
      bossMaxHp: 0,
      phase: 'playing',
      onReturnToBase: () => this.manualReturnToBase(),
    }
    this.ui?.renderReact(React.createElement(GameHud, this._hudProps))

    this.callbacks.onPhaseChange?.('playing')
    logger.info('[Fish] 游戏已启动')
    return true
  }

  /** 玩家手动点击"返回基地" */
  private manualReturnToBase() {
    if (this._returningToBase || this._phase !== 'game') return
    this._returningToBase = true
    // 停止游戏世界逻辑
    if (this._gameMode) {
      this.world.Pause()
    }
    this.returnToBase()
  }

  /** 从游戏返回基地（Game Over / 手动返回） */
  private returnToBase() {
    logger.info('[Fish] 返回基地...')
    this._phase = 'base'

    // 隐藏竞技场（水草等只属于 game 阶段）
    if (this._arenaGroup) this._arenaGroup.visible = false

    // 清理游戏状态
    if (this._gameMode) {
      this._gameMode.cameraManager.Clear()
      this._gameMode = null
    }
    this.world.DestroyAllActors()
    if (this._controller) {
      this._controller.Unpossess()
    }
    this._controller = null
    this.pawn = null
    this._returningToBase = false

    // 重新切换至基地 GameMode（自動調用 InitGame + StartPlay + BeginPlay，重置裝飾）
    this.world.SetGameMode(this.baseGameMode)

    // 加载基地场景资产
    this.loadPhaseScene('base')

    // 3D 基地相机
    this.setupCamera(this.baseGameMode.gameCamera, 8, 6, 10)
    this.baseGameMode.cameraManager.RegisterCamera(this.baseGameMode.gameCamera)

    // 物理系统绑定相机
    if (this.ui?.el) {
      PhySys.setup(this.baseGameMode.gameCamera.camera, this.ui.el)
    }

    // ─── 创建基地 Controller ───
    const baseSpawn = this.baseGameMode.SpawnPlayer()
    if (baseSpawn) {
      baseSpawn.controller.Possess(baseSpawn.pawn)
      this._controller = baseSpawn.controller
    }

    // 渲染基地 UI（保留金币和分数）
    this.ui?.renderReact(React.createElement(FishBaseUI, {
      coins: this._coins,
      score: this._score,
      cannonLevel: this._lastCannonLevel,
      onStartFishing: () => this.baseGameMode.startFishing(),

    }))

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
      this._hudProps.coins = this._gameMode.coins
      this._hudProps.score = gs.score
      this._hudProps.level = this.pawn?.level ?? 1
      this._hudProps.bossActive = this._gameMode.bossActive
      const boss = this._gameMode.bossPawn
      this._hudProps.bossName = boss ? boss.config.name : ''
      this._hudProps.bossMaxHp = boss ? boss.config.hp : 0
      this._hudProps.bossHp = boss && !boss.captured ? boss.hp : 0
      this._hudProps.phase = gs.phase as GameHudProps['phase']
      this._hudProps.onReturnToBase = () => this.manualReturnToBase()
      this.ui?.renderReact(React.createElement(GameHud, this._hudProps))
    }
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number) {
    switch (this._phase) {
      case 'menu':
        this.mainMenuGameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
      case 'base':
        this.baseGameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
      case 'game':
        this._gameMode?.cameraManager.ApplyToRenderer(targetCamera, aspect)
        break
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

  // ════════════════════════════════════════════
  //  场景资产加载（按阶段切换 JSON 场景）
  // ════════════════════════════════════════════

  /** 加载当前阶段的场景资产并添加到共享场景 */
  private loadPhaseScene(phase: Phase) {
    this.unloadScene()
    const scene = this.world.scene
    let asset: WorldAsset | null = null

    switch (phase) {
      case 'menu':
        asset = loadScene(menuSceneData as SceneAsset)
        logger.debug(`[Fish] loadPhaseScene(menu): 加载完成`)
        break
      case 'base':
        asset = loadScene(baseSceneData as SceneAsset)
        logger.debug(`[Fish] loadPhaseScene(base): 加载完成, objects=${baseSceneData.objects.length}`)
        break
      case 'game':
        // 游戏阶段使用 fish.scene.json（由 Viewport 作为 arena 加载），此处不重复
        break
    }

    if (asset) {
      logger.debug(`[Fish] 添加场景资产组到 world.scene, group.children=${asset.group.children.length}`)
      scene.add(asset.group)

      // 应用 skybox 配置（背景色 + 雾效）
      if (asset.skybox) {
        if (asset.skybox.backgroundColor) {
          scene.background = new THREE.Color(asset.skybox.backgroundColor)
        }
        if (asset.skybox.fogColor) {
          scene.fog = new THREE.Fog(
            asset.skybox.fogColor,
            asset.skybox.fogNear ?? 30,
            asset.skybox.fogFar ?? 60,
          )
        }
      }

      this._sceneAsset = asset
    } else {
      logger.debug(`[Fish] loadPhaseScene(${phase}): asset 为空`)
    }
  }

  /** 卸载当前场景资产 */
  private unloadScene() {
    if (!this._sceneAsset) return
    const scene = this.world.scene
    scene.remove(this._sceneAsset.group)
    this._sceneAsset.dispose()

    // 重置场景氛围到中性默认值
    scene.background = new THREE.Color(0x1a1a2e)
    scene.fog = new THREE.Fog(0x1a1a2e, 30, 60)

    logger.debug(`[Fish] unloadScene: ${this._sceneAsset.name} 已卸载`)
    this._sceneAsset = null
  }

  override stop() {
    this.unloadScene()
    // 恢复竞技场显示
    if (this._arenaGroup) this._arenaGroup.visible = true
    logger.info('[Fish] 停止游戏...')
    this.world.DestroyAllActors()
    this.world.Pause()
    this.mainMenuGameMode.cameraManager.Clear()
    this.baseGameMode.cameraManager.Clear()
    if (this._gameMode) this._gameMode.cameraManager.Clear()
    this._controller = null
    this.pawn = null
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
