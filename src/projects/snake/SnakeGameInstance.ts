/**
 * SnakeGameInstance — 贪吃蛇游戏实例
 * 封装 World + GameMode + 玩家生命周期，供 Viewport 使用
 * 职责：创建/销毁游戏、Tick 转发、摄像机同步、状态回调
 */
import * as THREE from 'three'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks, GameUIElement } from '@/engine'
import { SnakeGameMode, SnakePawn, SnakePlayerController } from './'

export class SnakeGameInstance extends GameInstance {
  readonly world: World
  readonly gameMode: SnakeGameMode

  private _controller: SnakePlayerController | null = null
  pawn: SnakePawn | null = null

  // UI 元素
  private uiScore: GameUIElement | null = null
  private uiGameOver: GameUIElement | null = null

  override get controller(): SnakePlayerController | null {
    return this._controller
  }

  private callbacks: GameInstanceCallbacks = {}
  private unsubGameState: (() => void) | null = null

  constructor(sharedScene: THREE.Scene) {
    super()
    this.world = new World(sharedScene)
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
    this.world.SpawnActor(pawn)
    spawn.controller.Possess(pawn)
    this._controller = spawn.controller as SnakePlayerController
    this.pawn = pawn
    this.gameMode.SpawnInitialFood(pawn.getSnakePositions())
    logger.info(`[GameInstance] 玩家生成: ${pawn.name}`)
    this.world.BeginPlay()

    // 创建 UI 元素
    if (this.ui) {
      this.uiScore = this.ui.createText({
        text: 'Score: 0',
        x: 0,
        y: this.ui['height'] / 2 - 30,
        fontSize: 24,
        color: '#ffffff',
        fontFamily: 'monospace',
      })
      this.uiGameOver = this.ui.createText({
        text: '',
        x: 0,
        y: 0,
        fontSize: 40,
        color: '#ff4444',
        fontFamily: 'monospace',
      })
      this.uiGameOver.setVisible(false)
    }

    logger.info('[GameInstance] 游戏已启动')
    return true
  }

  override tick(dt: number) {
    this.world.manualTick(dt)
    // 更新 UI
    const gs = this.gameMode.gameState
    if (this.uiScore) {
      this.uiScore.setText(`Score: ${gs.score}`)
    }
    if (gs.phase === 'gameover' && this.uiGameOver) {
      this.uiGameOver.setVisible(true)
      this.uiGameOver.setText('GAME OVER')
    }
  }

  override syncCamera(targetCamera: THREE.PerspectiveCamera, aspect: number) {
    this.gameMode.cameraManager.ApplyToRenderer(targetCamera, aspect)
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
