/**
 * GameMode — 游戏规则权威
 * 模仿 UE GameMode，控制游戏流程：初始化、胜负判定、得分规则
 */
import type { World } from './World'
import { GameState } from './GameState'
import { PlayerCameraManager } from './PlayerCameraManager'
import type { Pawn } from './Pawn'
import type { PlayerController } from './PlayerController'

export abstract class GameMode {
  public readonly world: World
  public readonly gameState: GameState
  public readonly cameraManager: PlayerCameraManager

  constructor(world: World) {
    this.world = world
    this.gameState = new GameState()
    this.cameraManager = new PlayerCameraManager()
  }

  /** 游戏初始化（World 启动时调用） */
  InitGame(): void {
    this.gameState.reset()
  }

  /** 游戏正式开始 */
  StartPlay(): void {
    this.gameState.setPhase('playing')
  }

  /** 每帧更新（在 Actor Tick 之后） */
  Tick(_deltaTime: number): void {}

  /** 玩家死亡时的逻辑 */
  OnPlayerDied(_pawn: Pawn): void {}

  /** 玩家得分 */
  OnScoreChanged(_newScore: number): void {}

  /** 是否结束 */
  IsGameOver(): boolean {
    return this.gameState.phase === 'gameover'
  }

  /** 默认生成 PlayerController 和 Pawn（子类重写） */
  SpawnPlayer(): { controller: PlayerController; pawn: Pawn } | null {
    return null
  }

  /** 游戏结束 */
  protected EndGame() {
    this.gameState.setPhase('gameover')
  }
}
