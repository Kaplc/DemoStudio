/**
 * Demo2DGameInstance — 2D 演示游戏实例
 * 封装 World + GameMode + 玩家生命周期
 */
import * as THREE from 'three'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { Demo2DGameMode, Demo2DPawn, Demo2DPlayerController } from './'

export class Demo2DGameInstance extends GameInstance {
  readonly world: World
  readonly gameMode: Demo2DGameMode

  private _controller: Demo2DPlayerController | null = null
  pawn: Demo2DPawn | null = null

  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null

  constructor(sharedScene: THREE.Scene, renderContainer?: HTMLElement | null) {
    super()
    this.renderContainer = renderContainer ?? null
    this.world = new World(sharedScene)
    this.gameMode = new Demo2DGameMode()
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

  override get controller(): Demo2DPlayerController | null {
    return this._controller
  }

  override setCallbacks(cbs: GameInstanceCallbacks) {
    this.callbacks = cbs
  }

  override start(): boolean {
    logger.info('[Demo2D] 启动游戏...')
    this.gameMode.InitGame()
    this.gameMode.StartPlay()
    const spawn = this.gameMode.SpawnPlayer()
    if (!spawn) {
      logger.error('[Demo2D] SpawnPlayer 返回空')
      return false
    }
    const pawn = spawn.pawn as Demo2DPawn
    this._controller = spawn.controller as Demo2DPlayerController
    this.pawn = pawn
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
    if (this.unsubGameState) {
      this.unsubGameState()
      this.unsubGameState = null
    }
    this.world.Destroy()
  }
}
