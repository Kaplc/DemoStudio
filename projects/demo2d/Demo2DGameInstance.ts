/**
 * Demo2DGameInstance — 2D 演示游戏实例
 * 封装 World + GameMode + 玩家生命周期
 */
import * as THREE from 'three'
import { GameInstance, logger } from '@/engine'
import type { PlayerController } from '@/engine'
import { Demo2DGameMode, Demo2DPawn, Demo2DPlayerController } from './'

export class Demo2DGameInstance extends GameInstance {
  private _gameMode!: Demo2DGameMode
  override get gameMode(): Demo2DGameMode { return this._gameMode }
  override createGameMode(): Demo2DGameMode { return this._gameMode = new Demo2DGameMode() }

  private _controller: Demo2DPlayerController | null = null
  pawn: Demo2DPawn | null = null

  override get controller(): Demo2DPlayerController | null {
    return this._controller
  }

  constructor() {
    super()
  }

  override onControllerReady(ctrl: PlayerController): void {
    this._controller = ctrl as Demo2DPlayerController
    this.pawn = ctrl.pawn as Demo2DPawn
  }

  override onStart(ctrl: PlayerController): boolean {
    this.gameMode.SpawnInitialCoin()
    this.world.BeginPlay()
    logger.info('[Demo2D] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
  }

  override drawGizmos() {
    this.world.drawGizmos()
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
  }

  override getActiveCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera | null {
    return this.gameMode.cameraManager.GetActiveCameraObject()
  }

  override stop() {
    if (!this._controller && !this.pawn) return
    logger.info('[Demo2D] 停止游戏...')
    this.world.DestroyAllActors()
    this.world.Pause()
    this.gameMode.cameraManager.Clear()
    this._controller = null
    this.pawn = null
  }

  override destroy() {
    this.stop()
    super.destroy()
    this.world.Destroy()
  }
}
