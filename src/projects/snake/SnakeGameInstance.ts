/**
 * SnakeGameInstance — 贪吃蛇游戏实例
 * 封装 World + GameMode + 玩家生命周期，供 Viewport 使用
 */
import * as THREE from 'three'
import { GameInstance, logger } from '@/engine'
import type { PlayerController } from '@/engine'
import { SnakeGameMode, SnakePawn, SnakePlayerController } from './'

export class SnakeGameInstance extends GameInstance {
  private _gameMode!: SnakeGameMode
  override get gameMode(): SnakeGameMode { return this._gameMode }
  override createGameMode(): SnakeGameMode { return this._gameMode = new SnakeGameMode() }

  private _controller: SnakePlayerController | null = null
  pawn: SnakePawn | null = null

  override get controller(): SnakePlayerController | null {
    return this._controller
  }

  constructor() {
    super()
  }

  override onControllerReady(ctrl: PlayerController): void {
    this._controller = ctrl as SnakePlayerController
    this.pawn = ctrl.pawn as SnakePawn
  }

  override onStart(ctrl: PlayerController): boolean {
    this.pawn!.InitGame()
    this.gameMode.SpawnInitialFood(this.pawn!.getSnakePositions())
    logger.info(`[GameInstance] 玩家生成: ${this.pawn!.name}`)
    this.world.BeginPlay()
    logger.info('[GameInstance] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
  }

  /** 每帧绘制蛇的调试 Gizmos（方向射线 / 蛇身格 / 食物 / 场地范围） */
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
    logger.info('[GameInstance] 停止游戏...')
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
