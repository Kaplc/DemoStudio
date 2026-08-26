/**
 * SnakeGameInstance — 贪吃蛇游戏实例
 * 封装 World + GameMode + 玩家生命周期，供 Viewport 使用
 */
import * as THREE from 'three'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { SnakeGameMode, SnakePawn, SnakePlayerController } from './'

export class SnakeGameInstance extends GameInstance {
  readonly gameMode: SnakeGameMode

  private _controller: SnakePlayerController | null = null
  pawn: SnakePawn | null = null

  override get controller(): SnakePlayerController | null {
    return this._controller
  }

  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null

  constructor(renderContainer?: HTMLElement | null) {
    super(new World(), renderContainer ?? null)
    this.gameMode = new SnakeGameMode()
    this.world.SetGameMode(this.gameMode)
    this.world.Stop()

    this.unsubGameState = this.gameMode.gameState.subscribe(() => {
      const gs = this.gameMode.gameState
      this.callbacks.onScoreChange?.(gs.score)
      this.callbacks.onPhaseChange?.(gs.phase)
      if (gs.phase === 'gameover') {
        this.callbacks.onGameOver?.()
      }
    })
  }

  override setCallbacks(cbs: GameInstanceCallbacks) {
    this.callbacks = cbs
  }

  override start(): boolean {
    logger.info('[GameInstance] 启动游戏...')
    this.gameMode.InitGame()
    this.gameMode.StartPlay()
    const spawn = this.gameMode.SpawnPlayer()
    if (!spawn) {
      logger.error('[GameInstance] SpawnPlayer 返回空')
      return false
    }
    const pawn = spawn.pawn as SnakePawn
    pawn.InitGame()
    this._controller = spawn.controller as SnakePlayerController
    this.pawn = pawn
    this.gameMode.SpawnInitialFood(pawn.getSnakePositions())
    logger.info(`[GameInstance] 玩家生成: ${pawn.name}`)
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
    if (this.unsubGameState) {
      this.unsubGameState()
      this.unsubGameState = null
    }
    this.world.Destroy()
  }
}
