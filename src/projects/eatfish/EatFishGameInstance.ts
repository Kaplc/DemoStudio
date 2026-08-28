/**
 * EatFishGameInstance — 大鱼吃小鱼游戏实例
 * 封装 World + GameMode + 玩家生命周期
 */
import * as THREE from 'three'
import { GameInstance, logger } from '@/engine'
import type { PlayerController } from '@/engine'
import { EatFishGameMode, EatFishPawn, EatFishPlayerController } from './'
import { EatFishConfigLoader } from './EatFishConfigLoader'

export class EatFishGameInstance extends GameInstance {
  private _gameMode!: EatFishGameMode
  override get gameMode(): EatFishGameMode { return this._gameMode }
  override createGameMode(): EatFishGameMode { return this._gameMode = new EatFishGameMode() }

  private _controller: EatFishPlayerController | null = null
  pawn: EatFishPawn | null = null

  override get controller(): EatFishPlayerController | null {
    return this._controller
  }

  constructor() {
    super()
    const scene = this.world.sceneComp.scene

    // 设置水下场景氛围
    scene.background = new THREE.Color(0x0a3d6b)
    // 环境光加强水下效果
    const ambient = scene.children.find(c => c instanceof THREE.AmbientLight) as THREE.AmbientLight | undefined
    if (ambient) {
      ambient.intensity = 0.5
      ambient.color.setHex(0x6688cc)
    }
    const hemi = scene.children.find(c => c instanceof THREE.HemisphereLight) as THREE.HemisphereLight | undefined
    if (hemi) {
      hemi.color.setHex(0x4488cc)
      hemi.groundColor.setHex(0x002244)
    }

    // 统一在此加载项目配置表（游戏配置 + 鱼类原型表）
    new EatFishConfigLoader((msg) => logger.info(msg)).init()
  }

  override onControllerReady(ctrl: PlayerController): void {
    this._controller = ctrl as EatFishPlayerController
    this.pawn = ctrl.pawn as EatFishPawn
  }

  override onStart(ctrl: PlayerController): boolean {
    this.pawn!.InitGame()

    // 生成鱼群
    this.gameMode.SpawnInitialFish()

    logger.info(`[EatFishGameInstance] 玩家生成: ${this.pawn!.name}`)
    this.world.BeginPlay()

    logger.info('[EatFishGameInstance] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    // 处理玩家输入
    this._controller?.ProcessKeys(dt)

    // Tick 世界
    this.world.manualTick(dt)
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
  }

  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    return this.gameMode.cameraManager.GetActiveCameraObject()
  }

  override stop() {
    if (!this._controller && !this.pawn) return
    logger.info('[EatFishGameInstance] 停止游戏...')
    this.world.DestroyAllActors()
    this.gameMode.CleanupFish()
    this.world.Pause()
    this.gameMode.cameraManager.Clear()
    this._controller = null
    this.pawn = null
    // 恢复场景背景
    this.world.sceneComp.scene.background = new THREE.Color(0x1a1a2e)
  }

  override destroy() {
    this.stop()
    super.destroy()
    this.world.Destroy()
  }
}
