/**
 * SnakeGameInstance — 贪吃蛇游戏实例
 * 封装 World + GameMode + 玩家生命周期，供 Viewport 使用
 */
import * as THREE from 'three'
import { GameInstance, World, logger } from '@/engine'
import type { GameInstanceCallbacks } from '@/engine'
import { SnakeGameMode, SnakePawn, SnakePlayerController } from './'
import type { Vec2 } from './types'

/** Snake 存档 payload（captureSnapshot 输出 / restoreSnapshot 输入） */
interface SnakeSavePayload {
  pawn: { snake: Vec2[]; currentDir: Vec2; nextDir: Vec2; moveTimer: number }
  foodGridPos: Vec2
  gameState: Record<string, unknown>
}

export class SnakeGameInstance extends GameInstance {
  readonly world: World
  readonly gameMode: SnakeGameMode

  private _controller: SnakePlayerController | null = null
  pawn: SnakePawn | null = null

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

  // ═══ 存档系统 ═══

  override captureSnapshot(): SnakeSavePayload | null {
    if (!this.pawn) return null
    return {
      pawn: this.pawn.getSaveData(),
      foodGridPos: { x: this.gameMode.foodGridPos.x, z: this.gameMode.foodGridPos.z },
      gameState: this.gameMode.gameState.serialize(),
    }
  }

  override restoreSnapshot(snapshot: unknown): void {
    if (!this.pawn) return
    const s = snapshot as SnakeSavePayload | null
    // 形状守卫：防止损坏/不匹配的存档静默破坏运行态
    if (!s?.pawn || !Array.isArray(s.pawn.snake) || !s.foodGridPos || !s.gameState) {
      logger.warn('[GameInstance] 存档结构不匹配，忽略恢复')
      return
    }
    this.pawn.applySaveData(s.pawn)
    this.gameMode.setFoodAt(s.foodGridPos)
    // restoreFrom 触发 notify → 经构造时注册的 gameState 订阅同步 HUD（含 onGameOver）
    this.gameMode.gameState.restoreFrom(s.gameState)
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
